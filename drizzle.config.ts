import { defineConfig } from 'drizzle-kit';

// Migrations for the DAJC Partner Portal (src/portal/db/schema.ts) and the DAJC
// Intelligence customer accounts that share its login (src/portal/db/intelligenceSchema.ts).
// The public dajc.eu site has no other database - see
// docs/PARTNER_PORTAL.md. `npx drizzle-kit generate` writes SQL migration
// files under drizzle/; nothing here ever pushes to a live database
// automatically.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/portal/db/schema.ts', './src/portal/db/intelligenceSchema.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.DAJC_PARTNER_DB_URL ?? 'postgres://placeholder/placeholder',
  },
});
