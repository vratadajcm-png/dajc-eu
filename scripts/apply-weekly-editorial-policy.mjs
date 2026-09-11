#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

async function patchIfNeeded(path, { already, needle, replacement }) {
  let text = await readFile(path, 'utf8');
  if (text.includes(already)) {
    console.log(`Editorial policy already present in ${path}`);
    return;
  }
  if (!text.includes(needle)) throw new Error(`Editorial policy patch marker missing in ${path}: ${needle.slice(0, 80)}`);
  text = text.replace(needle, replacement);
  await writeFile(path, text);
  console.log(`Applied DAJC weekly editorial policy to ${path}`);
}

await patchIfNeeded('scripts/lib/relevance-filter.mjs', {
  already: 'completed school/public-building renovation is not current heavy/oversize transport intelligence',
  needle: 'export const NON_RESTRICTION_PATTERNS = [',
  replacement: `export const NON_RESTRICTION_PATTERNS = [\n  {\n    reason: 'completed school/public-building renovation is not current heavy/oversize transport intelligence',\n    pattern: /(?:completion|completed|finished|conclusion).{0,90}(?:school|educational|public building).{0,90}(?:renovation|reconstruction|rehabilitation|infrastructure)|(?:school|educational).{0,90}(?:renovation|reconstruction).{0,90}(?:completed|finished)/i,\n  },\n  {\n    reason: 'generic completed civic project without a current transport restriction or abnormal-load consequence',\n    pattern: /(?:completed|completion of).{0,100}(?:school infrastructure|school reconstruction|urban beautification|public-space renovation)/i,\n  },`,
});

await patchIfNeeded('scripts/lib/select-candidates.mjs', {
  already: 'DAJC operator-first presentation preference',
  needle: '    if (f.recommendedAction) score += 1;\n    return { finding: f, score };',
  replacement: `    if (f.recommendedAction) score += 1;\n    const country = String(f.country || '');\n    if (/^(czechia|czech republic|germany|austria|slovakia|poland|hungary|switzerland|slovenia)$/i.test(country)) score += 12;\n    else if (/^(croatia|italy|france|belgium|netherlands|luxembourg|romania)$/i.test(country)) score += 5;\n    return { finding: f, score };`,
});

await patchIfNeeded('scripts/lib/openai-client.mjs', {
  already: 'For the PUBLISHED LEAD ORDER, however, DAJC is operator-first',
  needle: 'GEOGRAPHIC PRINCIPLE\nThe upstream DAJC monitor is intended to scan the complete DAJC European coverage area, including smaller countries, territories and relevant jurisdictions. Never favour EU, Schengen, DACH, Western Europe or major transit markets merely because they publish more English-language material. Selection is evidence-led and operational-impact-led.',
  replacement: `GEOGRAPHIC PRINCIPLE\nThe upstream DAJC monitor scans the complete DAJC European coverage area, including smaller countries, territories and relevant jurisdictions. Coverage remains Europe-wide and evidence-led. For the PUBLISHED LEAD ORDER, however, DAJC is operator-first: place verified, substantive developments from the wider Central-European transport core first when available — Czechia, Germany, Austria, Slovakia, Poland, Hungary, Switzerland and Slovenia — followed by directly connected high-value transit corridors, then the rest of Europe. This ordering must never promote weak material over a materially more important verified change. Peripheral territories such as Madeira, Guernsey, Jersey, Monaco or similar jurisdictions belong later in the article/Rest of Europe unless a genuinely critical exceptional-transport event justifies elevation.`,
});

await patchIfNeeded('scripts/lib/openai-client.mjs', {
  already: "Then apply DAJC's lead-order geography",
  needle: 'Rank findings by operational impact, relevance to abnormal/heavy transport, urgency, geographic reach, magnitude, evidence quality, novelty, and effect on routing, permits, timing, cost or feasibility.',
  replacement: `Rank findings first by operational impact, relevance to abnormal/heavy transport, urgency, evidence quality, novelty, and effect on routing, permits, timing, cost or feasibility. Then apply DAJC's lead-order geography: wider Central Europe first among substantively comparable items, connected European corridors next, peripheral jurisdictions later. A newly discovered old page is NOT fresh news. Exclude completed civic/school projects, stale archive material, generic infrastructure achievements and any item whose only relevance is that road access might theoretically improve.`,
});

console.log('DAJC weekly editorial policy applied successfully.');
