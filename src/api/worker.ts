// Worker types are imported, never referenced globally: they redefine Buffer
// and URL, and the engine tests run on the Node types.
import type {
  D1Database,
  ExecutionContext,
  R2Bucket,
  ScheduledController,
} from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { renderPage } from '../web/page.js';

export interface Env {
  DB: D1Database;
  QUOTES: R2Bucket;
  BACKUPS: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.html(renderPage()));

export default {
  fetch: app.fetch,

  // The crons in wrangler.jsonc fire here: the quarter-hourly sweep is the
  // retention reaper (src/api/reaper.ts, waiting on its D1 and R2 stores) and
  // the 07:00 UTC one is the nightly D1 export to the BACKUPS bucket. Neither
  // is wired while there is nothing in the pile to reap or back up.
  scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {},
};
