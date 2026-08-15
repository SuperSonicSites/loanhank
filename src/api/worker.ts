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

// Must match the crons in wrangler.jsonc. An unrecognized cron logs and does
// nothing rather than falling into the wrong branch.
const REAPER_CRON = '*/15 * * * *';
const BACKUP_CRON = '0 7 * * *';

export interface Env {
  DB: D1Database;
  QUOTES: R2Bucket;
  BACKUPS: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.html(renderPage()));

export default {
  fetch: app.fetch,

  // Both crons log on every fire, wired or not. A cron that silently does
  // nothing and a cron that silently fails look identical in the dashboard,
  // and the reaper is what keeps the photo-deletion promise.
  scheduled(event: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    switch (event.cron) {
      case REAPER_CRON:
        console.log('cron reaper: not wired yet, no rows to reap');
        break;
      case BACKUP_CRON:
        console.log('cron backup: not wired yet, no rows to export');
        break;
      default:
        console.log(`cron unrecognized: ${event.cron}, nothing ran`);
    }
  },
};
