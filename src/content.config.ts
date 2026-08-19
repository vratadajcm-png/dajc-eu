import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { PROVIDER_CATEGORIES } from './data/provider-categories';
import { RELATIONSHIP_STATUSES, INTEGRATION_STATUSES } from './data/provider-status';

// Shared frontmatter schema for both news categories (EU Oversize Weekly and
// DAJC Platform Updates) - see docs/NEWS_AUTOMATION.md for authoring guide.
const newsSchema = z.object({
  title: z.string(),
  description: z.string(),
  slug: z.string(),
  category: z.enum(['eu-oversize', 'platform']),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  language: z.string().default('en'),
  author: z.string().default('DAJC'),
  status: z.enum(['draft', 'published']),
  sources: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().url(),
      })
    )
    .optional(),
  tags: z.array(z.string()).optional(),
  coverImage: z.string().optional(),
});

const euOversize = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news/eu-oversize' }),
  schema: newsSchema,
});

const platform = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news/platform' }),
  schema: newsSchema,
});

// Integration ecosystem providers (services, data providers and
// infrastructure connected to DAJC) shown on /partners and, once approved,
// on the homepage teaser.
//
// No provider is ever named, logo'd, or described in public just because a
// content file exists for it:
// - `status` must be "active" (not "draft" or "hidden") for the entry to be
//   rendered anywhere at all.
// - `logoApproved` must additionally be true (and `logo` set) for the logo
//   to render - otherwise only the name is shown, never a broken image or
//   empty box.
// - `descriptionApproved` must additionally be true for shortDescription /
//   collaborationArea to render - otherwise only the technically neutral
//   name + category (+ status, if set) are shown, never marketing or
//   relationship framing that hasn't been cleared for that entry.
// This means a provider's public status can change purely by editing this
// content data - no component or page code changes are needed.
const providersSchema = z.object({
  name: z.string(),
  slug: z.string(),
  category: z.enum(PROVIDER_CATEGORIES),
  shortDescription: z.string().optional(),
  collaborationArea: z.string().optional(),
  website: z.string().url().optional(),
  status: z.enum(['draft', 'active', 'hidden']),
  order: z.number().default(0),
  relationshipStatus: z.enum(RELATIONSHIP_STATUSES).optional(),
  integrationStatus: z.enum(INTEGRATION_STATUSES).optional(),
  // Optional, explicitly-approved override for the public status line. When
  // set, it is shown verbatim instead of the generic relationshipStatus +
  // integrationStatus composition - use only when a specific wording has
  // itself been approved (not just the underlying statuses).
  publicStatusLabel: z.string().optional(),
  logo: z.string().optional(),
  logoApproved: z.boolean().default(false),
  descriptionApproved: z.boolean().default(false),
});

const providers = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/providers' }),
  schema: providersSchema,
});

export const collections = {
  'eu-oversize': euOversize,
  platform,
  providers,
};
