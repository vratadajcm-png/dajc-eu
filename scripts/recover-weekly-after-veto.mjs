#!/usr/bin/env node
// At most three total editorial generations per preparation (initial + two repairs).
// A rejected report is repaired or removed; the edition is not abandoned:
//   - first repair: a source rejected only because the article misstated it
//     stays, with the reviewer's reasons as correction constraints; a source
//     rejected for its quality (relay, general outlet, old page...) goes;
//   - later repairs: sources the reviewer marked unsupported are excluded (even when that is
//     every cited source) and the writer works only from the REMAINING
//     verified pool; nothing left = blocked edition, never padding;
//   - without an unsupported source, the bounded blocking reasons become
//     correction constraints for one rewrite of the same verified pool.
// Every repair reruns source verification, deterministic gates (including the
// legal-claim guard), the build and a fresh independent review of the exact
// new bytes. No claim is waived and no approval is reused.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_EDITION_ATTEMPTS, planEditorialRepair, sanitizeEditorialFeedback } from './lib/weekly-recovery.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function recoverEditorialEdition({ articlePath, root = ROOT, runnerTemp = process.env.RUNNER_TEMP,
  env = process.env, run = execFileSync, maxAttempts = MAX_EDITION_ATTEMPTS } = {}) {
  if (!articlePath || isAbsolute(articlePath) || !/^src\/content\/news\/eu-oversize\/eu-oversize-weekly-\d{4}-w\d{2}\.md$/.test(articlePath)) {
    throw new Error('Recovery requires the exact final weekly article path');
  }
  const target = resolve(root, articlePath);
  if (relative(root, target).startsWith('..') || !existsSync(target)) throw new Error('Recovery article missing or outside repository');
  if (!runnerTemp) throw new Error('Trusted runner directory missing');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_EDITION_ATTEMPTS) throw new Error('Invalid recovery attempt budget');
  const vetoPath = join(runnerTemp, 'dajc-weekly-review-veto.json');
  const approvalPath = join(runnerTemp, 'dajc-weekly-review-approved.json');
  if (!existsSync(vetoPath)) throw new Error('No structured Claude veto. Recovery is not authorised');
  if (existsSync(approvalPath)) throw new Error('Unexpected prior approval receipt; refusing recovery');
  const before = readFileSync(target);
  const originalVeto = readFileSync(vetoPath);
  const status = run('git', ['status', '--porcelain', '--untracked-files=all', '--', articlePath], { cwd: root, encoding: 'utf8' }).trim();
  if (!status.startsWith('?? ') || !status.endsWith(articlePath)) throw new Error('Refusing to modify a tracked or already-staged article');
  const boundVeto = () => {
    const veto = JSON.parse(readFileSync(vetoPath, 'utf8'));
    if (veto.articlePath !== articlePath || veto.sha256 !== hash(readFileSync(target)) || !Array.isArray(veto.sourceUrls)) throw new Error('Editorial veto is not bound to current article bytes');
    return veto;
  };
  const firstVeto = boundVeto();
  const auditDir = join(runnerTemp, 'dajc-weekly-recovery');
  mkdirSync(auditDir, { recursive: true });
  const ledgerPath = join(auditDir, 'manifest.json');
  // Reinvoking this helper in the same preparation never resets its budget.
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {
    articlePath, initialSha256: hash(before), maxAttempts, attempts: [{ attempt: 1, state: 'EDITORIAL_REJECTED', sha256: hash(before), review: firstVeto.review }],
  };
  if (ledger.articlePath !== articlePath || ledger.initialSha256 !== hash(before) || !Array.isArray(ledger.attempts)) throw new Error('Recovery ledger differs from initial draft');
  const persist = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
  const archive = (attempt, bytes, veto) => {
    writeFileSync(join(auditDir, `attempt-${attempt}.md`), bytes, { mode: 0o600 });
    if (veto) writeFileSync(join(auditDir, `attempt-${attempt}-veto.json`), JSON.stringify(veto, null, 2), { mode: 0o600 });
  };
  archive(1, before, firstVeto);
  persist();
  const excluded = new Set();
  let feedback = [];
  let lastError = new Error('Editorial recovery budget exhausted');
  try {
    while (ledger.attempts.length < maxAttempts) {
      const veto = boundVeto();
      const plan = planEditorialRepair(veto.review, veto.sourceUrls, { attempt: ledger.attempts.length + 1 });
      if (!plan.ok) throw new Error('Editorial veto cannot be repaired automatically (' + plan.reason + '); fail closed for human review');
      for (const url of plan.excludeUrls) excluded.add(url);
      // Feedback accumulates across attempts so a later rewrite cannot
      // reintroduce a claim an earlier review already rejected.
      // Newest findings first so the cap drops the oldest, never the latest veto.
      feedback = sanitizeEditorialFeedback([...plan.feedback, ...feedback]);
      const number = ledger.attempts.length + 1;
      const record = { attempt: number, state: 'REPAIRING', mode: plan.mode, allSourcesRejected: plan.allSourcesRejected, correctedSourceUrls: plan.correctUrls,
        excludedSourceUrls: [...excluded], editorialFeedback: feedback, blockingReasons: veto.review.blockingReasons, startedAt: new Date().toISOString() };
      ledger.attempts.push(record); persist();
      console.log(`Editorial recovery attempt ${number}/${maxAttempts} (${plan.mode}): excluding ${excluded.size} unsupported source URL(s), ${feedback.length} correction constraint(s).` +
        (plan.allSourcesRejected ? ' Every cited source was rejected; only the remaining verified candidates may be used.' : ''));
      unlinkSync(target);
      unlinkSync(vetoPath); // only a newly completed review can authorize another repair
      // The exact week is derived from the already SHA-bound article path,
      // so a repair across midnight/Monday can never become another edition.
      const targetWeek = articlePath.match(/(\d{4}-w\d{2})\.md$/)[1].toUpperCase();
      try {
        run(process.execPath, ['scripts/generate-weekly-article.mjs', '--target-week', targetWeek], {
          cwd: root, stdio: 'inherit', timeout: 900000,
          env: { ...env, OVERSIZE_TARGET_WEEK: targetWeek, OVERSIZE_EXCLUDE_SOURCE_URLS: JSON.stringify([...excluded]), OVERSIZE_EDITORIAL_FEEDBACK: JSON.stringify(feedback) },
        });
        if (!existsSync(target)) {
          record.state = 'NO_QUALIFIED_CONTENT';
          throw new Error('No verified report remains after removing rejected content; edition blocked without padding');
        }
        const repairedSha = hash(readFileSync(target));
        // Re-reviewing identical rejected bytes would spend money for a known veto.
        if (ledger.attempts.some((attempt) => attempt !== record && attempt.sha256 === repairedSha)) {
          record.sha256 = repairedSha;
          record.state = 'DUPLICATE_DRAFT';
          throw new Error('Repair reproduced an already rejected draft; no duplicate review');
        }
        record.sha256 = repairedSha;
        archive(number, readFileSync(target));
        run(process.execPath, ['scripts/claude-weekly-review.mjs', articlePath], {
          cwd: root, stdio: 'inherit', env: { ...env, OVERSIZE_TARGET_WEEK: targetWeek }, timeout: 420000,
        });
        if (!existsSync(approvalPath)) throw new Error('Editorial recovery did not produce an approval receipt');
        const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
        if (approval.articlePath !== articlePath || approval.sha256 !== hash(readFileSync(target))) throw new Error('Recovery approval is not bound to repaired bytes');
        ledger.outcome = 'EDITORIAL_APPROVED';
        record.state = 'EDITORIAL_APPROVED'; record.review = approval.review; record.completedAt = new Date().toISOString(); persist();
        console.log('Recovered edition independently approved by Claude. Protected CI and merge remain mandatory.');
        return { ok: true, ledgerPath, attempts: ledger.attempts.length };
      } catch (error) {
        lastError = error;
        if (!['NO_QUALIFIED_CONTENT', 'DUPLICATE_DRAFT'].includes(record.state)) record.state = 'BLOCKED';
        record.error = error.message; record.completedAt = new Date().toISOString();
        if (existsSync(approvalPath)) unlinkSync(approvalPath);
        // API/network/build errors are not editorial verdicts and must never
        // cause another paid generation. A complete fresh veto alone can retry.
        if (existsSync(target) && existsSync(vetoPath)) {
          try {
            const rejection = boundVeto();
            archive(number, readFileSync(target), rejection);
            record.state = 'EDITORIAL_REJECTED'; record.review = rejection.review; persist();
            continue;
          } catch { /* stale/missing veto: stop immediately */ }
        }
        persist(); throw error;
      }
    }
    throw lastError;
  } catch (error) {
    if (existsSync(approvalPath)) unlinkSync(approvalPath);
    writeFileSync(target, before);
    // Restored draft and veto remain paired; every repaired version is archived.
    writeFileSync(vetoPath, originalVeto, { mode: 0o600 });
    ledger.outcome = 'BLOCKED'; ledger.error = error.message; persist();
    console.error('Recovery blocked; original rejected draft restored for audit:', error.message);
    return { ok: false, ledgerPath, attempts: ledger.attempts.length, error: error.message };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!recoverEditorialEdition({ articlePath: process.argv[2] }).ok) process.exitCode = 1; }
  catch (error) { console.error('Recovery blocked:', error.message); process.exitCode = 1; }
}
