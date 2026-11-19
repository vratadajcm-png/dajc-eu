// Deterministic guard against unverified legal-status claims in generated
// Weekly items. The model may only phrase a verified candidate; it must never
// upgrade the legal status the source evidence actually states:
//   - a draft / proposal / consultation must stay visibly pending in the
//     report's own headline and statement of the change;
//   - "entered into force", "adopted", "legally binding" etc. need the same
//     status asserted (not merely anticipated) in the evidence;
//   - an industry (second-hand) report can never be presented as an
//     authority's official confirmation.
// W47 (16 November 2026): an Italian draft Highway Code scheme was written as
// an adopted rule and the independent reviewer had to veto the whole edition.
// This guard removes such an item before review instead. It never adds,
// rewrites or approves anything and never relaxes another gate.
import { PRIMARY_TIER, sourceTier } from './source-policy.mjs';

const ITEM_FIELDS = ['title', 'whatChanged', 'where', 'vehicleScope', 'timeWindow', 'impact', 'recommendedAction', 'exemptions'];
// The fields that state what the rule IS. A pending qualifier must appear in
// each of them; a hedge buried in recommendedAction does not count.
const HEADLINE_FIELDS = ['title', 'whatChanged'];
const EVIDENCE_FIELDS = ['title', 'summary', 'searchSummary', 'impact', 'vehicleScope', 'exemptions'];

// Unicode-aware whole-word matching: JS \b only knows ASCII letters, so
// 'adopté' or 'ordonanță' would never match with a trailing \b.
const L = '[\\p{L}\\p{N}_]';
const words = (terms) => new RegExp(`(?<!${L})(?:${terms.join('|')})(?!${L})`, 'giu');

const PENDING_EVIDENCE = words([
  'drafts?', 'proposal', 'proposed', 'consultation', 'comment procedure', 'public comment',
  'not yet (?:adopted|approved|in force|passed)', '(?:has|have) yet to be (?:adopted|approved|passed)', 'must still approve',
  'under discussion', 'pending (?:approval|adoption)', 'would (?:bar|ban|require|introduce|raise|apply|prohibit)',
  'návrh\\p{L}*', 'připomínkov\\p{L}*', 'Entwurf\\p{L}*', 'Gesetzentwurf\\p{L}*', 'Referentenentwurf',
  'bozza', 'schema di (?:decreto|disegno)', 'disegno di legge', 'projet de (?:loi|décret|decret|arrêté|arrete)',
  'proposition de loi', 'proyecto de (?:ley|real decreto|orden)', 'anteproyecto', 'projekt (?:ustawy|rozporządzenia|rozporzadzenia|zákona|zakona|vyhlášky)',
  'wetsvoorstel', 'ontwerpbesluit', 'förslag', 'forslag', 'tervezet\\p{L}*', 'proiect de (?:lege|ordonanță|ordonanta|hotărâre)',
]);

// Wording that keeps a pending rule visibly pending.
const PENDING_QUALIFIER = words([
  'draft', 'proposal', 'proposed', 'proposes?', 'planned', 'plans? to', 'would', 'bill', 'consultation', 'pending',
  'not yet', 'if (?:adopted|approved|enacted)', 'subject to (?:final )?(?:approval|adoption|government approval|parliamentary approval)',
  'under discussion', 'expected to', 'intends? to',
]);

// Claims of final legal status that need the same status in the evidence.
const FINALITY_CLAIM = words([
  '(?:has|have|had) (?:now )?entered into force', 'has been (?:adopted|enacted|passed|published in the official (?:journal|gazette))',
  'has been approved by (?:parliament|the parliament|the government|the council|the senate)', '(?:was|were) (?:formally )?(?:adopted|enacted|passed)',
  'legally binding', 'has become law', 'became law', 'signed into law',
]);

