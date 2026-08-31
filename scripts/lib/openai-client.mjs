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
    validFrom: { type: 'string' },
    validTo: { type: 'string' },
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
        description: '20-30 substantive verified lead developments. Minimum 20. Never pad with routine or irrelevant material.',
      },
      europeRoundup: {
        type: 'array',
        items: DEVELOPMENT_SCHEMA,
        description: '10-20 concise verified Rest-of-Europe updates, spanning at least 6 distinct countries/jurisdictions. Minimum 10. Never duplicate leads.',
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
The upstream DAJC monitor is intended to scan the complete DAJC European coverage area, including smaller countries, territories and relevant jurisdictions. Never favour EU, Schengen, DACH, Western Europe or major transit markets merely because they publish more English-language material. Selection is evidence-led and operational-impact-led.

EDITORIAL SCOPE
Relevant subjects include abnormal/oversize permits; heavy-transport weight and axle rules; exceptional restrictions; escort/private escort/police escort requirements; route authorisations; bridges/tunnels and structural restrictions; dimensions and axle loads; borders/customs/non-EU transit; long-term special-transport-relevant roadworks; ports/ferries/RoRo/project cargo; weather restrictions; wind/heat/snow limits; permit digitalisation; tolling; abnormal-load portals; routing systems; e-CMR; tachograph/enforcement; ADR where relevant; heavy-haul tractors; low-loaders/modular trailers/SPMTs; cranes; escort technology; telematics/routing APIs; AI tools; manufacturers; material acquisitions/insolvencies/capacity shifts; and major energy/industrial/infrastructure projects that generate abnormal-load demand.

DRIVING-BAN FILTER — CRITICAL
DO NOT publish an ordinary recurring year-round Sunday driving ban when nothing has changed. A permanent Sunday prohibition must not be repeated every week merely because it falls inside the target week.
Include driving-ban information only when it is materially newsworthy for the edition: a new or changed prohibition; public-holiday prohibition; seasonal/summer/winter restriction; exceptional/emergency/weather-related restriction; temporary regional restriction; changed time window or affected vehicle/weight class; new/cancelled/suspended exemption; newly announced enforcement measure; or a specific consequence for abnormal/oversize transport. A recurring Sunday ban may be mentioned only when needed to explain a material interaction with a holiday, seasonal rule, permit condition or other new operational constraint.

INFRASTRUCTURE FILTER
Do not repeat unchanged long-term restrictions every week. Re-report them only when newly announced, beginning, changed, extended, ending, materially worsening/improving, when the diversion or authorised abnormal-load route changes, or when a weight/width/height/axle condition changes. Ordinary short roadworks should normally be excluded unless their effect on special transport is critical. Road or motorway closures are publishable ONLY when the supplied verified evidence proves a planned duration longer than 30 days. No exception: a 30-day closure, a shorter closure, or an undated closure with no provable duration must be excluded.

VERIFICATION / NON-INFERENCE RULES
1. Use only supplied verified candidates. Never invent a development, route, limit, date, exemption or source.
2. sourceUrl and sourceName MUST be copied EXACTLY from a supplied candidate.
3. Never infer that a general HGV restriction applies to abnormal transport. State permit-specific uncertainty when applicability is not confirmed.
4. Never infer that a general exemption applies to abnormal transport.
5. Exclude isolated accidents, broken-down vehicles, theft reports and routine incidents.
6. Procurement/tender notices are not traffic restrictions.
7. Planned works are not restrictions unless a concrete operational effect and dates are confirmed.
8. Use exact dates and local times where supplied. Distinguish publication date from effective date.
9. Every published item must answer: Why does this matter to someone planning or executing heavy, abnormal, oversized or special transport in Europe? If there is no meaningful answer, exclude it.
10. Do not repeat unchanged information merely because it appeared in an official annual calendar.

SELECTION
Rank findings by operational impact, relevance to abnormal/heavy transport, urgency, geographic reach, magnitude, evidence quality, novelty, and effect on routing, permits, timing, cost or feasibility.
Return 20-30 distinct substantive lead reports. Twenty is the hard editorial minimum for a publishable DAJC Weekly edition. Never satisfy the count with routine Sunday bans, generic administration, old statistics or marginal filler; if fewer than 20 genuinely worthwhile verified candidates exist, return fewer and let the downstream quality gate block publication.

AROUND EUROPE
Place additional verified useful developments in europeRoundup. Return at least 10 concise short updates and cover at least 6 distinct countries/territories; 10 reports and 6 jurisdictions are hard publication minimums. Do not manufacture geographic balance and never use unchanged Sunday bans as filler. Prefer a meaningful finding from a smaller/less-covered jurisdiction over a marginal story from an already dominant major market.

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
    validFrom: c.validFrom,
    validTo: c.validTo,
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
      { role: 'user', content: `Target publication window: ${targetWeekStart} to ${targetWeekEnd} (${weekRangeLabel}). Select only operationally relevant verified material. Do not repeat unchanged year-round Sunday bans.\n\nVerified candidates (JSON):\n${JSON.stringify(mapped, null, 2)}` },
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
    summary:String(c.summary || '').slice(0,900), validFrom:c.validFrom, validTo:c.validTo,
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
      { role:'system', content:'Fill only DAJC Rest of Europe from verified unused candidates. Return concise, operationally useful heavy/oversize/special-road-transport items. First add missing distinct jurisdictions, then fill the report count. Never use routine Sunday bans, generic administration, old statistics, short/undated closures, crime, accidents, procurement or filler. Copy sourceUrl/sourceName EXACTLY from supplied candidates.' },
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
    summary:String(c.summary || '').slice(0,1000), validFrom:c.validFrom, validTo:c.validTo,
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
      { role:'system', content:'Select additional LEAD reports for DAJC European Oversize & Special Transport Intelligence only from supplied verified unused candidates. Each must be substantive and operationally relevant to heavy, abnormal, oversized or special road transport. Never use routine Sunday bans, generic administration, statistics, accidents/crime, procurement, short or undated road closures, or filler. Copy sourceUrl/sourceName EXACTLY.' },
      { role:'user', content:`Target week ${targetWeekStart} to ${targetWeekEnd}. Need up to ${neededReports} additional substantive lead reports to reach the 20-report minimum. Return fewer if genuine material is insufficient.\n\nVerified unused candidates:\n${JSON.stringify(payload)}` },
    ],
    response_format:{ type:'json_schema', json_schema:LEAD_SUPPLEMENT_SCHEMA },
  });
  const text = response.choices?.[0]?.message?.content;
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.items) ? parsed.items : [];
}
