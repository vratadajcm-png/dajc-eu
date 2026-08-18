// Standalone zod schema mirroring src/content.config.ts's `newsSchema`.
//
// Kept as a plain-Node-importable duplicate (not a shared import) because
// src/content.config.ts uses `astro:content`'s re-exported `z`, a virtual
// module only resolvable inside Astro's build - these scripts run as plain
// `node scripts/*.mjs` outside that context. If you change one, change the
// other; the quality gate below exists specifically to catch drift by
// validating against what Astro will actually accept.

import { z } from 'zod';

export const articleFrontmatterSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  slug: z.string().min(1),
  category: z.literal('eu-oversize'),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  language: z.string().default('en'),
  author: z.string().default('DAJC'),
  status: z.literal('published'),
  sources: z
    .array(
      z.object({
        name: z.string().min(1),
        url: z.string().url(),
      })
    )
    .min(1, 'article must cite at least one source'),
  tags: z.array(z.string()).optional(),
  coverImage: z.string().optional(),
});
