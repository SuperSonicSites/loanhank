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
  // A second teardown for the same farmer, and one for somebody else. The
  // opt-out law is about the address, not the row.
  db.exec(
    `INSERT INTO emails (id, email, decode_id, created_at)
     VALUES ('live-2', 'farmer@example.test', 'd1', '2026-08-17T00:00:00Z')`,
  );
  db.exec(
    `INSERT INTO emails (id, email, decode_id, created_at)
     VALUES ('neighbor', 'neighbor@example.test', 'd1', '2026-08-17T00:00:00Z')`,
  );

  const env = {
    DB: d1,
    // The limiter is a Cloudflare binding; in a test it always allows, so what
    // is being exercised here is the route logic rather than the limiter.
    DECODE_LIMIT: { limit: async () => ({ success: true }) },
    RATE_LIMIT_SALT: 'test-salt',
    // Sendable, so /email inserts its row; the synthetic test stubs fetch.
    RESEND_API_KEY: 'test',
    EMAIL_FROM: 'hank@mail.test',
    POSTAL_ADDRESS: 'LoanHank, somewhere',
  } as never;

  const post = (path: string, form: Record<string, string>, headers: Record<string, string> = {}) =>
    app.fetch(
      new Request(`https://loanhank.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(form).toString(),
      }),
      env,
      { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {} } as never,
    );

  const get = (path: string) =>
    app.fetch(
      new Request(`https://loanhank.test${path}`),
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} } as never,
    );

  return { db, post, get };
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

describe('synthetic traffic flags itself at insert', () => {
  // spec.md 7.2: verification traffic is flagged in the same session that
  // creates it. The x-loanhank-synthetic header suppressed ad measurement but
  // flagged nothing, which is why two mop-up migrations already exist. Now
  // the header flags every row the request writes, at insert time.
  const SYNTHETIC = { 'x-loanhank-synthetic': '1' };
  const QUICK = {
    quotedPrice: '84500', cashDiscount: '6000', payment: '1408.33',
    paymentFrequency: 'monthly', paymentCount: '60', balloon: '',
  };

  it('flags the decode and its events when the header rides in', async () => {
    const { db, post } = await harness();
    await post('/decode', QUICK, SYNTHETIC);
    const decode = db.prepare("SELECT synthetic FROM decodes WHERE verdict = 'none' AND id <> 'd1'")
      .get() as { synthetic: number };
    expect(decode.synthetic).toBe(1);
    const event = db.prepare("SELECT synthetic FROM events WHERE event = 'decode'").get() as { synthetic: number };
    expect(event.synthetic).toBe(1);
  });

  it('leaves real traffic at zero', async () => {
    const { db, post } = await harness();
    await post('/decode', QUICK);
    const decode = db.prepare("SELECT synthetic FROM decodes WHERE verdict = 'none' AND id <> 'd1'")
      .get() as { synthetic: number };
    expect(decode.synthetic).toBe(0);
    const event = db.prepare("SELECT synthetic FROM events WHERE event = 'decode'").get() as { synthetic: number };
    expect(event.synthetic).toBe(0);
  });

  it('flags the email row too', async () => {
    const { db, post } = await harness();
    db.exec(
      `INSERT INTO decodes (id, ts, quarter)
       VALUES ('11111111-1111-4111-8111-111111111111', '2026-08-16T00:00:00Z', '2026Q3')`,
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, status: 200 })) as never;
    try {
      await post('/email', {
        email: 'checker@example.test', decodeId: '11111111-1111-4111-8111-111111111111',
      }, SYNTHETIC);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const row = db.prepare("SELECT synthetic FROM emails WHERE email = 'checker@example.test'")
      .get() as { synthetic: number };
    expect(row.synthetic).toBe(1);
  });
});

describe('GET /unsubscribe shows a button and changes nothing', () => {
  // Corporate mail filters prefetch every link in a body with GET before the
  // farmer ever sees the email. A GET that mutated was a phantom unsubscribe
  // machine; the plain link now lands on a confirm page whose button POSTs,
  // and RFC 8058 one-click POSTs stay immediate.
  it('renders the confirm page without touching any row', async () => {
    const { db, get } = await harness();
    const response = await get('/unsubscribe/live');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Stop the emails');
    expect(body).toContain('action="/unsubscribe/live"');
    const gone = db.prepare('SELECT COUNT(*) AS n FROM emails WHERE unsubscribed_at IS NOT NULL').get() as { n: number };
    expect(gone.n).toBe(1); // only the seeded already-gone row
  });

  it('renders the same page for an id that matches nothing', async () => {
    // Anti-enumeration: the page must not reveal whether the id is real.
    const { get } = await harness();
    const real = await (await get('/unsubscribe/live')).text();
    const fake = await (await get('/unsubscribe/not-a-real-id')).text();
    expect(fake.replaceAll('not-a-real-id', 'live')).toBe(real);
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

  it('silences every row sharing the address, not just the token row', async () => {
    // CAN-SPAM is about the address. A farmer with two teardowns has two rows
    // and one opt-out, and clicking it once must stop all of it.
    const { db, post } = await harness();
    await post('/unsubscribe/live', {});
    const farmer = db.prepare(
      "SELECT COUNT(*) AS n FROM emails WHERE email = 'farmer@example.test' AND unsubscribed_at IS NOT NULL",
    ).get() as { n: number };
    expect(farmer.n).toBe(2);
  });

  it('does not silence a different address', async () => {
    const { db, post } = await harness();
    await post('/unsubscribe/live', {});
    const neighbor = db.prepare('SELECT unsubscribed_at FROM emails WHERE id = ?').get('neighbor') as
      { unsubscribed_at: string | null };
    expect(neighbor.unsubscribed_at).toBeNull();
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
