#!/usr/bin/env node
// EU Oversize Weekly editorial pipeline - run by
// .github/workflows/publish-weekly-oversize.yml. Reads this ISO week's
// findings (gathered all week by oversize-monitor.mjs), applies the complete
// deterministic Weekly eligibility rules (scripts/lib/weekly-eligibility.mjs:
// heavy-transport scope, publication-date freshness, no generic/landing pages,
// no general driving bans, no repetition of earlier editions, >30-day closure
// rule), re-verifies the survivors, asks OpenAI (or a free local mock, with
// --mock) to write a briefing for the UPCOMING week from those candidates only,
// cross-validates and re-filters every returned item, runs a quality gate,
// and only then writes content/news/eu-oversize/<slug>.md - followed by an
// `astro build` to confirm the site still builds before leaving the file in
// place.
//
// QUALITY > COUNT: an edition contains exactly the items that qualify, up to
// 30 lead reports and 15 Rest-of-Europe updates. There is no minimum, no
// supplement/repair loop asking for "more" items, and no retry that re-rolls
// synthesis until a count is met (docs/DAJC_WEEKLY_INTELLIGENCE_SPEC.md §3).
//
// Safety invariant: this script only ever ADDS a new file, and only a file
// that does not already exist. If anything fails at any stage - nothing
// verified to publish, quality gate, build, or the target file already
// existing - it exits without modifying the repository. Existing published
// articles (this week's or any other week's) are never overwritten, touched,
// or deleted by this script under any failure mode, including a --dry-run
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
import { generateArticleWithOpenAI, generateRequiredItemsWithOpenAI } from './lib/openai-client.mjs';
import { generateArticleMock, generateRequiredItemsMock } from './lib/mock-generator.mjs';
import { renderArticleMarkdown, toFrontmatterYaml } from './lib/render-article.mjs';
import { runQualityGate, MAX_REPORTS, MAX_ROUNDUP_REPORTS } from './lib/quality-gate.mjs';
import { checkOpenAiKeyPreflight } from './lib/preflight.mjs';
import { formatNextPublicationLabel, publicationSlotFor, targetWeekDateFor } from './lib/next-publication.mjs';
import { crossValidateDevelopments } from './lib/cross-validate.mjs';
import { attachCriticalGroupSources, criticalWeeklyGroups, missingCriticalGroups } from './lib/critical-floor.mjs';
import { filterGeneratedItems } from './lib/generated-item-filter.mjs';
import { loadPreviousEditionSources } from './lib/previous-editions.mjs';
import { FRESHNESS_WINDOW_DAYS, editionFreshSince } from './lib/weekly-eligibility.mjs';
import { oversizeSources } from '../config/oversize-sources/index.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src', 'content', 'news', 'eu-oversize');

