import { readdir, readFile } from 'node:fs/promises';

// Every `describe(...)` and `it(...)` title in the suite, by name.
//
// This exists because the first promise resolver searched raw test-file TEXT
// for the quoted citation, and one of the files it searched was the registry
// itself. `keptBy: 'a guard that does not exist'` matched its own registration
// line, so every citation resolved and a fabricated one passed. The gate could
// not fail, which means it was not a gate.
//
// Two rules follow, and both matter:
//
// 1. Names are parsed from CALL SITES only: `describe('x'` and `it('x'`. A
//    registry entry is `keptBy: 'x'`, which is not a call site, so the registry
//    can never satisfy itself no matter what file it lives in.
// 2. The corpus deliberately INCLUDES the registry file, because the delivery
//    tests live there too. An earlier fix excluded it and every citation went
//    unresolved, which is a gate failing for the wrong reason and just as
//    useless as one that cannot fail at all.

const TESTS = new URL('../', import.meta.url);

/** Title strings passed to describe() or it(), across the whole suite. */
export async function collectTestNames(exclude: string[] = []): Promise<Set<string>> {
  const names = new Set<string>();
  const files = (await readdir(TESTS)).filter(
    (name) => name.endsWith('.test.ts') && !exclude.includes(name),
  );

  for (const file of files) {
    const source = await readFile(new URL(file, TESTS), 'utf8');
    // describe('name' | it("name" | it(`name`, and the .each / .skip variants.
    const callSite = /\b(?:describe|it|test)(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    for (const match of source.matchAll(callSite)) {
      const title = match[2];
      if (title !== undefined && title !== '') names.add(title);
    }
  }
  return names;
}

export interface Citation {
  phrase: string;
  keptBy?: string;
  notADelivery?: string;
}

/**
 * Citations that name no real test. Empty means every promise has a keeper
 * that actually exists.
 */
export function unresolvedCitations(citations: Citation[], names: Set<string>): string[] {
  return citations
    .filter((citation) => citation.keptBy !== undefined && !names.has(citation.keptBy))
    .map((citation) => `"${citation.phrase}" cites "${citation.keptBy}", which is not a test in this suite`);
}
