// Connection safety for the legal-library scripts (import, review, verify).
//
// A database connection string is a secret: it must never reach a log, and the
// repository is public, so GitHub Actions logs are public too. GitHub masks the
// secret value itself but not the parts of it (host, password) that a driver
// error can print, so the scripts mask and redact those parts as well.
//
// A CI import must also refuse any target but the intended role on the
// intended Neon branch: assertDatabaseTarget() checks the role it is connected
// as, that the role has no administrative attributes or memberships, and the
// marker row in dajc_kb.deployment that the owner writes per branch
// (drizzle-kb/0001; INSERT INTO dajc_kb.deployment (environment) VALUES ('dev')).

/** The parts of a connection string that must not appear in a log. */
export function connectionSecrets(url) {
  if (!url) return [];
  const values = [String(url)];
  try {
    const u = new URL(url);
    let password = '';
    try {
      password = decodeURIComponent(u.password);
    } catch {
      password = u.password;
    }
    values.push(u.password, password, u.host, u.hostname);
  } catch {
    // Not a URL: the whole string is the secret.
  }
  return [...new Set(values.filter((v) => typeof v === 'string' && v.length >= 4))].sort((a, b) => b.length - a.length);
}

/** Replaces every secret part of `url` (and any connection string) in `text`. */
export function redact(text, url) {
  let out = String(text ?? '');
  for (const secret of connectionSecrets(url)) out = out.split(secret).join('[redacted]');
  return out.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, 'postgres://[redacted]');
}

/**
 * In GitHub Actions, registers the secret parts of `url` as masked values.
 * @param {string} url
 * @param {{ env?: Record<string, string | undefined>, write?: (line: string) => unknown }} [options]
 */
export function maskInGitHubActions(url, { env = process.env, write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  if (env.GITHUB_ACTIONS !== 'true') return 0;
  const secrets = connectionSecrets(url).filter((s) => !/[\r\n]/.test(s));
  for (const secret of secrets) write(`::add-mask::${secret}`);
  return secrets.length;
}

/**
 * Refuses to continue unless the connection is the expected least-privilege
 * role on the expected branch. Prints nothing secret: role names and the
 * marker value are not secrets.
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>} sql
 * @param {{ role?: string | null, environment?: string | null }} expected
 */
export async function assertDatabaseTarget(sql, { role = null, environment = null } = {}) {
  const [row] = await sql`
    select current_user::text as role, r.rolsuper as super, r.rolbypassrls as bypassrls, r.rolcreaterole as createrole,
           r.rolcreatedb as createdb, r.rolreplication as replication,
           exists (select 1 from pg_auth_members m where m.member = r.oid) as member_of_roles,
           to_regclass('dajc_kb.deployment') is not null as has_marker
    from pg_roles r where r.rolname = current_user`;
  if (row && environment) {
    try {
      row.environment = row.has_marker ? ((await sql`select environment from dajc_kb.deployment`)[0]?.environment ?? null) : null;
    } catch {
      row.environment = 'unreadable';
    }
  }
  const problems = [];
  if (role && row?.role !== role) problems.push(`connected as ${row?.role ?? 'unknown'}, expected ${role}`);
  if (role && (row?.super || row?.bypassrls || row?.createrole || row?.createdb || row?.replication)) problems.push('the role has administrative attributes');
  if (role && row?.member_of_roles) problems.push('the role is a member of other roles');
  if (environment && row?.environment !== environment) problems.push(`library marker dajc_kb.deployment is ${row?.environment || 'not set'}, expected ${environment}`);
  if (problems.length > 0) throw new Error(`wrong database target: ${problems.join('; ')}`);
  return { role: row.role, environment: row.environment ?? null };
}
