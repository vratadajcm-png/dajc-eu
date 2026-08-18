#!/usr/bin/env node
// Friday EU Oversize Weekly editorial pipeline - run by
// .github/workflows/publish-weekly-oversize.yml. Reads this ISO week's
// findings (gathered all week by oversize-monitor.mjs), re-verifies the
// most significant ones, asks OpenAI (or a free local mock, with --mock) to
// synthesize a briefing for the UPCOMING week, cross-validates every source
// the model cites against what was actually verified, runs a quality gate,
// and only then writes content/news/eu-oversize/<slug>.md - followed by an
// `astro build` to confirm the site still builds before leaving the file in
// place.
//
// Safety invariant: this script only ever ADDS a new file, and only a file
// that does not already exist. If anything fails at any stage - not enough
// verified data, quality gate, build, or the target file already existing -
// it exits without modifying the repository. Existing published articles
// (this week's or any other week's) are never overwritten, touched, or
// deleted by this script under any failure mode, including a --dry-run
// invocation, which always deletes its own output before exiting.

import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadWeekFindings } from './lib/store.mjs';
import { isoWeekLabel, isoWeekRangeLabel } from './lib/week.mjs';
import { selectCandidates } from './lib/select-candidates.mjs';
import { verifyCandidates } from './lib/verify-candidates.mjs';
import { generateArticleWithOpenAI } from './lib/openai-client.mjs';
import { generateArticleMock } from './lib/mock-generator.mjs';
import { renderArticleMarkdown, toFrontmatterYaml } from './lib/render-article.mjs';
import { runQualityGate } from './lib/quality-gate.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src', 'content', 'news', 'eu-oversize');

function parseArgs(argv) {
  const mock = argv.includes('--mock') || process.env.OVERSIZE_MOCK === '1';
  const skipBuild = argv.includes('--skip-build');
  const dryRun = argv.includes('--dry-run') || process.env.OVERSIZE_DRY_RUN === '1';
  return { mock, skipBuild, dryRun };
}

function abort(reason) {
  console.log(`\nNo article will be published: ${reason}`);
  console.log('This is expected behavior when there is not enough verified, significant data - not an error.');
  process.exit(0);
}

