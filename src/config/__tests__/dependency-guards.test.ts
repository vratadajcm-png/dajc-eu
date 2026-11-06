// Guards that keep the dependency risk assessment of
// docs/SECURITY_DEPENDENCIES.md true. If one fails, re-assess the advisory
// instead of relaxing the test.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.(ts|mjs|js|astro)$/.test(entry.name) ? [path] : [];
  });
}

describe('dependency advisories stay unreachable', () => {
  it('no code imports the zod v4 core (GHSA-mrhx-c7xc-m3w5 affects $ZodArray in zod <4.6.6)', () => {
    for (const file of ['src', 'scripts', 'config', 'tests'].flatMap(sources)) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toMatch(/from ['"]zod\/(?:v4|mini|v4-mini)|require\(['"]zod\/(?:v4|mini)/);
    }
  });

  it('the installed patched versions do not silently regress', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')).packages as Record<string, { version: string }>;
    const at = (path: string) => lock[path]?.version?.split('.').map(Number) ?? [0];
    const atLeast = (path: string, min: number[]) => {
      const v = at(path);
      for (let i = 0; i < min.length; i++) {
        if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i];
      }
      return true;
    };
    expect(atLeast('node_modules/vite', [8, 2, 3])).toBe(true);
    expect(atLeast('node_modules/vitest', [4, 1, 12])).toBe(true);
    expect(atLeast('node_modules/undici', [8, 12, 2])).toBe(true);
    expect(atLeast('node_modules/fast-uri', [3, 1, 9])).toBe(true);
    expect(atLeast('node_modules/@vercel/cli-config', [0, 3, 6])).toBe(true);
    expect(atLeast('node_modules/astro/node_modules/zod', [4, 6, 6])).toBe(true);
  });
});
