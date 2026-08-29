// Wraps the OpenAI Chat Completions structured-output call used to
// synthesize the Friday EU Oversize Weekly article from verified findings.
//
// The model is only ever given already-verified candidate findings (see
// generate-weekly-article.mjs) and is required to attach a `sourceUrl` to
// every development it reports. The caller cross-validates every returned
// `sourceUrl` against the input set (scripts/lib/cross-validate.mjs) and
// drops anything that doesn't match, and quality-gate.mjs independently
// re-validates every date, count, and duplicate - this file does not decide
// what's trustworthy on its own, it only asks the model to select, group
// and phrase what was already verified, under an explicit set of hard rules.

import OpenAI from 'openai';

// Reviewed against OpenAI's lineup at the time this script was written.
// Override via OPENAI_MODEL if a newer/cheaper model is preferred - check
// what's current before relying on the default.
const DEFAULT_MODEL = 'gpt-4o';

const DEVELOPMENT_SCHEMA = {
  type: 'object',
  properties: {
    country: { type: 'string' },
    title: { type: 'string', description: 'Short factual headline for this development' },
    whatChanged: { type: 'string', description: 'What applies or what changed - the substantive restriction, in professional English' },
    where: { type: 'string', description: 'Region, road, route, or corridor this applies to' },
    vehicleScope: { type: 'string', description: 'Affected vehicle category and the applicable weight/vehicle threshold. Empty string if not known.' },
    timeWindow: { type: 'string', description: 'Exact date(s) and LOCAL time of the country concerned. Empty string if not known.' },
    validFrom: { type: 'string', description: 'ISO date (YYYY-MM-DD) or empty string if unknown' },
    validTo: { type: 'string', description: 'ISO date (YYYY-MM-DD) or empty string if unknown' },
    impact: { type: 'string', description: 'Practical impact on heavy/oversized transport operations' },
    recommendedAction: { type: 'string', description: 'Concrete, practical action for an operator or dispatcher - never a generic platitude' },
    exemptions: { type: 'string', description: 'Important exemptions or permit-specific conditions. Empty string if none apply.' },
    isDrivingBan: { type: 'boolean' },
    isInfrastructure: { type: 'boolean' },
    sourceUrl: { type: 'string', description: 'Must be copied EXACTLY from the supplied candidate - never invented' },
    sourceName: { type: 'string', description: 'Must be copied EXACTLY from the supplied candidate - never invented' },
  },
  required: ['country', 'title', 'whatChanged', 'where', 'vehicleScope', 'timeWindow', 'validFrom', 'validTo', 'impact', 'recommendedAction', 'exemptions', 'isDrivingBan', 'isInfrastructure', 'sourceUrl', 'sourceName'],
  additionalProperties: false,
};

