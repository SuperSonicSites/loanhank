import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Real borrower paper must never enter this repository. The real-contract
 * acceptance eval (`scripts/run-real-contract-eval.ts`) reads its documents
 * from `evals-local/`, which is gitignored — this test is what stops that from
 * being a convention nobody notices breaking. Any tracked PDF or JPEG outside
 * the three directories that legitimately hold one fails the suite by name.
 */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** design/: brand source art. standalone/public/: shipped assets.
 *  tests/e2e/fixtures/: the one synthetic loan PDF the e2e flow uploads. */
const ALLOWED_PREFIXES = ['design/', 'standalone/public/', 'tests/e2e/fixtures/'];

describe('repository hygiene', () => {
  it('tracks no document-shaped binary outside the allowed directories', (context) => {
    let stdout: string;
    try {
      stdout = execSync(
        'git ls-files -z -- "*.pdf" "*.jpg" "*.jpeg" "*.PDF" "*.JPG" "*.JPEG"',
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch (error) {
      console.info(`Skipping tracked-file scan: git is unavailable here (${error instanceof Error ? error.message : String(error)}).`);
      context.skip();
      return;
    }

    const tracked = stdout.split('\0').filter((entry) => entry.length > 0);
    const offenders = tracked.filter((entry) => !ALLOWED_PREFIXES.some((prefix) => entry.startsWith(prefix)));
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Tracked document files outside ${ALLOWED_PREFIXES.join(', ')}: ${offenders.join(', ')}. `
          + 'Real contracts belong in evals-local/, which is gitignored.',
    ).toEqual([]);
  });

  it('keeps the real-contract eval directory gitignored', async () => {
    const gitignore = await readFile(new URL('../../.gitignore', import.meta.url), 'utf8');
    expect(gitignore.split(/\r?\n/).map((line) => line.trim())).toContain('evals-local/');
  });
});
