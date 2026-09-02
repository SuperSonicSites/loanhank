// Deploy, gated and stamped.
//
// The gates are the law CLAUDE.md states: main only, clean tree, tests green.
// Production once ran a build stamped -dirty because this script enforced
// nothing; the stamp labeled the violation instead of preventing it. Now the
// stamp still tells the truth and the gates stop the violation first.
//
// --force skips the gates for a genuine emergency. A forced dirty deploy
// still stamps -dirty, so the running worker never claims a sha it is not.
//
// Parity used to be sampled: fetch a page, read a sentence, assume the rest.
// GET /version and the x-loanhank-build header make it provable instead, which
// only works if the sha is injected here rather than remembered by hand.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

const force = process.argv.includes('--force');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const pnpm = (script) => execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['run', script],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

const sha = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain') !== '';
// actions/checkout leaves a detached HEAD, so the branch name reads HEAD in
// CI; GITHUB_REF is the truth there.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const onMain = branch === 'main' || process.env.GITHUB_REF === 'refs/heads/main';

if (!force) {
  if (dirty) {
    console.error('refusing: the working tree is dirty. Commit first, or pnpm run deploy --force.');
    process.exit(1);
  }
  if (!onMain) {
    console.error(`refusing: on ${branch}, and deploys ship from main. Or pnpm run deploy --force.`);
    process.exit(1);
  }
  // The whole suite runs in about a second; there is no case for skipping it.
  pnpm('typecheck');
  pnpm('test');
  pnpm('test:eval');
  // The paid layer runs whenever a key is present, because a deploy is the
  // moment a prompt regression becomes a farmer's problem.
  if (process.env.OPENAI_API_KEY) pnpm('test:eval:live');
}

const stamp = dirty ? `${sha}-dirty` : sha;

// Migrations first, always. Code that expects a column the database lacks is
// a 500 on every decode, and the deploy is the one moment both move together.
execFileSync(
  process.execPath,
  [wrangler, 'd1', 'migrations', 'apply', 'loanhank', '--remote'],
  { stdio: 'inherit' },
);

execFileSync(
  process.execPath,
  [wrangler, 'deploy', '--var', `BUILD_SHA:${stamp}`],
  { stdio: 'inherit' },
);

// Then prove it. The stamp is only worth something if somebody reads it back:
// the running worker must answer with the sha this script just shipped.
const response = await fetch('https://www.loanhank.com/version', { headers: { 'cache-control': 'no-cache' } });
const version = await response.text();
if (!response.ok || !version.includes(stamp)) {
  console.error(`deploy verification FAILED: /version answered ${response.status} ${version.slice(0, 200)}, expected ${stamp}`);
  process.exit(1);
}
console.log(`deploy verified: /version reports ${stamp}`);
