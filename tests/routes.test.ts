import { describe, expect, it } from 'vitest';
import { app } from '../src/api/worker.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// Route tests for the two endpoints whose HONEST branch had no guard.
//
// Both of these tell the truth when they cannot do what was asked: /remind
// refuses rather than reassuring when nothing was recorded, and /unsubscribe
// answers the same way whether or not the id matched. That honesty was written
// after a defect and then left untested, and unguarded honesty rots: the next
// person to touch either route has nothing telling them the refusal matters.

async function harness() {
  const { db, d1 } = await migratedDatabase();
  db.exec(
    `INSERT INTO decodes (id, ts, quarter, quote_expiry_date)
     VALUES ('d1', '2026-08-16T00:00:00Z', '2026Q3', '2026-08-31')`,
  );
  db.exec(
    `INSERT INTO emails (id, email, decode_id, created_at)
     VALUES ('live', 'farmer@example.test', 'd1', '2026-08-16T00:00:00Z')`,
  );
  db.exec(
    `INSERT INTO emails (id, email, decode_id, created_at, unsubscribed_at)
     VALUES ('already-gone', 'gone@example.test', 'd1', '2026-08-16T00:00:00Z', '2026-08-16T01:00:00Z')`,
  );

  const env = {
    DB: d1,
    // The limiter is a Cloudflare binding; in a test it always allows, so what
    // is being exercised here is the route logic rather than the limiter.
    DECODE_LIMIT: { limit: async () => ({ success: true }) },
    RATE_LIMIT_SALT: 'test-salt',
  } as never;

  const post = (path: string, form: Record<string, string>) =>
    app.fetch(
      new Request(`https://loanhank.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      }),
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} } as never,
    );

  return { db, post };
}

describe('POST /remind', () => {
  it('records the reminder and says so on the happy path', async () => {
    const { db, post } = await harness();
    const response = await post('/remind', { emailId: 'live', remindOn: '2026-08-31' });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('We will remind you');

    const row = db.prepare('SELECT reminder_opt_in, remind_on FROM emails WHERE id = ?').get('live') as
      { reminder_opt_in: number; remind_on: string };
    expect(row.reminder_opt_in).toBe(1);
    expect(row.remind_on).toBe('2026-08-31');
  });

  it('refuses honestly when the id matches nothing', async () => {
    // The branch that exists because the route used to promise regardless.
    const { post } = await harness();
    const response = await post('/remind', { emailId: 'no-such-row', remindOn: '2026-08-31' });
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain('We could not set that up');
    expect(body).not.toContain('We will remind you');
  });

  it('refuses an address that already unsubscribed', async () => {
    const { db, post } = await harness();
    const response = await post('/remind', { emailId: 'already-gone', remindOn: '2026-08-31' });
    expect(response.status).toBe(422);
    const row = db.prepare('SELECT reminder_opt_in FROM emails WHERE id = ?').get('already-gone') as
      { reminder_opt_in: number };
    expect(row.reminder_opt_in).toBe(0);
  });

  it('refuses a date it cannot read rather than storing a guess', async () => {
    const { post } = await harness();
    const response = await post('/remind', { emailId: 'live', remindOn: 'soon' });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain('No date to work from');
  });
});

describe('POST /unsubscribe', () => {
  it('marks the row and confirms', async () => {
    const { db, post } = await harness();
    const response = await post('/unsubscribe/live', {});
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('You are off the list');

    const row = db.prepare('SELECT unsubscribed_at FROM emails WHERE id = ?').get('live') as
      { unsubscribed_at: string | null };
    expect(row.unsubscribed_at).not.toBeNull();
  });

  it('confirms the same way for an id that matches nothing', async () => {
    // Deliberate. An unsubscribe endpoint that answers differently for a real
    // id than a made-up one is an endpoint that confirms which addresses we
    // hold, to anybody who cares to ask it.
    const { post } = await harness();
    const response = await post('/unsubscribe/not-a-real-id', {});
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('You are off the list');
  });

  it('is idempotent, so a second click cannot undo the first', async () => {
    const { db, post } = await harness();
    await post('/unsubscribe/live', {});
    const first = db.prepare('SELECT unsubscribed_at FROM emails WHERE id = ?').get('live') as
      { unsubscribed_at: string };
    await post('/unsubscribe/live', {});
    const second = db.prepare('SELECT unsubscribed_at FROM emails WHERE id = ?').get('live') as
      { unsubscribed_at: string };
    expect(second.unsubscribed_at).toBe(first.unsubscribed_at);
  });
});