async function main() {
  const { mock, skipBuild, dryRun } = parseArgs(process.argv.slice(2));
  const now = new Date();
  const thisWeek = isoWeekLabel(now);

  const nextWeekDate = new Date(now);
  nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7);
  const nextWeekLabel = isoWeekLabel(nextWeekDate);
  const weekRangeLabel = isoWeekRangeLabel(nextWeekDate);

  console.log(`EU Oversize Weekly generator - ${now.toISOString()}`);
  console.log(`Reading findings from ISO week: ${thisWeek}`);
  console.log(`Publishing for upcoming week: ${nextWeekLabel} (${weekRangeLabel})`);
  console.log(mock ? 'Mode: MOCK (no OpenAI call, no cost)' : 'Mode: LIVE (calls OpenAI API)');
  if (dryRun) {
    console.log('DRY RUN: will generate, validate and build the article, then discard it - nothing will be committed.');
  }
  console.log('');

  const slug = `eu-oversize-weekly-${nextWeekLabel.toLowerCase()}`;
  const filePath = path.join(ARTICLES_DIR, `${slug}.md`);
  if (existsSync(filePath)) {
    // This check applies in BOTH modes. In dry-run mode we still write to a
    // separate throwaway path below (never `filePath` itself) - but if the
    // real article already exists there is nothing meaningful left to dry-
    // run either, so we abort the same way in both modes for consistency.
    abort(
      `${path.relative(ROOT, filePath)} already exists - refusing to overwrite a previously published article. ` +
        'Delete it manually first if you really want to regenerate this week\'s article.'
    );
  }
  // Dry runs never write to the real target path, even transiently - a
  // separate, uniquely-named throwaway file is used for the build check
  // instead, so a dry run can never clobber or delete real published
  // content under any circumstance (including a second dry run started
  // while one is already in flight).
  const writeTargetPath = dryRun
    ? path.join(ARTICLES_DIR, `_dry-run-${slug}-${Date.now()}.md`)
    : filePath;

  const findingsMap = await loadWeekFindings(thisWeek);
  const findings = [...findingsMap.values()];
  console.log(`Findings on file for ${thisWeek}: ${findings.length}`);
  if (findings.length === 0) abort(`no findings recorded for ${thisWeek}`);

  const preSelected = selectCandidates(findings);
  console.log(`Pre-selected for verification: ${preSelected.length}`);
  if (preSelected.length === 0) abort('no candidates passed pre-selection');

  let verified;
  if (mock) {
    verified = preSelected.map((f) => ({ ...f, confidence: 'verified' }));
    console.log(`Verification: skipped (mock mode) - treating all ${verified.length} pre-selected candidates as verified`);
  } else {
    const result = await verifyCandidates(preSelected);
    verified = result.verified;
    console.log(`Verification: ${verified.length} OK, ${result.failed.length} failed (unreachable source - dropped)`);
  }
  if (verified.length === 0) abort('no candidates had a reachable source after verification');

  console.log(`\nSynthesizing article from ${verified.length} verified candidate(s)...`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!mock && !apiKey) abort('OPENAI_API_KEY is not set and --mock was not requested');

  let article;
  try {
    article = mock
      ? await generateArticleMock({ candidates: verified, weekRangeLabel })
      : await generateArticleWithOpenAI({ candidates: verified, weekRangeLabel, apiKey });
  } catch (err) {
    console.error('Article generation failed:', err.message || err);
    process.exit(1);
    return;
  }

  const verifiedUrls = new Set(verified.map((c) => c.sourceUrl));
  const beforeCrossCheck = article.developments.length;
  article.developments = article.developments.filter((item) => verifiedUrls.has(item.sourceUrl));
  const droppedByCrossCheck = beforeCrossCheck - article.developments.length;
  if (droppedByCrossCheck > 0) {
    console.warn(
      `Cross-validation: dropped ${droppedByCrossCheck} development(s) whose sourceUrl did not match any verified candidate (possible model drift).`
    );
  }
  console.log(`Developments after cross-validation: ${article.developments.length}`);
  if (article.developments.length === 0) abort('no developments survived cross-validation against verified sources');

  const publishedAt = now.toISOString().slice(0, 10);
  const { frontmatter, body } = renderArticleMarkdown(article, { slug, publishedAt });

  console.log('\nRunning quality gate...');
  const gate = runQualityGate({ frontmatter, body, developments: article.developments });
  if (!gate.ok) {
    console.error('Quality gate FAILED:');
    for (const err of gate.errors) console.error(`  - ${err}`);
    console.error('\nArticle NOT published. No files were written.');
    process.exit(1);
    return;
  }
  console.log('Quality gate passed.');

  await mkdir(ARTICLES_DIR, { recursive: true });
  const fileContent = `${toFrontmatterYaml(frontmatter)}\n\n${body}`;
  await writeFile(writeTargetPath, fileContent, 'utf-8');
  console.log(`\nWrote ${path.relative(ROOT, writeTargetPath)}${dryRun ? ' (throwaway dry-run path)' : ''}`);

  if (skipBuild) {
    console.log('Skipping build check (--skip-build passed).');
  } else {
    console.log('Running `npm run build` to confirm the site still builds...');
    try {
      // shell: true is required for npm to spawn reliably on Windows (.cmd
      // wrapper); safe here because the argument list is a static literal,
      // never interpolated from external input.
      await execFileAsync('npm', ['run', 'build'], { cwd: ROOT, shell: true });
      console.log('Build succeeded.');
    } catch (err) {
      console.error('Build FAILED after adding the new article - rolling back.');
      console.error(err.stdout || err.message || err);
      await unlink(writeTargetPath).catch(() => {});
      console.error(`Removed ${path.relative(ROOT, writeTargetPath)}. Repository restored to its prior state.`);
      process.exit(1);
      return;
    }
  }

  if (dryRun) {
    console.log('\n=== DRY RUN - ARTICLE THAT WOULD BE PUBLISHED (not committed) ===\n');
    console.log(fileContent);
    console.log('=== END OF DRY RUN ARTICLE ===\n');
    await unlink(writeTargetPath).catch(() => {});
    console.log(`Removed ${path.relative(ROOT, writeTargetPath)} (dry run - nothing is left to commit).`);
    console.log('\nDry run complete: verification, OpenAI synthesis, cross-validation, quality gate and build all passed.');
    console.log('No file was left on disk and nothing was committed or pushed. The real target path');
    console.log(`(${path.relative(ROOT, filePath)}) was never written to.`);
    return;
  }

  console.log('\n=== SUCCESS ===');
  console.log(`Article: ${path.relative(ROOT, filePath)}`);
  console.log(`Title: ${frontmatter.title}`);
  console.log(`Sources cited: ${frontmatter.sources.length}`);
  console.log('\nSuggested commit message:');
  console.log(`  content: publish EU Oversize Weekly ${nextWeekLabel}`);
}

main().catch((err) => {
  console.error('EU Oversize Weekly generator crashed unexpectedly:', err);
  console.error('No article was published; any previously published articles are unaffected.');
  process.exitCode = 1;
});
