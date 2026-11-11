import { describe, expect, it } from 'vitest';
import { assertDatabaseTarget, connectionSecrets, maskInGitHubActions, redact } from '../db-guard.mjs';

const URL_ = 'postgresql://dajc_kb_importer:s3cr%2Ft-P4ss_word@ep-example-123456.eu-central-1.aws.neon.tech/dajc?sslmode=require';

describe('connection strings never reach a log', () => {
  it('knows which parts are secret', () => {
    const secrets = connectionSecrets(URL_);
    expect(secrets).toContain(URL_);
    expect(secrets).toContain('s3cr%2Ft-P4ss_word');
    expect(secrets).toContain('s3cr/t-P4ss_word');
    expect(secrets).toContain('ep-example-123456.eu-central-1.aws.neon.tech');
    expect(connectionSecrets('')).toEqual([]);
  });

  it('redacts host, password and whole connection strings from error messages', () => {
    const message = `connect ECONNREFUSED ep-example-123456.eu-central-1.aws.neon.tech:5432; password s3cr/t-P4ss_word; url ${URL_}; other postgres://a:b@c/d`;
    const out = redact(message, URL_);
    expect(out).not.toMatch(/ep-example|s3cr|P4ss|a:b@c/);
    expect(out).toContain('[redacted]');
    expect(redact('password authentication failed for user "dajc_kb_importer"', URL_)).toBe('password authentication failed for user "dajc_kb_importer"');
  });

  it('masks the secret parts only inside GitHub Actions', () => {
    const lines: string[] = [];
    expect(maskInGitHubActions(URL_, { env: {}, write: (l: string) => lines.push(l) })).toBe(0);
    expect(lines).toEqual([]);
    expect(maskInGitHubActions(URL_, { env: { GITHUB_ACTIONS: 'true' }, write: (l: string) => lines.push(l) })).toBeGreaterThanOrEqual(4);
    expect(lines.every((l) => l.startsWith('::add-mask::'))).toBe(true);
    expect(lines).toContain('::add-mask::ep-example-123456.eu-central-1.aws.neon.tech');
  });
});

describe('import target guard', () => {
  const fakeSql = (role: Record<string, unknown>, marker: string | null) => {
    let call = 0;
    return (async () => (call++ === 0 ? [{ has_marker: marker !== null, ...role }] : marker === null ? [] : [{ environment: marker }])) as any;
  };
  const importer = { role: 'dajc_kb_importer', super: false, bypassrls: false, createrole: false, createdb: false, replication: false, member_of_roles: false };

  it('accepts the least-privilege importer on the dev branch', async () => {
    await expect(assertDatabaseTarget(fakeSql(importer, 'dev'), { role: 'dajc_kb_importer', environment: 'dev' })).resolves.toEqual({ role: 'dajc_kb_importer', environment: 'dev' });
  });

  it('refuses the owner, a privileged role, another branch and an unmarked database', async () => {
    const owner = { ...importer, role: 'dajc_owner', bypassrls: true, createrole: true, member_of_roles: true };
    await expect(assertDatabaseTarget(fakeSql(owner, 'dev'), { role: 'dajc_kb_importer', environment: 'dev' })).rejects.toThrow(/connected as dajc_owner.*administrative.*member of other roles/);
    await expect(assertDatabaseTarget(fakeSql(importer, 'production'), { role: 'dajc_kb_importer', environment: 'dev' })).rejects.toThrow(/is production, expected dev/);
    await expect(assertDatabaseTarget(fakeSql(importer, null), { role: 'dajc_kb_importer', environment: 'dev' })).rejects.toThrow(/is not set, expected dev/);
  });
});
