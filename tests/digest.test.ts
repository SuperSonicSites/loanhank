import { describe, expect, it } from 'vitest';
import { sendOpsDigest } from '../src/api/worker.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// The nightly digest: the morning ritual's numbers, pushed to the owner with
// a subject line that says whether anything needs a look. The system telling
// you, instead of waiting to be asked.

async function harness(opsEmail: string | null = 'ops@example.test') {
  const { db, d1 } = await migratedDatabase();
  const posted: Array<Record<string, unknown>> = [];
  const transport = (async (_url: string, init: { body: string }) => {
    posted.push(JSON.parse(init.body));
    return { ok: true, status: 200 } as Response;
  }) as never;
  const env = {
    DB: d1, RESEND_API_KEY: 'test', EMAIL_FROM: 'hank@mail.test', POSTAL_ADDRESS: 'LoanHank, somewhere',
    ...(opsEmail === null ? {} : { OPS_EMAIL: opsEmail }),
  } as never;
  return { db, env, posted, transport };
}

describe('the nightly ops digest', () => {
  it('says all quiet when nothing crossed a line', async () => {
    const { db, env, posted, transport } = await harness();
    db.exec("INSERT INTO events (id, event, ts, meta_json, synthetic) VALUES ('b', 'backup_completed', datetime('now'), '{}', 0)");
    db.exec("UPDATE benchmarks SET valid_through = '2099-12-31'");
    const result = await sendOpsDigest(env, '2026-09-02', transport);
    expect(result.sent).toBe(true);
    expect(result.flags).toEqual([]);
    expect(posted[0]?.to).toEqual(['ops@example.test']);
    expect(String(posted[0]?.subject)).toContain('All quiet');
    // Internal mail, not commercial: no unsubscribe machinery on it.
    expect(posted[0]?.headers).toBeUndefined();
    expect(String(posted[0]?.text)).not.toContain('Unsubscribe:');
  });

  it('flags a missing backup, a lapsed card, and a refused refresh', async () => {
    const { db, env, posted, transport } = await harness();
    // The seeded card lapsed 2026-08-31; no backup has ever run; the last
    // refresh was refused.
    db.exec("INSERT INTO events (id, event, ts, meta_json, synthetic) VALUES ('r', 'benchmark_refused', datetime('now'), '{}', 0)");
    const result = await sendOpsDigest(env, '2026-09-02', transport);
    expect(result.flags.length).toBe(3);
    const subject = String(posted[0]?.subject);
    expect(subject).toContain('Needs a look');
    expect(subject).toContain('3 things');
    const body = String(posted[0]?.text);
    expect(body).toContain('No backup has ever landed.');
    expect(body).toContain('The rate card lapsed');
    expect(body).toContain('refresh was refused');
  });

  it('flags a reader that fails more than it reads, and failed sends', async () => {
    const { db, env, posted, transport } = await harness();
    db.exec("INSERT INTO events (id, event, ts, meta_json, synthetic) VALUES ('b', 'backup_completed', datetime('now'), '{}', 0)");
    db.exec("UPDATE benchmarks SET valid_through = '2099-12-31'");
    db.exec(`INSERT INTO events (id, event, ts, meta_json, synthetic) VALUES
      ('f1', 'extract_failed', datetime('now'), '{}', 0),
      ('f2', 'extract_failed', datetime('now'), '{}', 0),
      ('ok', 'extract', datetime('now'), '{}', 0),
      ('m', 'email_failed', datetime('now'), '{}', 0)`);
    const result = await sendOpsDigest(env, '2026-09-02', transport);
    expect(result.flags).toEqual([
      'The reader failed 2 of 3 photo reads this week.',
      '1 email sends failed this week.',
    ]);
    expect(String(posted[0]?.subject)).toContain('2 things');
  });

  it('sends nothing without an address to send to', async () => {
    const { env, posted, transport } = await harness(null);
    const result = await sendOpsDigest(env, '2026-09-02', transport);
    expect(result.sent).toBe(false);
    expect(posted).toEqual([]);
  });
});
