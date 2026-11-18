// Deterministic guard against unverified legal-status claims in generated
// Weekly items. The model may only phrase a verified candidate; it must never
// upgrade the legal status the source evidence actually states:
//   - a draft / proposal / consultation must stay visibly pending;
//   - "entered into force", "adopted", "legally binding" etc. need the same
//     status in the evidence itself;
//   - an industry (second-hand) report can never be presented as an
//     authority's official confirmation.
// W47 (16 November 2026): an Italian draft Highway Code scheme was written as
// an adopted rule and the independent reviewer had to veto the whole edition.
// This guard removes such an item before review instead. It never adds,
// rewrites or approves anything and never relaxes another gate.

const ITEM_FIELDS = ['title', 'whatChanged', 'where', 'vehicleScope', 'timeWindow', 'impact', 'recommendedAction', 'exemptions'];
const EVIDENCE_FIELDS = ['title', 'summary', 'searchSummary', 'impact', 'vehicleScope', 'exemptions'];

// Evidence that the reported rule is not (yet) law. Multilingual because the
// monitor keeps the original page excerpt next to the English search summary.
const PENDING_EVIDENCE = new RegExp([
  '\\bdraft(?:ed|s)?\\b', '\\bproposal\\b', '\\bproposed\\b', '\\bconsultation\\b', '\\bcomment procedure\\b',
  '\\bpublic comment\\b', '\\bnot yet (?:adopted|approved|in force|passed)\\b', '\\b(?:still )?(?:has|have|must) (?:still )?(?:to )?(?:be )?approv',
  '\\bmust still approve\\b', '\\bunder discussion\\b', '\\bpending (?:approval|adoption)\\b', '\\bwould (?:bar|ban|require|introduce|raise|apply|prohibit)\\b',
  '\\bnávrh\\w*', '\\bnávrhu\\b', '\\bpřipomínkov\\w*', '\\bEntwurf\\w*', '\\bGesetzentwurf\\w*', '\\bReferentenentwurf\\b',
  '\\bbozza\\b', '\\bschema di (?:decreto|disegno)\\b', '\\bdisegno di legge\\b', '\\bprojet de (?:loi|décret|decret|arrêté|arrete)\\b',
  '\\bproposition de loi\\b', '\\bproyecto de (?:ley|real decreto|orden)\\b', '\\banteproyecto\\b', '\\bprojekt (?:ustawy|rozporządzenia|rozporzadzenia|zákona|zakona|vyhlášky)\\b',
  '\\bwetsvoorstel\\b', '\\bontwerpbesluit\\b', '\\bförslag\\b', '\\bforslag\\b', '\\btervezet\\w*', '\\bproiect de (?:lege|ordonanță|ordonanta|hotărâre)\\b',
].join('|'), 'i');

// Wording in the generated item that keeps a pending rule visibly pending.
const PENDING_QUALIFIER = /\b(?:draft|proposal|proposed|propose[sd]?|planned|plans? to|would|bill|consultation|pending|not yet|if (?:adopted|approved|enacted)|subject to (?:final )?(?:approval|adoption|government approval|parliamentary approval)|under discussion|expected to|intends? to|scheme)\b/i;

// Claims of final legal status that need the same status in the evidence.
const FINALITY_CLAIM = /\b(?:(?:has|have|had) (?:now )?entered into force|has been (?:adopted|enacted|passed|published in the official (?:journal|gazette))|has been approved by (?:parliament|the parliament|the government|the council|the senate)|(?:was|were) (?:formally )?(?:adopted|enacted|passed)|legally binding|has become law|became law|signed into law)\b/i;

// Evidence wording that establishes final legal status (multilingual).
const FINALITY_EVIDENCE = /\b(?:in force|into force|entered into force|enters into force|adopted|enacted|approved by (?:parliament|the government|the council)|published in the official (?:journal|gazette)|legally binding|signed into law|became law|vstoupil\w* v platnost|nabyl\w* účinnosti|nabývá účinnosti|in Kraft|tritt\w* .{0,40}in Kraft|verabschiedet|beschlossen|entra(?:to)? in vigore|in vigore|approvat[oa]|entre en vigueur|entré en vigueur|adopté\w*|entra en vigor|entró en vigor|aprobad[oa]|wchodzi w życie|weszł\w* w życie|uchwalon\w*|treedt in werking|in werking getreden|aangenomen|träder i kraft|trådte i kraft|hatályba lép\w*|intră în vigoare|intra in vigoare|adoptat\w*)\b/i;

// An authority's confirmation that a second-hand report cannot provide.
const OFFICIAL_CONFIRMATION = /\b(?:officially (?:confirmed|announced|approved|adopted)|official confirmation|confirmed by (?:the )?(?:competent )?(?:authority|authorities|ministry|police|government|regulator)|(?:the )?(?:authority|ministry|police|government) (?:has |have )?confirmed)\b/i;

const textOf = (record, fields) => fields.map((key) => (typeof record?.[key] === 'string' ? record[key] : '')).join(' \n ');

/**
 * Checks one generated item against the verified candidate behind it.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function checkLegalClaimGrounding(item, candidate) {
  if (!item || !candidate) return { ok: true };
  const generated = textOf(item, ITEM_FIELDS);
  const evidence = textOf(candidate, EVIDENCE_FIELDS);
  if (PENDING_EVIDENCE.test(evidence) && !PENDING_QUALIFIER.test(generated)) {
    return { ok: false, reason: 'source evidence describes a draft/proposal, but the item presents it as an adopted rule' };
  }
  const finality = generated.match(FINALITY_CLAIM);
  if (finality && !FINALITY_EVIDENCE.test(evidence)) {
    return { ok: false, reason: `legal-status claim "${finality[0]}" is not stated by the source evidence` };
  }
  if (candidate.sourceTier !== 'official') {
    const official = generated.match(OFFICIAL_CONFIRMATION);
    if (official) return { ok: false, reason: `non-official source presented as official confirmation ("${official[0]}")` };
  }
  return { ok: true };
}
