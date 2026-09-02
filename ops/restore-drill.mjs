// The restore drill, automated: `pnpm restore:drill`.
//
// An untested backup is a rumour (spec.md section 14). This runs the runbook's
// restore steps end to end against a scratch database and then deletes it:
// fetch the newest nightly dump from R2, create a scratch D1, apply every
// migration, replay the dump, compare table counts against the live database,
// and tear the scratch down whatever happened. Run it after any migration that
// changes a table's shape, and whenever you would rather know than believe.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const run = (args, options = {}) =>
  execFileSync(process.execPath, [wrangler, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });

const COUNTS = "SELECT (SELECT COUNT(*) FROM benchmarks) AS b, (SELECT COUNT(*) FROM decodes) AS d, (SELECT COUNT(*) FROM emails) AS e, (SELECT COUNT(*) FROM events) AS v";

/** wrangler prints a table; pull the four numbers out of it. */
const counts = (output) => {
  const numbers = output.match(/│\s*(\d+)\s*│\s*(\d+)\s*│\s*(\d+)\s*│\s*(\d+)\s*│/);
  if (!numbers) throw new Error(`could not read counts from:\n${output}`);
  return numbers.slice(1, 5).map(Number);
};

const scratch = `loanhank-restore-${Date.now()}`;
const dir = mkdtempSync(join(tmpdir(), 'loanhank-restore-'));
let created = false;
try {
  // 1. The newest dump.
  const listed = JSON.parse(run(['r2', 'object', 'list', 'loanhank-backups', '--prefix', 'd1/', '--remote']) || '{}');
  const objects = (listed.objects ?? listed ?? []).map((object) => object.key ?? object).filter((key) => /\.sql$/.test(key)).sort();
  const newest = objects[objects.length - 1];
  if (!newest) throw new Error('no dump found under d1/ in loanhank-backups');
  console.log(`restoring ${newest}`);
  const dump = join(dir, 'restore.sql');
  run(['r2', 'object', 'get', `loanhank-backups/${newest}`, '--file', dump, '--remote'], { stdio: 'inherit' });

  // 2. Somewhere to put it. Never the live database.
  run(['d1', 'create', scratch], { stdio: 'inherit' });
  created = true;

  // 3. Schema from the migrations, in order; then the data.
  for (const name of readdirSync('migrations').filter((n) => n.endsWith('.sql')).sort()) {
    run(['d1', 'execute', scratch, '--remote', '--file', join('migrations', name), '--yes'], { stdio: 'inherit' });
  }
  run(['d1', 'execute', scratch, '--remote', '--file', dump, '--yes'], { stdio: 'inherit' });

  // 4. Prove it: the restore must hold at least what the dump held. Live
  //    counts can be higher (rows landed since 07:00) and never lower, except
  //    events, which the nightly prunes.
  const restored = counts(run(['d1', 'execute', scratch, '--remote', '--command', COUNTS]));
  const live = counts(run(['d1', 'execute', 'loanhank', '--remote', '--command', COUNTS]));
  console.log(`restored  benchmarks=${restored[0]} decodes=${restored[1]} emails=${restored[2]} events=${restored[3]}`);
  console.log(`live      benchmarks=${live[0]} decodes=${live[1]} emails=${live[2]} events=${live[3]}`);
  const dumpRows = restored.reduce((a, b) => a + b, 0);
  if (dumpRows === 0) throw new Error('the restore holds zero rows');
  if (restored[0] > live[0] || restored[1] > live[1] || restored[2] > live[2]) {
    throw new Error('the restore holds more than the live database, which cannot be');
  }
  writeFileSync(join(dir, 'result.txt'), `${newest}\nrestored ${restored.join(' ')}\nlive ${live.join(' ')}\n`);
  console.log(`restore drill PASSED against ${newest}`);
} finally {
  // 5. A second copy of the pile sitting around is a second thing that can leak.
  if (created) run(['d1', 'delete', scratch, '--skip-confirmation'], { stdio: 'inherit' });
  rmSync(dir, { recursive: true, force: true });
}