function parseArgs(argv) {
  const mock = argv.includes('--mock') || process.env.OVERSIZE_MOCK === '1';
  const skipBuild = argv.includes('--skip-build');
  const dryRun = argv.includes('--dry-run') || process.env.OVERSIZE_DRY_RUN === '1';
  const refreshExisting = argv.includes('--refresh-existing');
  const preview = argv.includes('--preview');
  // A manually requested regeneration of an edition whose earlier version was
  // withdrawn: stamps `updatedAt` so readers can see the edition changed.
  const correction = argv.includes('--correction') || process.env.OVERSIZE_CORRECTION === '1';
  return { mock, skipBuild, dryRun, refreshExisting, preview, correction };
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

// The first report covering each critical development (by any of its URLs).
function criticalGroupOwners(article, criticalGroups) {
  const groupByUrl = new Map();
  for (const group of criticalGroups) {
    for (const candidate of group.candidates) groupByUrl.set(candidate.sourceUrl, group.key);
  }
  const covered = new Set();
  const owners = new Set();
  for (const item of [...article.developments, ...article.europeRoundup]) {
    const key = groupByUrl.get(item.sourceUrl);
    if (key && !covered.has(key)) {
      covered.add(key);
      owners.add(item);
    }
  }
  return owners;
}

function capSection(items, max, isProtected) {
  if (items.length <= max) return { kept: items, left: [] };
  const protectedItems = items.filter(isProtected).slice(0, max);
  const others = items.filter((item) => !isProtected(item)).slice(0, max - protectedItems.length);
  const keep = new Set([...protectedItems, ...others]);
  return { kept: items.filter((item) => keep.has(item)), left: items.filter((item) => !keep.has(item)) };
}

function logRejections(rejected) {
  if (rejected.length === 0) return;
  const byReason = new Map();
  for (const { reason } of rejected) {
    const key = String(reason).replace(/"[^"]*"/g, '"…"').replace(/\b\d{4}-\d{2}-\d{2}\b/g, 'YYYY-MM-DD').replace(/in eu-oversize-[\w-]+/, 'in an earlier edition');
    byReason.set(key, (byReason.get(key) || 0) + 1);
  }
  console.log(`Excluded by Weekly eligibility rules: ${rejected.length}`);
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)} x ${reason}`);
  }
  for (const { finding, reason } of rejected) {
    console.log(`  [excluded] ${finding.country}: "${finding.title}" - ${reason}`);
  }
}

async function main() {
  const { mock, skipBuild, dryRun, refreshExisting, preview, correction } = parseArgs(process.argv.slice(2));
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

  // The article is prepared ahead of its Friday 12:00 Europe/Prague slot
  // (normally on Thursday) and carries that slot as `publishedAt`; the site
  // only shows it from that instant on. The target week is the one after the
  // publication Friday, whatever day this run happens on.
  const publicationSlot = publicationSlotFor(now);
  const nextWeekDate = targetWeekDateFor(publicationSlot);
  const nextWeekLabel = isoWeekLabel(nextWeekDate);
  const weekRangeLabel = isoWeekRangeLabel(nextWeekDate);
  const targetWeekStart = isoWeekStart(nextWeekDate);
  const targetWeekEnd = isoWeekEnd(nextWeekDate);
  const targetWeekStartIso = targetWeekStart.toISOString().slice(0, 10);
  const targetWeekEndIso = targetWeekEnd.toISOString().slice(0, 10);

  console.log(`EU Oversize Weekly generator - ${now.toISOString()}`);
  console.log(`Reading findings from ISO week: ${thisWeek}`);
  console.log(`${preview ? 'Publishing PREVIEW for' : 'Publishing for upcoming week'}: ${nextWeekLabel} (${weekRangeLabel})`);
  if (!preview) console.log(`Public from: ${publicationSlot.toISOString()} (Friday 12:00 Europe/Prague)`);
  console.log(mock ? 'Mode: MOCK (no OpenAI call, no cost)' : 'Mode: LIVE (calls OpenAI API)');
  if (dryRun) {
    console.log('DRY RUN: will generate, validate and build the article, then discard it - nothing will be committed.');
  }
  console.log('');

  const slug = preview
    ? `eu-oversize-weekly-preview-${nextWeekLabel.toLowerCase()}`
    : `eu-oversize-weekly-${nextWeekLabel.toLowerCase()}`;
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
  const findings = [...findingsMap.values()];
  console.log(`Monitor-derived findings on file for ${thisWeek}: ${findings.length}`);
  // The Weekly never imports the DAJC Driving Bans calendar as a topic
  // source: general HGV bans live in the separate Driving Bans service.
  if (findings.length === 0) {
    await abort(`no findings recorded for ${thisWeek}`);
    return;
  }

  // Earlier editions only: the final and the preview of this same target
  // week report the same week and must not block each other.
  const previousEditions = await loadPreviousEditionSources({
    articlesDir: ARTICLES_DIR,
    excludeSlugs: [`eu-oversize-weekly-${nextWeekLabel.toLowerCase()}`, `eu-oversize-weekly-preview-${nextWeekLabel.toLowerCase()}`],
  });
  const sourceByName = new Map(oversizeSources.map((source) => [source.name, source]));
  const freshSince = editionFreshSince(now, publicationSlot);
  const eligibilityContext = {
    now,
    freshSince,
    weekStart: targetWeekStart,
    weekEnd: targetWeekEnd,
    previousEditions,
    sourceMetaFor: (candidate) => sourceByName.get(candidate.sourceName) || null,
  };
  console.log(
    `Eligibility: source published on/after ${freshSince.toISOString().slice(0, 10)} (${FRESHNESS_WINDOW_DAYS} days before preparation) or validity beginning/ending in ${nextWeekLabel}, ` +
      `heavy-transport scope, no general driving bans, no generic pages, ${previousEditions.size} source URL(s) already published in earlier editions.`
  );

  const { selected: preSelected, rejected } = selectCandidates(findings, eligibilityContext);
  logRejections(rejected);
  console.log(`Pre-selected for verification: ${preSelected.length} of ${findings.length}`);
  if (preSelected.length === 0) {
    await abort('no finding passed the Weekly eligibility rules (freshness, heavy-transport relevance, scope)');
    return;
  }

  let verified;
  if (mock) {
    verified = preSelected.map((f) => ({ ...f, confidence: 'verified' }));
    console.log(`Verification: skipped (mock mode) - treating all ${verified.length} pre-selected candidates as verified`);
  } else {
    const result = await verifyCandidates(preSelected, eligibilityContext);
    verified = result.verified;
    console.log(`Verification: ${verified.length} OK, ${result.failed.length} rejected (see reasons above)`);
  }
  if (verified.length === 0) {
    await abort('no candidates survived verification (eligibility and source reachability)');
    return;
  }
  for (const candidate of verified) {
    console.log(`  [verified] ${candidate.country}: ${candidate.title} (published ${candidate.publishedAt || 'n/a'}) -> ${candidate.sourceUrl}`);
  }

  const candidatesByUrl = new Map(verified.map((candidate) => [candidate.sourceUrl, candidate]));
  const criticalGroups = criticalWeeklyGroups(verified, eligibilityContext);
  const requiredSourceUrls = criticalGroups.flatMap((group) => group.candidates.map((c) => c.sourceUrl));
  if (criticalGroups.length > 0) {
    console.log(`Critical-news coverage: ${criticalGroups.length} required verified development(s).`);
    for (const group of criticalGroups) {
      for (const item of group.candidates) console.log(`  [required] ${item.country}: ${item.title} -> ${item.sourceUrl}`);
    }
  }

  console.log(`\nSynthesizing article from ${verified.length} verified candidate(s)...`);

  let article;
  try {
    article = mock
      ? await generateArticleMock({ candidates: verified, weekRangeLabel })
      : await generateArticleWithOpenAI({
          candidates: verified,
          requiredSourceUrls,
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

  const filterOptions = { weekStart: targetWeekStart, weekEnd: targetWeekEnd, candidatesByUrl, eligibilityContext };
  const leadValidation = crossValidateDevelopments(article.developments, verified);
  const leadFilter = filterGeneratedItems(leadValidation.kept, filterOptions);
  article.developments = leadFilter.kept;

  const roundupValidation = crossValidateDevelopments(article.europeRoundup || [], verified);
  const roundupFilter = filterGeneratedItems(roundupValidation.kept, {
    ...filterOptions,
    usedSourceUrls: new Set(article.developments.map((item) => item.sourceUrl)),
  });
  article.europeRoundup = roundupFilter.kept;

  for (const dropped of [...leadFilter.dropped, ...roundupFilter.dropped]) {
    console.log(`  [AI item removed] "${dropped.item?.title || 'untitled'}": ${dropped.reason}`);
  }
  const totalDropped = leadValidation.droppedCount + roundupValidation.droppedCount;
  if (totalDropped > 0) {
    console.warn(`Cross-validation: dropped ${totalDropped} item(s) whose sourceUrl did not match any verified candidate (possible model drift).`);
  }

  // Mandatory coverage of named critical developments - never a count repair.
  const missing = missingCriticalGroups(article, criticalGroups);
  if (missing.length > 0) {
    console.log(`Critical-news coverage: writing ${missing.length} omitted required development(s).`);
    try {
      const written = mock
        ? await generateRequiredItemsMock({ groups: missing })
        : await generateRequiredItemsWithOpenAI({
            candidates: missing.flatMap((group) => group.candidates),
            targetWeekStart: targetWeekStartIso,
            targetWeekEnd: targetWeekEndIso,
            apiKey,
          });
      const requiredValidation = crossValidateDevelopments(written, verified);
      const requiredFilter = filterGeneratedItems(requiredValidation.kept, {
        ...filterOptions,
        usedSourceUrls: new Set([...article.developments, ...article.europeRoundup].map((item) => item.sourceUrl)),
      });
      for (const dropped of requiredFilter.dropped) {
        console.log(`  [required item removed] "${dropped.item?.title || 'untitled'}": ${dropped.reason}`);
      }
      for (const item of requiredFilter.kept) {
        if (article.developments.length < MAX_REPORTS) article.developments.push(item);
        else article.europeRoundup.push(item);
      }
    } catch (err) {
      console.warn(`Required-item synthesis failed: ${err.message || err}. The quality gate will block publication if a critical development is still missing.`);
    }
  }

  // Lead reports are the edition's main part. If the model put every
  // qualifying item into Rest of Europe, present them as leads instead of
  // dropping verified intelligence. Nothing is added; only the section changes.
  if (article.developments.length === 0 && article.europeRoundup.length > 0) {
    console.log(`No lead report returned; presenting the ${article.europeRoundup.length} qualifying Rest-of-Europe item(s) as lead reports.`);
    article.developments = article.europeRoundup;
    article.europeRoundup = [];
  }

  // Maximums are capacities: the lowest-ranked overflow is left out - but
  // never the only report covering a required critical development.
  const criticalOwners = criticalGroupOwners(article, criticalGroups);
  for (const [section, max] of [['developments', MAX_REPORTS], ['europeRoundup', MAX_ROUNDUP_REPORTS]]) {
    const { kept, left } = capSection(article[section], max, (item) => criticalOwners.has(item));
    for (const item of left) console.log(`  [over capacity, left out] ${section}: "${item.title}"`);
    article[section] = kept;
  }

  article = attachCriticalGroupSources(article, criticalGroups);

  console.log(`Lead reports: ${article.developments.length}`);
  console.log(`Rest-of-Europe reports: ${article.europeRoundup.length}`);
  if (article.developments.length === 0) {
    await abort('no verified development qualified for publication this week');
    return;
  }

  if (preview) {
    article.seoTitle = `Preview: ${article.seoTitle}`;
    article.metaDescription = `Preview of the DAJC Friday European Oversize & Special Transport Intelligence format. ${article.metaDescription}`;
    article.intro = `PREVIEW EDITION — published early to demonstrate the production Friday format. Friday's final edition will be rebuilt from the complete week's monitoring.\n\n${article.intro}`;
  }

  // A preview is public as soon as it is deployed; the final edition waits
  // for its Friday slot.
  const publishedAt = (preview ? now : publicationSlot).toISOString();
  const updatedAt = correction ? now.toISOString() : null;
  const nextPublicationLabel = formatNextPublicationLabel(publicationSlot);
  const { frontmatter, body } = renderArticleMarkdown(article, { slug, publishedAt, updatedAt, nextPublicationLabel });

  console.log('\nRunning quality gate...');
  const gate = runQualityGate({
    frontmatter,
    body,
    developments: article.developments,
    europeRoundup: article.europeRoundup,
    weekStart: targetWeekStart,
    weekEnd: targetWeekEnd,
    candidatesByUrl,
    eligibilityContext,
    requiredSourceGroups: criticalGroups.map((group) => group.candidates.map((c) => c.sourceUrl)),
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
        `- Lead reports: ${article.developments.length}; Rest of Europe: ${article.europeRoundup.length}`,
        `- Sources cited: ${frontmatter.sources.length}`,
        '- Nothing was committed or pushed.',
      ].join('\n')
    );
    return;
  }

  console.log('\n=== SUCCESS ===');
  console.log(`Article: ${path.relative(ROOT, filePath)}`);
  console.log(`Title: ${frontmatter.title}`);
  console.log(`Lead reports: ${article.developments.length}; Rest of Europe: ${article.europeRoundup.length}`);
  console.log(`Sources cited: ${frontmatter.sources.length}`);
  console.log('\nSuggested commit message:');
  console.log(`  content: publish ${preview ? 'preview ' : ''}EU Oversize Weekly ${nextWeekLabel}`);
  await appendSummary(
    [
      '### EU Oversize Weekly article generated',
      '',
      `- Article: \`${path.relative(ROOT, filePath)}\``,
      `- Title: ${frontmatter.title}`,
      `- Lead reports: ${article.developments.length}; Rest of Europe: ${article.europeRoundup.length}`,
      `- Sources cited: ${frontmatter.sources.length}`,
    ].join('\n')
  );
}

main().catch((err) => {
  console.error('EU Oversize Weekly generator crashed unexpectedly:', err);
  console.error('No article was published; any previously published articles are unaffected.');
  process.exitCode = 1;
});
