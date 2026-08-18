// Wraps the OpenAI Chat Completions structured-output call used to
// synthesize the Friday EU Oversize Weekly article from verified findings.
//
// The model is only ever given already-verified candidate findings (see
// generate-weekly-article.mjs) and is required to attach a `sourceUrl` to
// every development it reports. The caller cross-validates every returned
// `sourceUrl` against the input set and drops anything that doesn't match -
// this file does not decide what's trustworthy, it only asks the model to
// select, group and phrase what we already verified.

import OpenAI from 'openai';

// Reviewed against OpenAI's lineup at the time this script was written.
// Override via OPENAI_MODEL if a newer/cheaper model is preferred - check
// what's current before relying on the default.
const DEFAULT_MODEL = 'gpt-4o';

const ARTICLE_JSON_SCHEMA = {
  name: 'eu_oversize_weekly_article',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      seoTitle: { type: 'string', description: 'SEO title, e.g. "EU Oversize Weekly: ... for 24-30 August 2026"' },
      metaDescription: { type: 'string', description: 'One or two sentence SEO meta description' },
      intro: { type: 'string', description: 'Short intro: what matters most for the coming week' },
      developments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            country: { type: 'string' },
            title: { type: 'string', description: 'Short factual headline for this development' },
            whatChanged: { type: 'string' },
            where: { type: 'string' },
            validFrom: { type: 'string', description: 'ISO date or empty string if unknown' },
            validTo: { type: 'string', description: 'ISO date or empty string if unknown' },
            impact: { type: 'string' },
            recommendedAction: { type: 'string' },
            isDrivingBan: { type: 'boolean' },
            isInfrastructure: { type: 'boolean' },
            sourceUrl: { type: 'string', description: 'Must be copied EXACTLY from the supplied candidate - never invented' },
            sourceName: { type: 'string', description: 'Must be copied EXACTLY from the supplied candidate - never invented' },
          },
          required: [
            'country', 'title', 'whatChanged', 'where', 'validFrom', 'validTo',
            'impact', 'recommendedAction', 'isDrivingBan', 'isInfrastructure',
            'sourceUrl', 'sourceName',
          ],
          additionalProperties: false,
        },
      },
      operatorsWatchNextWeek: { type: 'string', description: 'Short practical closing paragraph' },
    },
    required: ['seoTitle', 'metaDescription', 'intro', 'developments', 'operatorsWatchNextWeek'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are the editor of "EU Oversize Weekly", a professional briefing for European heavy/oversized-load transport operators and dispatchers.

You will be given a JSON array of pre-verified candidate findings (permits, driving bans, escort requirements, border restrictions, bridge/tunnel restrictions, road closures, roadworks, route restrictions, and relevant operational/equipment/market changes). Each candidate already has a working, checked source URL.

Rules:
- Select only candidates with genuine operational relevance for heavy/oversized transport planning next week. Skip anything trivial, purely administrative-internal, or without practical impact. Do not force a fixed number of items - include as many, or as few, as are genuinely significant.
- For every development you report, "sourceUrl" and "sourceName" MUST be copied EXACTLY, character for character, from one of the supplied candidates. Never invent, modify, or guess a source.
- Never state a specific restriction, date, or number that is not present in the supplied candidate data. If a field (e.g. validTo) is not known, leave it as an empty string - do not guess.
- Write in professional, practical, plain English for operators/dispatchers. No marketing language, no clickbait, no filler.
- Set "isDrivingBan": true only for weekend/holiday/seasonal/extraordinary driving bans relevant to the coming week.
- Set "isInfrastructure": true for bridge/tunnel/road-closure/critical-corridor items.`;

export async function generateArticleWithOpenAI({ candidates, weekRangeLabel, apiKey, model }) {
  const client = new OpenAI({ apiKey });

  const userPayload = {
    weekRangeLabel,
    candidates: candidates.map((c) => ({
      country: c.country,
      location: c.location,
      type: c.type,
      title: c.title,
      summary: c.summary,
      validFrom: c.validFrom,
      validTo: c.validTo,
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
          `Target publication window: ${weekRangeLabel}.\n\n` +
          `Verified candidate findings (JSON):\n${JSON.stringify(userPayload.candidates, null, 2)}`,
      },
    ],
    response_format: { type: 'json_schema', json_schema: ARTICLE_JSON_SCHEMA },
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI response contained no content');
  return JSON.parse(text);
}
