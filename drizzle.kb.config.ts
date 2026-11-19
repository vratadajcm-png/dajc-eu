import { defineConfig } from 'drizzle-kit';

// Migrations for the DAJC legal library (schema dajc_kb), kept apart from
// Ask (drizzle-ask/) and the Partner Portal (drizzle/). Hand-written SQL in
// drizzle-kb/ (full-text configuration, generated tsvector, the answerable
// view); applied by the owner with an administrative connection
// (DAJC_KB_MIGRATION_DB_URL, local use only - never a Vercel variable).
// Apply drizzle-ask first: the dajc_ask_app grant here is conditional.
// See docs/DAJC_AI_LEGAL_LIBRARY.md.
export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle-kb',
  schemaFilter: ['dajc_kb'],
  migrations: { table: '__drizzle_migrations_dajc_kb' },
  dbCredentials: {
    url: process.env.DAJC_KB_MIGRATION_DB_URL ?? 'postgres://placeholder/placeholder',
  },
});
