import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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

export const collections = {
  'eu-oversize': euOversize,
  platform,
};
