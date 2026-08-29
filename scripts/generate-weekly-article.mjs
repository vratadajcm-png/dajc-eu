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

import { writeFile, unlink, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadWeekFindings } from './lib/store.mjs';
import { isoWeekLabel, isoWeekRangeLabel, isoWeekStart, isoWeekEnd } from './lib/week.mjs';
import { selectCandidates } from './lib/select-candidates.mjs';
import { verifyCandidates } from './lib/verify-candidates.mjs';
import { generateArticleWithOpenAI, generateRoundupSupplementWithOpenAI } from './lib/openai-client.mjs';
import { generateArticleMock } from './lib/mock-generator.mjs';
import { renderArticleMarkdown, toFrontmatterYaml } from './lib/render-article.mjs';
import { runQualityGate } from './lib/quality-gate.mjs';
import { checkOpenAiKeyPreflight } from './lib/preflight.mjs';
import { formatNextPublicationLabel } from './lib/next-publication.mjs';
import { resolveDrivingBanFindings } from './lib/driving-ban-calendar.mjs';
import { crossValidateDevelopments } from './lib/cross-validate.mjs';
import { ensureOfficialCalendarLeadFloor } from './lib/lead-floor.mjs';
import { mergeRoundupSupplement, roundupNeedsSupplement, sanitizeRoundup } from './lib/roundup-breadth.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src', 'content', 'news', 'eu-oversize');

function parseArgs(argv) {
  const mock = argv.includes('--mock') || process.env.OVERSIZE_MOCK === '1';
  const skipBuild = argv.includes('--skip-build');
  const dryRun = argv.includes('--dry-run') || process.env.OVERSIZE_DRY_RUN === '1';
  const refreshExisting = argv.includes('--refresh-existing');
  return { mock, skipBuild, dryRun, refreshExisting };
}

async function appendSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  try {
    await appendFile(summaryFile, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
  } catch {
    // best-effort only - never fail the run because the summary couldn't be written
  }
}

async function abort(reason) {
  console.log(`\nNo article will be published: ${reason}`);
  console.log('This is expected behavior when there is not enough verified, significant data - not an error.');
  await appendSummary(`### EU Oversize Weekly - no article this run\n\n${reason}\n`);
  process.exit(0);
}

// Distinct from abort(): a configuration error (e.g. a missing
// OPENAI_API_KEY) is not "no news this week" - it must fail the run
// (non-zero exit) so it shows up as a red workflow run instead of silently
// looking identical to a normal quiet week.
async function fail(reason) {
  console.error(`\nConfiguration error - failing this run: ${reason}`);
  await appendSummary(`### EU Oversize Weekly - configuration error\n\n${reason}\n`);
  process.exit(1);
}

