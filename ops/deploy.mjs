// Deploy, stamping the running worker with the commit it was built from.
//
// Parity used to be sampled: fetch a page, read a sentence, assume the rest.
// GET /version and the x-loanhank-build header make it provable instead, which
// only works if the sha is injected here rather than remembered by hand.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
// A dirty tree deploys something no commit describes, so the stamp says so
// rather than naming a sha that is not what is running.
const stamp = dirty ? `${sha}-dirty` : sha;

execFileSync(
  process.execPath,
  [wrangler, 'deploy', '--var', `BUILD_SHA:${stamp}`],
  { stdio: 'inherit' },
);
