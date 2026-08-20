// Lazy Drizzle/Postgres client for the Partner Portal.
//
// Intentionally NOT connected at module import time: on-demand routes are
// bundled as serverless functions at build time but not executed, so a
// missing DAJC_PARTNER_DB_URL must never break `astro build`. The
// connection is only opened the first time a request actually needs it,
// and only portal routes (which are all gated - see
// src/portal/config/gate.ts) import this module.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type PortalDb = ReturnType<typeof drizzle<typeof schema>>;

let cached: PortalDb | null = null;

export class PortalDbNotConfiguredError extends Error {
  constructor() {
    super('DAJC_PARTNER_DB_URL is not configured.');
    this.name = 'PortalDbNotConfiguredError';
  }
}

export function getPortalDb(): PortalDb {
  if (cached) return cached;

  const connectionString = process.env.DAJC_PARTNER_DB_URL;
  if (!connectionString) {
    throw new PortalDbNotConfiguredError();
  }

  const client = postgres(connectionString, { max: 1 });
  cached = drizzle(client, { schema });
  return cached;
}
