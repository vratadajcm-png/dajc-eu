// OpenAI synthesis layer for DAJC European Oversize & Special Transport Intelligence.
// Input candidates have already passed source verification. The model may only
// select, structure and phrase those candidates; source URLs are cross-validated
// again after generation before publication.

import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-4o';

const DEVELOPMENT_SCHEMA = {
  type: 'object',
  properties: {
    country: { type: 'string' },
    title: { type: 'string' },
    whatChanged: { type: 'string' },
    where: { type: 'string' },
    vehicleScope: { type: 'string' },
    timeWindow: { type: 'string' },
    validFrom: {
      type: ['string', 'null'],
      description: 'Exact YYYY-MM-DD copied from the supplied verified candidate, or null when the candidate has no exact date. Never use prose such as Ongoing, Indefinite, Immediate or Pending.',
    },
    validTo: {
      type: ['string', 'null'],
      description: 'Exact YYYY-MM-DD copied from the supplied verified candidate, or null when the candidate has no exact date. Never use prose such as Ongoing, Indefinite, Immediate or Pending.',
    },
    impact: { type: 'string' },
    recommendedAction: { type: 'string' },
    exemptions: { type: 'string' },
    isDrivingBan: { type: 'boolean' },
    isInfrastructure: { type: 'boolean' },
    sourceUrl: { type: 'string', description: 'Copy EXACTLY from a supplied candidate.' },
    sourceName: { type: 'string', description: 'Copy EXACTLY from a supplied candidate.' },
  },
  required: ['country','title','whatChanged','where','vehicleScope','timeWindow','validFrom','validTo','impact','recommendedAction','exemptions','isDrivingBan','isInfrastructure','sourceUrl','sourceName'],
  additionalProperties: false,
};

const LEAD_SUPPLEMENT_SCHEMA = {
  name: 'dajc_lead_supplement',
  strict: true,
  schema: {
    type: 'object',
    properties: { items: { type: 'array', items: DEVELOPMENT_SCHEMA } },
    required: ['items'],
    additionalProperties: false,
  },
};

