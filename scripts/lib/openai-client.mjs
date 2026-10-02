// OpenAI synthesis layer for DAJC European Oversize & Special Transport Intelligence.
// Input candidates have already passed source verification. The model may only
// select, structure and phrase those candidates; source URLs are cross-validated
// again after generation before publication.

import OpenAI from 'openai';
import { readableText } from './text-quality.mjs';

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

const REQUIRED_ITEMS_SCHEMA = {
  name: 'dajc_required_items',
  strict: true,
  schema: {
    type: 'object',
    properties: { items: { type: 'array', items: DEVELOPMENT_SCHEMA } },
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
        description: 'Substantive verified lead developments, most important first. Maximum 30. There is no minimum: include only candidates that pass every editorial rule.',
      },
      europeRoundup: {
        type: 'array',
        items: DEVELOPMENT_SCHEMA,
        description: 'Additional concise verified updates. Maximum 15. There is no minimum and no country quota: an empty array is correct when nothing further qualifies. Never duplicate leads.',
      },
      operatorChecklist: { type: 'array', items: { type: 'string' } },
    },
    required: ['seoTitle','metaDescription','intro','developments','europeRoundup','operatorChecklist'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are the editor of DAJC European Oversize & Special Transport Intelligence for DAJC.eu.

This is a professional, change-driven Europe-wide weekly intelligence briefing for people planning and executing heavy, abnormal, oversized and special road transport. It is NOT a generic trucking-news site, NOT a roadworks list and NOT a calendar of recurring restrictions.

QUALITY OVER COUNT — CRITICAL
There is NO minimum number of reports. Include a candidate only when it passes every rule below. A well-supplied week can fill up to 30 lead reports and up to 15 Rest-of-Europe updates, but these are capacities, never quotas: if 6 candidates qualify, return 6; if nothing qualifies for Rest of Europe, return an empty europeRoundup; if nothing qualifies at all, return empty arrays. Never add an old, generic, marginal or weakly relevant item to make a section look fuller. Never split one development into several reports. If any item qualifies, the most important ones belong in developments (never return an empty developments array together with a non-empty europeRoundup).

GEOGRAPHIC PRINCIPLE
The upstream DAJC monitor scans the complete DAJC European coverage area, including smaller countries, territories and relevant jurisdictions. Coverage remains Europe-wide and evidence-led. For the PUBLISHED LEAD ORDER, however, DAJC is operator-first: place verified, substantive developments from the wider Central-European transport core first when available — Czechia, Germany, Austria, Slovakia, Poland, Hungary, Switzerland and Slovenia — followed by directly connected high-value transit corridors, then the rest of Europe. This ordering must never promote weak material over a materially more important verified change. Peripheral territories such as Madeira, Guernsey, Jersey, Monaco or similar jurisdictions belong later in the article/Rest of Europe unless a genuinely critical exceptional-transport event justifies elevation. There is no country quota: never include an item to add a country.

PUBLIC OUTPUT RULE — INTERNAL EDITORIAL MECHANICS MUST NEVER APPEAR IN PUBLIC TEXT
The reader must never see internal DAJC publishing mechanics. Do not mention candidate/report counts, capacities such as 30 or 15, editorial thresholds, quality gates, retries, verification pool size, source-pool insufficiency, padding/filler decisions, workflow behavior, or why an edition contains fewer items. Public copy contains operational intelligence and user-facing context only.

FRESHNESS
Each candidate carries publishedAt (the date the official source published it) and, where the source states them, validFrom/validTo (the dates the change applies). Discovery by DAJC is never news. Report what is current: a recent official announcement; a change that takes effect, ends or materially changes in the target week; an explicitly dated restriction in force during the target week; or a change taking effect within 30 days after the target week (a clearly dated outlook item). A newly discovered old page is NOT news. Never present an old announcement, an evergreen information page, a project description, a price list, a statistics release or a general authority page as this week's development.

EDITORIAL SCOPE
Relevant subjects include abnormal/oversize permits and permit systems; heavy-transport weight, axle and dimension rules; exceptional-transport movement conditions; escort/private escort/police escort requirements; route authorisations; bridges/tunnels and structural restrictions affecting heavy vehicles; borders/customs/non-EU transit for goods traffic; long-term (>30 days) closures of routes used by heavy transport; ports/ferries/RoRo/project cargo; weather-related heavy-vehicle restrictions; permit digitalisation and abnormal-load portals; truck tolling; e-CMR, tachograph and enforcement rules; ADR where relevant; heavy-haul equipment (low-loaders, modular trailers, SPMTs, cranes); and major energy/industrial/infrastructure projects only when they create concrete abnormal-load movements or restrictions.

DRIVING BANS — OUT OF SCOPE
General HGV/truck driving bans — Sunday, weekend, public-holiday, seasonal, summer, night, transit or holiday-traffic bans, annually repeated bans, standard >7.5 t restrictions, whether new or recurring — are covered by DAJC's separate Driving Bans service and must NOT appear in this briefing ("Trucks >7.5 t prohibited on Sunday" is not Weekly news). Include a movement restriction only when the official evidence explicitly scopes it to exceptional/abnormal/oversize/special transport (for example "Ausnahmetransporte prohibited...", a changed movement window for abnormal loads, a convoy, escort or police-escort rule, a permit-specific condition or an abnormal-load corridor).

INFRASTRUCTURE FILTER
Do not repeat unchanged long-term restrictions. Report them only when newly announced, beginning, changed, extended, ending, materially worsening/improving, when the diversion or authorised abnormal-load route changes, or when a weight/width/height/axle condition changes. Ordinary short roadworks and local closures are excluded. Road or motorway closures and roadworks are publishable ONLY when the supplied verified evidence proves a planned duration longer than 30 days. No exception for important corridors: a 30-day closure, a shorter closure, or an undated closure with no provable duration must be excluded. Genuine weight/height/width/axle-load, permit, escort or abnormal-load-corridor restrictions are judged on their operational impact instead. Completed projects and openings, pedestrian/cycling facilities, school/civic/public-space projects, PR/event items, construction-site equipment, market/financial news and general infrastructure achievements are not heavy-transport intelligence.

VERIFICATION / NON-INFERENCE RULES
1. Use only supplied verified candidates. Never invent a development, route, limit, date, exemption or source.
2. sourceUrl and sourceName MUST be copied EXACTLY from a supplied candidate. Use each candidate at most once.
3. validFrom and validTo MUST be copied exactly when the candidate supplies an ISO YYYY-MM-DD date; otherwise return null. Never replace an unknown date with prose such as Ongoing, Indefinite, Immediate, Pending, a sentence, or punctuation.
4. Never infer that a general HGV restriction applies to abnormal transport. State permit-specific uncertainty when applicability is not confirmed.
5. Never infer that a general exemption applies to abnormal transport.
6. Exclude accidents, broken-down vehicles, single local transport movements, theft and police/crime reports.
7. Procurement/tender notices are not traffic restrictions.
8. Planned works are not restrictions unless a concrete operational effect and dates are confirmed.
9. Use exact dates and local times where supplied. Distinguish publication date from effective date.
10. Every published item must answer: Why does this matter NOW to someone planning or executing heavy, abnormal, oversized or special transport in Europe? If there is no meaningful current answer, exclude it.
11. One report per real-world development: when several candidates describe the same change, report it once, using the most authoritative candidate.

REQUIRED CANDIDATES
Candidates marked "required": true are verified, recently published changes that directly govern exceptional/oversize transport. Each required development must appear exactly once (lead or Rest of Europe).

SELECTION
Rank qualifying findings first by operational impact, relevance to abnormal/heavy transport, urgency, evidence quality, novelty, and effect on routing, permits, timing, cost or feasibility. Then apply DAJC's lead-order geography: wider Central Europe first among substantively comparable items, connected European corridors next, peripheral jurisdictions later.

STYLE
Write practical professional English. Each lead must contain concrete What changed / Where / When / Impact / Action information through the structured fields. timeWindow holds concrete dates/times from the evidence, or an empty string when the source gives none — never vague words such as Current, Ongoing, Future or Construction period. recommendedAction is a concrete operator/dispatcher step. No marketing filler and no clickbait body copy.`;

function candidatePayload(c, { required = false, summaryChars = 1200 } = {}) {
  return {
    country: c.country,
    location: c.location,
    type: c.type,
    title: c.title,
    summary: String(readableText(c.summary) || '').slice(0, summaryChars),
    publishedAt: c.publishedAt || null,
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
    required,
    sourceUrl: c.sourceUrl,
    sourceName: c.sourceName,
  };
}

export async function generateArticleWithOpenAI({
  candidates, requiredSourceUrls = [], weekRangeLabel, targetWeekStart, targetWeekEnd, apiKey, model,
}) {
  const client = new OpenAI({ apiKey });
  const required = new Set(requiredSourceUrls);
  const mapped = candidates.slice(0, 60).map((c) => candidatePayload(c, { required: required.has(c.sourceUrl) }));

  const response = await client.chat.completions.create({
    model: model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Target publication window: ${targetWeekStart} to ${targetWeekEnd} (${weekRangeLabel}). Select only verified material that passes every editorial rule; there is no minimum count. General HGV driving bans are out of scope.\n\nVerified candidates (JSON):\n${JSON.stringify(mapped, null, 2)}` },
    ],
    response_format: { type: 'json_schema', json_schema: ARTICLE_JSON_SCHEMA },
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI response contained no content');
  return JSON.parse(text);
}

// Writes report text for specific verified critical developments the main
// synthesis left out (critical-floor.mjs). This is mandatory-coverage repair
// for named items only - it never asks for "more" items to reach a count.
export async function generateRequiredItemsWithOpenAI({ candidates, targetWeekStart, targetWeekEnd, apiKey, model }) {
  if (!candidates?.length) return [];
  const client = new OpenAI({ apiKey });
  const payload = candidates.map((c) => candidatePayload(c, { required: true, summaryChars: 1500 }));
  const response = await client.chat.completions.create({
    model: model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Target publication window: ${targetWeekStart} to ${targetWeekEnd}. Write exactly one report for each verified critical development below (merge candidates that describe the same change). Return nothing else.\n\nRequired verified candidates (JSON):\n${JSON.stringify(payload, null, 2)}` },
    ],
    response_format: { type: 'json_schema', json_schema: REQUIRED_ITEMS_SCHEMA },
  });
  const text = response.choices?.[0]?.message?.content;
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.items) ? parsed.items : [];
}
