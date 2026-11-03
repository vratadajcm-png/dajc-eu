import { defineConfig } from 'drizzle-kit';

// Migrations for "Ask DAJC AI" only (src/lib/ask/db/schema.ts), kept apart
// from the Partner Portal's drizzle.config.ts / drizzle/. schemaFilter
// limits drizzle-kit to the dajc_ask schema, so it can never touch portal
// tables. Nothing here runs automatically: the owner applies the SQL in
// drizzle-ask/ with an administrative connection
// (DAJC_ASK_MIGRATION_DB_URL, local use only - never a Vercel variable).
// See docs/ASK_DAJC_AI.md.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/ask/db/schema.ts',
  out: './drizzle-ask',
  schemaFilter: ['dajc_ask'],
  // Own bookkeeping table, so this history never interleaves with the
  // portal's drizzle.__drizzle_migrations in a shared database.
  migrations: { table: '__drizzle_migrations_dajc_ask' },
  dbCredentials: {
    url: process.env.DAJC_ASK_MIGRATION_DB_URL ?? 'postgres://placeholder/placeholder',
  },
});