const ROUNDUP_SUPPLEMENT_SCHEMA = {
  name: 'dajc_europe_roundup_supplement',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      items: { type: 'array', items: DEVELOPMENT_SCHEMA },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

const ARTICLE_JSON_SCHEMA = {
  name: 'dajc_european_oversize_intelligence',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      seoTitle: { type: 'string' },
      metaDescription: { type: 'string' },
      intro: { type: 'string' },
      developments: {
        type: 'array',
        items: DEVELOPMENT_SCHEMA,
        description: 'Up to 30 substantive verified lead developments (20-30 when enough genuine material exists; fewer is acceptable). Never pad with routine or irrelevant material.',
      },
      europeRoundup: {
        type: 'array',
        items: DEVELOPMENT_SCHEMA,
        description: 'Up to 20 concise verified Rest-of-Europe updates, as geographically broad as the material allows. Fewer is acceptable. Never duplicate leads.',
      },
      operatorChecklist: { type: 'array', items: { type: 'string' } },
    },
    required: ['seoTitle','metaDescription','intro','developments','europeRoundup','operatorChecklist'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are the editor of DAJC European Oversize & Special Transport Intelligence for DAJC.eu.

This is a professional, change-driven Europe-wide intelligence report for people planning and executing heavy, abnormal, oversized and special road transport. It is NOT a generic trucking-news site and NOT a calendar of unchanged recurring restrictions.

GEOGRAPHIC PRINCIPLE
The upstream DAJC monitor scans the complete DAJC European coverage area, including smaller countries, territories and relevant jurisdictions. Coverage remains Europe-wide and evidence-led. For the PUBLISHED LEAD ORDER, however, DAJC is operator-first: place verified, substantive developments from the wider Central-European transport core first when available — Czechia, Germany, Austria, Slovakia, Poland, Hungary, Switzerland and Slovenia — followed by directly connected high-value transit corridors, then the rest of Europe. This ordering must never promote weak material over a materially more important verified change. Peripheral territories such as Madeira, Guernsey, Jersey, Monaco or similar jurisdictions belong later in the article/Rest of Europe unless a genuinely critical exceptional-transport event justifies elevation.

PUBLIC OUTPUT RULE — INTERNAL EDITORIAL MECHANICS MUST NEVER APPEAR IN PUBLIC TEXT
The reader must never see internal DAJC publishing mechanics. Do not mention candidate/report counts, target counts such as 20–30 or 10–15, editorial thresholds, quality gates, retries, verification pool size, source-pool insufficiency, padding/filler decisions, workflow behavior, or why an edition contains fewer items. These rules are internal only. Public copy should contain operational intelligence and user-facing context, not commentary about how DAJC generated or selected the article.

EDITORIAL SCOPE
Relevant subjects include abnormal/oversize permits; heavy-transport weight and axle rules; exceptional restrictions; escort/private escort/police escort requirements; route authorisations; bridges/tunnels and structural restrictions; dimensions and axle loads; borders/customs/non-EU transit; long-term special-transport-relevant roadworks; ports/ferries/RoRo/project cargo; weather restrictions; wind/heat/snow limits; permit digitalisation; tolling; abnormal-load portals; routing systems; e-CMR; tachograph/enforcement; ADR where relevant; heavy-haul tractors; low-loaders/modular trailers/SPMTs; cranes; escort technology; telematics/routing APIs; AI tools; manufacturers; material acquisitions/insolvencies/capacity shifts; and major energy/industrial/infrastructure projects that generate abnormal-load demand.

DRIVING-BAN FILTER — CRITICAL
General HGV/truck driving bans — weekend, Sunday, public-holiday, seasonal, summer and transit bans — are published separately in the DAJC Driving Bans calendar (dajc.eu/driving-bans). Do NOT include them in this report, even when they are new, seasonal or holiday-specific.
Include a ban or movement restriction only when the supplied evidence explicitly scopes it to exceptional, oversize, abnormal or special transport (e.g. a convoi exceptionnel weekend movement ban, an exceptional-transport stoppage on a specific motorway, or new escort/permit conditions attached to a ban). Never infer that a general HGV ban is specific to exceptional transport.

INFRASTRUCTURE FILTER
Do not repeat unchanged long-term restrictions every week. Re-report them only when newly announced, beginning, changed, extended, ending, materially worsening/improving, when the diversion or authorised abnormal-load route changes, or when a weight/width/height/axle condition changes. Ordinary short roadworks should normally be excluded unless their effect on special transport is critical. Road or motorway closures are publishable ONLY when the supplied verified evidence proves a planned duration longer than 30 days. No exception: a 30-day closure, a shorter closure, or an undated closure with no provable duration must be excluded.

VERIFICATION / NON-INFERENCE RULES
1. Use only supplied verified candidates. Never invent a development, route, limit, date, exemption or source.
2. sourceUrl and sourceName MUST be copied EXACTLY from a supplied candidate.
3. validFrom and validTo MUST be copied exactly when the candidate supplies an ISO YYYY-MM-DD date; otherwise return null. Never replace an unknown date with prose such as Ongoing, Indefinite, Immediate, Pending, a sentence, or punctuation.
4. Never infer that a general HGV restriction applies to abnormal transport. State permit-specific uncertainty when applicability is not confirmed.
5. Never infer that a general exemption applies to abnormal transport.
6. Exclude isolated accidents, broken-down vehicles, theft reports and routine incidents.
7. Procurement/tender notices are not traffic restrictions.
8. Planned works are not restrictions unless a concrete operational effect and dates are confirmed.
9. Use exact dates and local times where supplied. Distinguish publication date from effective date.
10. Every published item must answer: Why does this matter to someone planning or executing heavy, abnormal, oversized or special transport in Europe? If there is no meaningful answer, exclude it.
11. Do not repeat unchanged information merely because it appeared in an official annual calendar.

SELECTION
Rank findings first by operational impact, relevance to abnormal/heavy transport, urgency, evidence quality, novelty, and effect on routing, permits, timing, cost or feasibility. Then apply DAJC's lead-order geography: wider Central Europe first among substantively comparable items, connected European corridors next, peripheral jurisdictions later. A newly discovered old page is NOT fresh news. Exclude completed civic/school projects, stale archive material, generic infrastructure achievements and any item whose only relevance is that road access might theoretically improve.
Return up to 30 distinct substantive lead reports — 20-30 when enough genuinely worthwhile verified material exists. Fewer is acceptable and the edition is still published. Never satisfy a count with general driving bans, generic administration, old statistics or marginal filler.

AROUND EUROPE
Place additional verified useful developments in europeRoundup: up to 20 concise short updates, as geographically broad as the verified material allows. Fewer is acceptable. Do not manufacture geographic balance and never use driving bans as filler. Prefer a meaningful finding from a smaller/less-covered jurisdiction over a marginal story from an already dominant major market.

STYLE
Write practical professional English. Each lead must contain concrete What changed / Where / When / Impact / Action information through the structured fields. No marketing filler and no clickbait body copy.`;

export async function generateArticleWithOpenAI({ candidates, weekRangeLabel, targetWeekStart, targetWeekEnd, apiKey, model }) {
  const client = new OpenAI({ apiKey });
  const mapped = candidates.slice(0, 60).map((c) => ({
    country: c.country,
    location: c.location,
    type: c.type,
    title: c.title,
    summary: String(c.summary || '').slice(0, 1200),
    validFrom: c.validFrom || null,
    validTo: c.validTo || null,
    vehicleScope: c.vehicleScope || '',
    timeWindow: c.timeWindow || '',
    routeScope: c.routeScope || c.location || '',
    impact: c.impact || '',
    recommendedAction: c.recommendedAction || '',
    exemptions: c.exemptions || '',
    isDrivingBan: Boolean(c.isDrivingBan || c.type === 'driving_ban'),
    isInfrastructure: Boolean(c.isInfrastructure || /bridge|tunnel|road_closure|roadworks|route_restriction|infrastructure/.test(c.type || '')),
    isOfficialCalendar: Boolean(c.isOfficialCalendar),
    sourceUrl: c.sourceUrl,
    sourceName: c.sourceName,
  }));

  const response = await client.chat.completions.create({
    model: model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Target publication window: ${targetWeekStart} to ${targetWeekEnd} (${weekRangeLabel}). Select only operationally relevant verified material. Do not include general HGV driving bans; they belong to the separate Driving Bans calendar.\n\nVerified candidates (JSON):\n${JSON.stringify(mapped, null, 2)}` },
    ],
    response_format: { type: 'json_schema', json_schema: ARTICLE_JSON_SCHEMA },
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI response contained no content');
  return JSON.parse(text);
}

