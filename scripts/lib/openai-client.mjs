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
        description: 'Normally 20-30 substantive lead developments when enough verified material exists. Never pad.',
      },
      europeRoundup: {
        type: 'array',
        items: DEVELOPMENT_SCHEMA,
        description: 'Normally 10-20 additional useful short updates from the wider European scan when enough material exists. Never duplicate leads.',
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
Do not repeat unchanged long-term restrictions every week. Re-report them only when newly announced, beginning, changed, extended, ending, materially worsening/improving, when the diversion or authorised abnormal-load route changes, or when a weight/width/height/axle condition changes. Ordinary short roadworks should normally be excluded unless their effect on special transport is critical. As a general editorial threshold, ordinary closures should normally last more than about 30 days unless they affect an important abnormal-load corridor or have exceptional dimensional/weight consequences.

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
Normally select 20-30 distinct substantive lead reports when enough verified high-value material exists. If fewer genuinely worthwhile candidates exist, publish fewer rather than padding. If an unusually active week has more than 30 genuinely major items, select the strongest for leads and place additional useful findings in the roundup.

AROUND EUROPE
Place additional verified useful developments in europeRoundup. Target roughly 10-20 short updates when sufficient material exists, preferably covering at least six different countries/territories. Do not manufacture geographic balance and never use unchanged Sunday bans as filler. Prefer a meaningful finding from a smaller/less-covered jurisdiction over a marginal story from an already dominant major market.

STYLE
Write practical professional English. Each lead must contain concrete What changed / Where / When / Impact / Action information through the structured fields. No marketing filler and no clickbait body copy.`;

export async function generateArticleWithOpenAI({ candidates, weekRangeLabel, targetWeekStart, targetWeekEnd, apiKey, model }) {
  const client = new OpenAI({ apiKey });
  const mapped = candidates.map((c) => ({
    country: c.country,
    location: c.location,
    type: c.type,
    title: c.title,
    summary: c.summary,
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
