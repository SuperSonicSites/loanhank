import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `src/api`, `src/finance`, and `src/shared` are NOT frozen legacy — the
 * standalone Worker imports them directly, so a change there ships to
 * production. This test pins the exact set of shared files so the boundary
 * cannot drift silently: adding a new cross-boundary import (or retiring one)
 * must update this allowlist deliberately.
 */
const SHARED_ALLOWLIST = [
  'src/api/analysis.js',
  'src/api/env.js',
  'src/api/extractor.js',
  'src/api/public-rates.js',
  'src/api/reaper.js',
  'src/api/repository.js',
  'src/api/security.js',
  'src/api/storage.js',
  'src/finance/index.js',
  'src/shared/schema.js',
].sort();

const STANDALONE_ROOT = fileURLToPath(new URL('../../standalone/src', import.meta.url));

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe('shared production-code boundary', () => {
  it('imports exactly the allowlisted src/** files from standalone/src', async () => {
    const found = new Set<string>();
    for (const file of await walk(STANDALONE_ROOT)) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/from\s+['"]((?:\.\.\/)+src\/[^'"]+)['"]/g)) {
        found.add(match[1]!.replace(/^(\.\.\/)+/, ''));
      }
    }
    expect([...found].sort()).toEqual(SHARED_ALLOWLIST);
  });
});
