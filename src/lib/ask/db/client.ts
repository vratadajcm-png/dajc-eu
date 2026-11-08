// Lazy database client for "Ask DAJC AI", same pattern as the Partner
// Portal (src/portal/db/client.ts): nothing connects at import time, so a
// missing DAJC_ASK_DB_URL never breaks `astro build`. Routes only reach
// this after getAskConfig() confirmed the feature is configured.
//
// `prepare: false` keeps it compatible with the Supabase transaction pooler.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type AskDb = ReturnType<typeof drizzle<typeof schema>>;

const cache = new Map<string, AskDb>();

export function getAskDb(url: string): AskDb {
  let db = cache.get(url);
  if (!db) {
    db = drizzle(postgres(url, { max: 1, prepare: false, idle_timeout: 20 }), { schema });
    cache.set(url, db);
  }
  return db;
}