async function main() {
  const { mock, skipBuild, dryRun, refreshExisting } = parseArgs(process.argv.slice(2));
  if (refreshExisting && !dryRun) {
    await fail('--refresh-existing is allowed only together with --dry-run; it must never overwrite a published article directly.');
    return;
  }

  // Preflight, before any network/data work: a missing key on a real run is
  // a configuration error, not something worth spending verification time
  // on first. See scripts/lib/preflight.mjs.
  const apiKey = process.env.OPENAI_API_KEY;
  const preflight = checkOpenAiKeyPreflight({ mock, apiKey });
  if (!preflight.ok) {
    await fail(preflight.reason);
    return;
  }

  // OVERSIZE_NOW lets tests (and manual troubleshooting) pin "now" to a
  // fixed instant instead of the real wall clock - see
  // scripts/lib/__tests__/generate-weekly-article.test.mjs. Unset in every
  // real run (scheduled or workflow_dispatch), so production behavior is
  // unaffected.
  const now = process.env.OVERSIZE_NOW ? new Date(process.env.OVERSIZE_NOW) : new Date();
  const thisWeek = isoWeekLabel(now);

  const nextWeekDate = new Date(now);
  nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7);
  const nextWeekLabel = isoWeekLabel(nextWeekDate);
  const weekRangeLabel = isoWeekRangeLabel(nextWeekDate);
  const targetWeekStart = isoWeekStart(nextWeekDate);
  const targetWeekEnd = isoWeekEnd(nextWeekDate);
  const targetWeekStartIso = targetWeekStart.toISOString().slice(0, 10);
  const targetWeekEndIso = targetWeekEnd.toISOString().slice(0, 10);

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
  if (existsSync(filePath) && !refreshExisting) {
    await abort(
      `${path.relative(ROOT, filePath)} already exists - refusing to overwrite a previously published article. ` +
        'Use --dry-run --refresh-existing for a safe editorial refresh preview; the real file will still never be written.'
    );
    return;
  }
  if (existsSync(filePath) && refreshExisting) {
    console.log(`Refresh preview: ${path.relative(ROOT, filePath)} already exists; generating only to a throwaway dry-run path.`);
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
  const monitoredFindings = [...findingsMap.values()];
  console.log(`Monitor-derived findings on file for ${thisWeek}: ${monitoredFindings.length}`);

  // Maintained official driving-ban calendar layer (config/driving-ban-calendars):
  // Feed/HTML monitoring alone cannot reliably surface a standing/seasonal driving
  // ban that nobody re-announced this week, so these are resolved directly
  // against the target week's date range instead. An "annual-calendar"
  // entry (e.g. Italy's yearly decree) that has not been re-seeded for the
  // target year is a configuration/maintenance error, not a quiet week -
  // fail loudly instead of silently publishing without it.
  const { findings: calendarFindings, maintenanceErrors } = resolveDrivingBanFindings({
    weekStart: targetWeekStart,
    weekEnd: targetWeekEnd,
    year: targetWeekStart.getUTCFullYear(),
  });
  console.log(`Official driving-ban calendar findings for ${nextWeekLabel}: ${calendarFindings.length}`);
  if (maintenanceErrors.length > 0) {
    await fail(
      `official driving-ban calendar needs maintenance:\n  - ${maintenanceErrors.join('\n  - ')}`
    );
    return;
  }

  const findings = [...calendarFindings, ...monitoredFindings];
  if (findings.length === 0) {
    await abort(`no findings recorded for ${thisWeek} and no official driving-ban calendar applies to ${nextWeekLabel}`);
    return;
  }

  const preSelected = [...calendarFindings, ...selectCandidates(monitoredFindings)];
  console.log(`Pre-selected for verification: ${preSelected.length} (${calendarFindings.length} from the official calendar, always included)`);
  if (preSelected.length === 0) {
    await abort('no candidates passed pre-selection');
    return;
  }

  let verified;
  if (mock) {
    verified = preSelected.map((f) => ({ ...f, confidence: 'verified' }));
    console.log(`Verification: skipped (mock mode) - treating all ${verified.length} pre-selected candidates as verified`);
  } else {
    const result = await verifyCandidates(preSelected, { weekStart: targetWeekStart, weekEnd: targetWeekEnd });
    verified = result.verified;
    console.log(`Verification: ${verified.length} OK, ${result.failed.length} rejected (see reasons above)`);
  }
  if (verified.length === 0) {
    await abort('no candidates survived verification (relevance, target-week dates, and source reachability)');
    return;
  }

  console.log(`\nSynthesizing article from ${verified.length} verified candidate(s)...`);

  let article;
  try {
    article = mock
      ? await generateArticleMock({ candidates: verified, weekRangeLabel })
      : await generateArticleWithOpenAI({
          candidates: verified,
          weekRangeLabel,
          targetWeekStart: targetWeekStartIso,
          targetWeekEnd: targetWeekEndIso,
          apiKey,
        });
  } catch (err) {
    console.error('Article generation failed:', err.message || err);
    process.exit(1);
    return;
  }

  const { kept, droppedCount } = crossValidateDevelopments(article.developments, verified);
  article.developments = kept;
  const roundupValidation = crossValidateDevelopments(article.europeRoundup || [], verified);
  article.europeRoundup = roundupValidation.kept;

  const leadFloor = ensureOfficialCalendarLeadFloor(article, verified);
  article = leadFloor.article;

  article.europeRoundup = sanitizeRoundup(
    article.europeRoundup,
    article.developments,
    { suppressEvergreenSunday: targetWeekEnd >= new Date('2026-09-01T00:00:00Z') }
  );
  if (leadFloor.added > 0 || leadFloor.promoted > 0) {
    console.log(
      `Official-calendar lead floor: added ${leadFloor.added}, promoted ${leadFloor.promoted}; lead reports now ${article.developments.length}.`
    );
  }

  if (!mock) {
    const breadth = roundupNeedsSupplement(article.europeRoundup);
    if (breadth.needsSupplement) {
      const usedSourceUrls = new Set(
        [...article.developments, ...article.europeRoundup]
          .map((item) => item.sourceUrl)
          .filter(Boolean)
      );
      const remainingVerified = verified.filter(
        (candidate) => candidate.sourceUrl && !usedSourceUrls.has(candidate.sourceUrl)
      );

      console.log(
        `Rest-of-Europe breadth repair needed: ${breadth.reportCount} report(s), ${breadth.countryCount} countr${breadth.countryCount === 1 ? 'y' : 'ies'}; requesting ${breadth.neededCountries || 1} additional distinct country candidate(s).`
      );

      try {
        const supplement = await generateRoundupSupplementWithOpenAI({
          candidates: remainingVerified,
          targetWeekStart: targetWeekStartIso,
          targetWeekEnd: targetWeekEndIso,
          apiKey,
          existingCountries: [...breadth.countries],
          neededCountries: Math.max(1, breadth.neededCountries),
        });
        const supplementValidation = crossValidateDevelopments(supplement, remainingVerified);
        article.europeRoundup = mergeRoundupSupplement(
          article.europeRoundup,
          supplementValidation.kept,
          new Set(article.developments.map((item) => item.sourceUrl).filter(Boolean))
        );
        console.log(
          `Rest-of-Europe supplement: ${supplementValidation.kept.length} cross-validated candidate(s); roundup now has ${article.europeRoundup.length} report(s) across ${roundupNeedsSupplement(article.europeRoundup).countryCount} countries.`
        );
      } catch (err) {
        console.warn(`Rest-of-Europe supplement failed: ${err.message || err}. Quality gate will decide whether publication can continue.`);
      }
    }
  }

  const totalDropped = droppedCount + roundupValidation.droppedCount;
  if (totalDropped > 0) {
    console.warn(
      `Cross-validation: dropped ${totalDropped} item(s) whose sourceUrl did not match any verified candidate (possible model drift).`
    );
  }
  console.log(`Lead reports after cross-validation: ${article.developments.length}`);
  console.log(`Rest-of-Europe reports after cross-validation: ${article.europeRoundup.length}`);
  if (article.developments.length === 0) {
    await abort('no developments survived cross-validation against verified sources');
    return;
  }

  const publishedAt = now.toISOString().slice(0, 10);
  const nextPublicationLabel = formatNextPublicationLabel(now);
  const { frontmatter, body } = renderArticleMarkdown(article, { slug, publishedAt, nextPublicationLabel });

  console.log('\nRunning quality gate...');
  const gate = runQualityGate({
    frontmatter,
    body,
    developments: article.developments,
    europeRoundup: article.europeRoundup,
    weekStart: targetWeekStart,
    weekEnd: targetWeekEnd,
  });
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
    await appendSummary(
      [
        '### EU Oversize Weekly dry run successful',
        '',
        'No content was published.',
        '',
        `- Would-be article: \`${path.relative(ROOT, filePath)}\``,
        `- Title: ${frontmatter.title}`,
        `- Sources cited: ${frontmatter.sources.length}`,
        '- Nothing was committed or pushed.',
      ].join('\n')
    );
    return;
  }

  console.log('\n=== SUCCESS ===');
  console.log(`Article: ${path.relative(ROOT, filePath)}`);
  console.log(`Title: ${frontmatter.title}`);
  console.log(`Sources cited: ${frontmatter.sources.length}`);
  console.log('\nSuggested commit message:');
  console.log(`  content: publish EU Oversize Weekly ${nextWeekLabel}`);
  await appendSummary(
    [
      '### EU Oversize Weekly article generated',
      '',
      `- Article: \`${path.relative(ROOT, filePath)}\``,
      `- Title: ${frontmatter.title}`,
      `- Sources cited: ${frontmatter.sources.length}`,
    ].join('\n')
  );
}

main().catch((err) => {
  console.error('EU Oversize Weekly generator crashed unexpectedly:', err);
  console.error('No article was published; any previously published articles are unaffected.');
  process.exitCode = 1;
});