// Evidence wording that establishes final legal status (multilingual).
const FINALITY_EVIDENCE = words([
  'in force', 'into force', 'adopted', 'enacted', 'approved by (?:parliament|the government|the council)', 'published in the official (?:journal|gazette)',
  'legally binding', 'signed into law', 'became law', 'vstoupil\\p{L}* v platnost', 'nabyl\\p{L}* účinnosti', 'nabývá účinnosti',
  'in Kraft', 'verabschiedet', 'beschlossen', 'entra(?:to)? in vigore', 'in vigore', 'approvat[oa]', 'entre en vigueur', 'entré en vigueur',
  'adopté\\p{L}*', 'entra en vigor', 'entró en vigor', 'aprobad[oa]', 'wchodzi w życie', 'weszł\\p{L}* w życie', 'uchwalon\\p{L}*',
  'treedt in werking', 'in werking getreden', 'aangenomen', 'träder i kraft', 'trådte i kraft', 'hatályba lép\\p{L}*',
  'intră în vigoare', 'intra in vigoare', 'adoptat\\p{L}*',
]);

// An authority's confirmation that a second-hand report cannot provide.
const OFFICIAL_CONFIRMATION = words([
  'officially (?:confirmed|announced|approved|adopted)', 'official confirmation',
  'confirmed by (?:the )?(?:competent )?(?:authority|authorities|ministry|police|government|regulator)',
  '(?:the )?(?:authority|ministry|police|government) (?:has |have )?confirmed',
]);

// A match only counts as an assertion when the words just before it (same
// sentence) do not negate or condition it: "not officially confirmed",
// "pending official confirmation", "once adopted, would enter into force".
const NOT_ASSERTED = /(?<![\p{L}\p{N}_])(?:not|no|never|without|pending|awaiting|yet|would|could|might|may|once|if|unless|until|whether|expected|planned|proposed|set)(?![\p{L}\p{N}_])/iu;
function assertedMatches(regex, text) {
  const found = [];
  for (const match of String(text).matchAll(regex)) {
    const sentence = String(text).slice(0, match.index).split(/[.;!?\n]/).at(-1);
    const lead = sentence.trim().split(/\s+/).slice(-4).join(' ');
    if (!NOT_ASSERTED.test(lead)) found.push(match[0]);
  }
  return found;
}
const has = (regex, text) => { regex.lastIndex = 0; const ok = regex.test(String(text)); regex.lastIndex = 0; return ok; };
const textOf = (record, fields) => fields.map((key) => (typeof record?.[key] === 'string' ? record[key] : '')).join(' \n ');

/**
 * Checks one generated item against the verified candidate behind it.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function checkLegalClaimGrounding(item, candidate) {
  if (!item || !candidate) return { ok: true };
  const generated = textOf(item, ITEM_FIELDS);
  const evidence = textOf(candidate, EVIDENCE_FIELDS);
  const evidenceFinal = assertedMatches(FINALITY_EVIDENCE, evidence).length > 0;
  const evidencePending = has(PENDING_EVIDENCE, evidence) && !evidenceFinal;
  const claims = assertedMatches(FINALITY_CLAIM, generated);
  if (evidencePending) {
    if (claims.length) return { ok: false, reason: `source evidence describes a draft/proposal, but the item claims "${claims[0]}"` };
    const unqualified = HEADLINE_FIELDS.filter((key) => typeof item[key] === 'string' && item[key].trim() && !has(PENDING_QUALIFIER, item[key]));
    if (unqualified.length) return { ok: false, reason: `source evidence describes a draft/proposal, but the item's ${unqualified.join(' and ')} present it as an adopted rule` };
  } else if (claims.length && !evidenceFinal) {
    return { ok: false, reason: `legal-status claim "${claims[0]}" is not stated by the source evidence` };
  }
  const tier = candidate.sourceTier || (candidate.sourceUrl ? sourceTier(candidate.sourceUrl) : PRIMARY_TIER);
  if (tier !== PRIMARY_TIER) {
    const official = assertedMatches(OFFICIAL_CONFIRMATION, generated);
    if (official.length) return { ok: false, reason: `non-official source presented as official confirmation ("${official[0]}")` };
  }
  return { ok: true };
}
