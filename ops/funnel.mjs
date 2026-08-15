// The ten-minute morning ritual: `pnpm funnel`.
//
// This exists because reading one query out of D1 has three traps, and a
// daily ritual that silently prints nothing is worse than no ritual.
//
// 1. `d1 execute --remote --file` takes the bulk import path. It reports how
//    many queries ran and never prints a result row.
// 2. `--command` with a leading SQL comment fails two different ways: an
//    argument starting with `--` is eaten as a CLI flag, and the D1 query API
//    rejects a leading block comment with a syntax error at offset 0.
// 3. `--command` containing newlines comes back as "incomplete input".
//
// So: read the file, strip comments, collapse to one line, pass it inline.
// The query itself stays readable in ops/funnel.sql.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sqlPath = fileURLToPath(new URL('./funnel.sql', import.meta.url));
const query = readFileSync(sqlPath, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Run wrangler's own entry point under this node, rather than the npx shim:
// on Windows the shim is a .cmd and spawning it needs a shell, which then
// re-parses the query string.
const require = createRequire(import.meta.url);
const wranglerBin = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

const local = process.argv.includes('--local');
const result = spawnSync(
  process.execPath,
  [wranglerBin, 'd1', 'execute', 'loanhank', local ? '--local' : '--remote', '--command', query],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