function roundupCandidateScore(candidate) {
  const typeScore = {
    escort_requirement: 40, police_escort: 40, permit_system: 36, permit_change: 34,
    border_restriction: 32, weight_restriction: 30, axle_load_restriction: 30,
    height_restriction: 30, width_restriction: 30, bridge_restriction: 28,
    tunnel_restriction: 28, route_restriction: 28, toll_change: 26,
    port_restriction: 24, ferry_restriction: 24, legislation: 24,
    digitalisation: 22, enforcement: 20, project_cargo: 18, equipment: 16,
    market: 12, infrastructure: 8,
  }[candidate.type] || 0;
  const text = `${candidate.title || ''} ${candidate.summary || ''}`;
  let score = typeScore;
  if (/exceptional transport|oversize|abnormal load|ausnahmetransport|schwertransport|convoi exceptionnel|trasporto eccezionale|transporte especial/i.test(text)) score += 30;
  if (/escort|begleit|pilot vehicle|doprovod|accompagnement/i.test(text)) score += 24;
  if (/toll|vignette|road user charge|m[aý]to|maut|péage|pedaggio|peaje/i.test(text)) score += 16;
  if (candidate.status === 'new' || candidate.status === 'updated') score += 8;
  return score;
}

export async function generateRoundupSupplementWithOpenAI({
  candidates, targetWeekStart, targetWeekEnd, apiKey,
  existingCountries = [], neededCountries = 0, neededReports = 0, model,
}) {
  if (!candidates.length || (neededCountries <= 0 && neededReports <= 0)) return [];
  const client = new OpenAI({ apiKey });
  const ranked = [...candidates].sort((a,b)=>roundupCandidateScore(b)-roundupCandidateScore(a)).slice(0, 40);
  const payload = ranked.map((c) => ({
    country:c.country, location:c.location, type:c.type, title:c.title,
    summary:String(c.summary || '').slice(0,900), validFrom:c.validFrom || null, validTo:c.validTo || null,
    vehicleScope:c.vehicleScope || '', timeWindow:c.timeWindow || '',
    routeScope:c.routeScope || c.location || '', impact:c.impact || '',
    recommendedAction:c.recommendedAction || '', exemptions:c.exemptions || '',
    isDrivingBan:Boolean(c.isDrivingBan || c.type === 'driving_ban'),
    isInfrastructure:Boolean(c.isInfrastructure || /bridge|tunnel|road_closure|roadworks|route_restriction|infrastructure/.test(c.type || '')),
    sourceUrl:c.sourceUrl, sourceName:c.sourceName,
  }));
  const response = await client.chat.completions.create({
    model: model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages: [
      { role:'system', content:'Fill only DAJC Rest of Europe from verified unused candidates. Return concise, operationally useful heavy/oversize/special-road-transport items. First add missing distinct jurisdictions, then fill the report count. Never use general driving bans, generic administration, old statistics, short/undated closures, crime, accidents, procurement or filler. Copy sourceUrl/sourceName EXACTLY from supplied candidates. Copy validFrom/validTo only when supplied as exact ISO YYYY-MM-DD dates; otherwise return null.' },
      { role:'user', content:`Target week ${targetWeekStart} to ${targetWeekEnd}. Existing countries: ${existingCountries.join(', ') || 'none'}. Need at least ${neededCountries} additional jurisdictions and ${neededReports} additional reports. Return up to 16 items.\n\nVerified unused candidates:\n${JSON.stringify(payload)}` },
    ],
    response_format:{ type:'json_schema', json_schema:ROUNDUP_SUPPLEMENT_SCHEMA },
  });
  const text = response.choices?.[0]?.message?.content;
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

export async function generateLeadSupplementWithOpenAI({
  candidates, targetWeekStart, targetWeekEnd, apiKey, neededReports = 0, model,
}) {
  if (!candidates.length || neededReports <= 0) return [];
  const client = new OpenAI({ apiKey });
  const payload = candidates.slice(0, 36).map((c) => ({
    country:c.country, location:c.location, type:c.type, title:c.title,
    summary:String(c.summary || '').slice(0,1000), validFrom:c.validFrom || null, validTo:c.validTo || null,
    vehicleScope:c.vehicleScope || '', timeWindow:c.timeWindow || '',
    routeScope:c.routeScope || c.location || '', impact:c.impact || '',
    recommendedAction:c.recommendedAction || '', exemptions:c.exemptions || '',
    isDrivingBan:Boolean(c.isDrivingBan || c.type === 'driving_ban'),
    isInfrastructure:Boolean(c.isInfrastructure || /bridge|tunnel|road_closure|roadworks|route_restriction|infrastructure/.test(c.type || '')),
    sourceUrl:c.sourceUrl, sourceName:c.sourceName,
  }));
  const response = await client.chat.completions.create({
    model: model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages: [
      { role:'system', content:'Select additional LEAD reports for DAJC European Oversize & Special Transport Intelligence only from supplied verified unused candidates. Each must be substantive and operationally relevant to heavy, abnormal, oversized or special road transport. Never use general driving bans, generic administration, statistics, accidents/crime, procurement, short or undated road closures, or filler. Copy sourceUrl/sourceName EXACTLY. Copy validFrom/validTo only when supplied as exact ISO YYYY-MM-DD dates; otherwise return null.' },
      { role:'user', content:`Target week ${targetWeekStart} to ${targetWeekEnd}. Return up to ${neededReports} additional substantive lead reports. Return fewer if genuine material is insufficient.\n\nVerified unused candidates:\n${JSON.stringify(payload)}` },
    ],
    response_format:{ type:'json_schema', json_schema:LEAD_SUPPLEMENT_SCHEMA },
  });
  const text = response.choices?.[0]?.message?.content;
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.items) ? parsed.items : [];
}