const ARTICLE_JSON_SCHEMA = {
  name: 'eu_oversize_weekly_article',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      seoTitle: {
        type: 'string',
        description: 'Attention-grabbing but accurate headline. May use restrained tabloid-style urgency; must never exaggerate geographic scope or claim something false.',
      },
      metaDescription: {
        type: 'string',
        description: 'One or two sentence SEO meta description naming the verified driving-ban / exceptional-transport restriction coverage and the exact target date range.',
      },
      intro: { type: 'string', description: 'Short intro naming what matters most for the coming week, written for a European (not single-corridor) audience' },
      developments: {
        type: 'array',
        items: DEVELOPMENT_SCHEMA,
        description: 'The 10-12 most consequential lead reports, selected by operational impact without country quotas.',
      },
      europeRoundup: {
        type: 'array',
        items: DEVELOPMENT_SCHEMA,
        description: 'All other verified, operationally useful European developments not selected as lead reports. Never duplicate a lead report.',
      },
      operatorChecklist: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short, practical checklist items for an operator/dispatcher preparing for the target week (e.g. "Check the individual exceptional-transport permit for country-specific conditions.")',
      },
    },
    required: ['seoTitle', 'metaDescription', 'intro', 'developments', 'europeRoundup', 'operatorChecklist'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are the editor of "EU Oversize Weekly", a professional operational briefing for European heavy, oversized and special road transport operators, drivers and dispatchers. It is NOT a general traffic-news feed - never summarize every item you are given just because it exists.

You will be given the exact target-week date range (Monday-Sunday, ISO dates) and a JSON array of pre-verified candidate findings (permits, driving bans, escort requirements, border restrictions, bridge/tunnel restrictions, road closures, roadworks, route restrictions, and relevant operational/equipment/market changes). Each candidate already has a working, checked source URL.

Editorial priority order (most important first): (1) truck driving bans; (2) special movement windows/bans for exceptional or oversized transport; (3) permit-rule or permit-system changes; (4) escort/BF2/BF3/BF4/police-assistance requirements; (5) border and transit restrictions; (6) mandatory crossings or approved corridors; (7) bridge/tunnel/height/width/axle-load/weight restrictions; (8) long-term closures on strategic routes; (9) weather ONLY when it creates a specific operational restriction; (10) significant equipment/regulatory/market changes, as secondary items only.

Geographic scope: cover the whole of Europe. Country selection must be evidence-led and may change every week. Never use a fixed country list, country quota, preferred corridor, or Central-European default. Rank the 10-12 most consequential items as lead reports, then put every other verified and useful item into europeRoundup so smaller markets and peripheral regions are not silently dropped.

Hard rules - violating any of these makes your output unusable:
1. The target week is the ONLY window that matters. Exclude any development whose validTo date is before the target week starts. Exclude any development whose validFrom date is after the target week ends.
2. Never turn an isolated traffic accident, a stuck/broken-down vehicle, a theft report, or a routine police incident into an "ongoing restriction" - these are one-off events, not operational rules, even if a candidate mentions a road name.
3. A procurement notice, tender, or contract-award announcement is never a traffic restriction, even if it mentions a bridge or road.
4. Planned/future works are not a restriction unless the candidate text confirms a specific, currently-applicable traffic impact and specific dates - never infer a closure merely because a candidate mentions "roadworks", "bridge", or "construction".
5. Never invent a bridge capacity, lane closure, diversion route, width/height/weight limit, or validity date that is not explicitly present in the supplied candidate text. If a field is unknown, use an empty string - never guess.
6. A recurring weekend/seasonal driving ban may be included even if its legal source was not published this week, but ONLY when the candidate data shows it is already known to be valid for the target week's exact dates - never assume a ban "probably still applies".
7. For every development, "sourceUrl" and "sourceName" MUST be copied EXACTLY, character for character, from one of the supplied candidates. Never invent, modify, or guess a source.
8. Every development must state: country; region/road/route where applicable; what applies or changed; affected vehicle category and weight/vehicle threshold (vehicleScope); exact date and LOCAL time of the country concerned (timeWindow); geographic/route scope (where); practical impact; a concrete, practical recommendedAction for an operator or dispatcher (never a generic platitude); and important exemptions/permit-specific conditions if any (exemptions, empty string if none).
9. Clearly distinguish a general truck-driving ban, a restriction above a specific weight, a special restriction for exceptional/oversized transport, and a condition contained in an individual transport permit - never conflate these.
10. A candidate with isOfficialCalendar=true is a legally curated, target-week-specific restriction from the maintained DAJC calendar layer. Unless it is an exact duplicate of another supplied restriction, it is lead-quality by definition and MUST be included in developments before lower-priority news items. Do not discard it merely because its legal rule is recurring rather than newly announced.
11. developments must contain 10-12 distinct lead reports when enough verified material exists. Build the lead set from official-calendar restrictions first, then add the most consequential remaining verified items up to 10-12. If fewer than 10 genuinely useful candidates exist after applying all hard rules, return an EMPTY developments array. Never pad with filler.
12. europeRoundup must contain the remaining verified, useful candidates that were not chosen as leads. Do not repeat any sourceUrl or title across the two arrays. Grouping happens later in the renderer; do not drop a country merely because it has only one item.
13. Write in professional, practical, plain English for operators/dispatchers. No marketing language, no filler, no clickbait in the body.`;

export async function generateArticleWithOpenAI({ candidates, weekRangeLabel, targetWeekStart, targetWeekEnd, apiKey, model }) {
  const client = new OpenAI({ apiKey });

  const userPayload = {
    targetWeekStart,
    targetWeekEnd,
    weekRangeLabel,
    candidates: candidates.map((c) => ({
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
    })),
  };

  const response = await client.chat.completions.create({
    model: model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Target publication window: ${targetWeekStart} to ${targetWeekEnd} (${weekRangeLabel}). ` +
          `Any development outside this exact date range must be excluded.\n\n` +
          `Verified candidate findings (JSON):\n${JSON.stringify(userPayload.candidates, null, 2)}`,
      },
    ],
    response_format: { type: 'json_schema', json_schema: ARTICLE_JSON_SCHEMA },
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI response contained no content');
  return JSON.parse(text);
}
