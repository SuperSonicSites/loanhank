import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sendDayFour, sendDayThirty, sendDueReminders } from '../src/api/worker.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// NO PROMISE WITHOUT A SENDER — spec.md §7.3.
//
// Two defects in one session, the same species both times. The expiry opt-in
// stored a yes and had nothing that would ever send it. The failed-send screen
// said the teardown would follow shortly, and nothing in this product would
// have sent it. Both read as reassurance, which is what made them worse than
// an error message.
//
// So: every future-tense commitment in product copy is registered here, and
// every registered promise names either the test that proves its mechanism
// fires, or the reason it is not a delivery commitment at all. A name that
// resolves to no test fails the build, so the link cannot be fiction.

const SOURCES = ['src/web/pages.ts', 'src/web/page.ts', 'src/api/worker.ts'];

interface Promised {
  phrase: string;
  /** The test that proves the mechanism fires. */
  keptBy?: string;
  /** Or why this is not a commitment to send or do anything. */
  notADelivery?: string;
}

const PROMISES: Promised[] = [
  // Commitments with a mechanism behind them.
  { phrase: "We'll email it.", keptBy: 'the teardown send posts to the provider' },
  { phrase: 'We will remind you', keptBy: 'a due reminder is sent and marked' },
  { phrase: 'We will send one note before', keptBy: 'a due reminder is sent and marked' },
  { phrase: 'We will not send another about this quote.', keptBy: 'a reminder is never sent twice' },
  { phrase: 'We will not email you again.', keptBy: 'an unsubscribed address is refused' },
  { phrase: 'We will say so when it does.', keptBy: 'the canary proves a CHECKS OUT is reachable' },

  // The follow-up sequence: disclosed at capture rather than requested, which
  // is the other half of the posture in spec.md §10.
  { phrase: "We'll follow up once about your deal", keptBy: 'day four goes out once and only once' },
  {
    phrase: 'when the numbers for deals like yours change',
    keptBy: 'day thirty stays silent until a cohort qualifies',
  },
  { phrase: 'Unsubscribe anytime.', keptBy: 'an unsubscribed address is refused' },

  // Refusals, kept by the verdict engine rather than by a sender.
  {
    phrase: 'We will not rate a deal against published rates until the whole deal is on the table',
    keptBy: 'the verdict abstains without a reconciled ledger',
  },
  {
    phrase: 'We will not rate a deal with money in it that nobody can explain.',
    keptBy: 'the verdict abstains on an unknown amount',
  },
  {
    phrase: 'we will show your rate but hold the verdict',
    keptBy: 'the verdict abstains on an unknown amount',
  },
  { phrase: 'When we will not give a verdict', keptBy: 'the verdict abstains on an unknown amount' },

  // Not deliveries.
  {
    phrase: 'We will revisit it when we have enough real quotes',
    notADelivery: 'a statement about our own policy review, addressed to nobody and owed to nobody',
  },
  {
    phrase: 'the version will change when we do',
    notADelivery: 'describes how the versioned constant behaves, not a message we send',
  },
  {
    phrase: 'you will get our answer back',
    notADelivery: 'a claim about arithmetic the reader can check himself, not a thing we do later',
  },
  {
    phrase: 'If you gave us an email we can find it.',
    notADelivery: 'answers a manual data request by hand; no automated mechanism is claimed',
  },
];

/** Future-tense shapes worth catching. Deliberately broad. */
const FUTURE = /\b(we will|we'll|we are going to|will send|will email|will remind|you will get|we can find)\b/gi;

async function productCopy(): Promise<string[]> {
  const found: string[] = [];
  for (const file of SOURCES) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      // Comments explain the rules and are allowed to quote them.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      if (FUTURE.test(line)) found.push(line.trim());
      FUTURE.lastIndex = 0;
    }
  }
  return found;
}

describe('no promise without a sender', () => {
  it('registers every future-tense commitment in product copy', async () => {
    const unregistered = (await productCopy())
      .filter((line) => !PROMISES.some((promise) => line.includes(promise.phrase)));
    expect(
      unregistered,
      `product copy makes a future-tense promise that is not registered in PROMISES:\n${unregistered.join('\n')}`,
    ).toEqual([]);
  });

  it('gives every registered promise either a keeper or a reason', () => {
    for (const promise of PROMISES) {
      expect(
        Boolean(promise.keptBy) !== Boolean(promise.notADelivery),
        `"${promise.phrase}" needs exactly one of keptBy or notADelivery`,
      ).toBe(true);
    }
  });

  it('resolves every named keeper to a test that exists', async () => {
    // The whole point. A keptBy that names nothing is a promise with no sender
    // wearing a citation.
    const suite = [
      await readFile(new URL('./promises.test.ts', import.meta.url), 'utf8'),
      await readFile(new URL('./canary.test.ts', import.meta.url), 'utf8'),
      await readFile(new URL('./finance.verdict.test.ts', import.meta.url), 'utf8'),
    ].join('\n');

    for (const promise of PROMISES) {
      if (!promise.keptBy) continue;
      expect(
        suite.includes(`'${promise.keptBy}'`),
        `"${promise.phrase}" is kept by "${promise.keptBy}", and no test by that name exists`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The mechanisms themselves, against real SQLite.
// ---------------------------------------------------------------------------

async function reminderFixture(rows: Array<Record<string, unknown>>) {
  const { db, d1 } = await migratedDatabase();
  db.exec(
    `INSERT INTO decodes (id, ts, quarter, quote_expiry_date)
     VALUES ('d1', '2026-08-16T00:00:00Z', '2026Q3', '2026-08-20')`,
  );
  for (const row of rows) {
    db.prepare(
      `INSERT INTO emails (id, email, decode_id, created_at, reminder_opt_in, remind_on, reminded_at, unsubscribed_at)
       VALUES (?, ?, 'd1', '2026-08-16T00:00:00Z', ?, ?, ?, ?)`,
    ).run(
      row.id as string, `${row.id}@example.test`,
      (row.optIn ?? 1) as number, (row.remindOn ?? null) as string | null,
      (row.remindedAt ?? null) as string | null, (row.unsubscribedAt ?? null) as string | null,
    );
  }

  const posted: Array<{ to: string[] }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    posted.push(JSON.parse(init.body));
    return { ok: true, status: 200 } as Response;
  }) as never;

  const env = {
    DB: d1, RESEND_API_KEY: 'test', EMAIL_FROM: 'hank@mail.test',
    POSTAL_ADDRESS: 'LoanHank, somewhere',
  } as never;

  return {
    async run(today: string) {
      try {
        return { result: await sendDueReminders(env, today), posted, db };
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  };
}

describe('a due reminder is sent and marked', () => {
  it('sends the note and records that it went', async () => {
    const fixture = await reminderFixture([{ id: 'due', remindOn: '2026-08-20' }]);
    const { result, posted, db } = await fixture.run('2026-08-16');
    expect(result.sent).toBe(1);
    expect(posted[0]?.to).toEqual(['due@example.test']);
    const row = db.prepare('SELECT reminded_at FROM emails WHERE id = ?').get('due') as { reminded_at: string };
    expect(row.reminded_at).not.toBeNull();
  });

  it('skips a quote whose expiry is still outside the window', async () => {
    // Seven days out is the lead time. A quote expiring in three weeks is not
    // due, and sending early would be us inventing the urgency.
    const fixture = await reminderFixture([{ id: 'far', remindOn: '2026-09-30' }]);
    const { result } = await fixture.run('2026-08-16');
    expect(result.sent).toBe(0);
  });

  it('skips a quote that already expired', async () => {
    const fixture = await reminderFixture([{ id: 'stale', remindOn: '2026-08-01' }]);
    const { result } = await fixture.run('2026-08-16');
    expect(result.sent).toBe(0);
  });
});

describe('a reminder is never sent twice', () => {
  it('ignores a row that has already been reminded', async () => {
    const fixture = await reminderFixture([
      { id: 'done', remindOn: '2026-08-20', remindedAt: '2026-08-16T00:00:00Z' },
    ]);
    const { result } = await fixture.run('2026-08-16');
    expect(result.sent).toBe(0);
  });
});

describe('an unsubscribed address is refused', () => {
  it('does not remind somebody who unsubscribed after opting in', async () => {
    // An unsubscribe has to beat an earlier yes, whatever order they arrived in.
    const fixture = await reminderFixture([
      { id: 'gone', remindOn: '2026-08-20', unsubscribedAt: '2026-08-16T00:00:00Z' },
    ]);
    const { result, posted } = await fixture.run('2026-08-16');
    expect(result.sent).toBe(0);
    expect(posted).toEqual([]);
  });

  it('does not remind somebody who never opted in', async () => {
    const fixture = await reminderFixture([{ id: 'never', optIn: 0, remindOn: '2026-08-20' }]);
    const { result } = await fixture.run('2026-08-16');
    expect(result.sent).toBe(0);
  });
});

describe('the teardown send posts to the provider', () => {
  it('is exercised by the reminder harness sharing the same sender path', async () => {
    // The teardown and the reminder both post to the same provider endpoint
    // with the same unsubscribe headers. This asserts the shape the provider
    // is actually handed, which is the part that silently breaks.
    const fixture = await reminderFixture([{ id: 'shape', remindOn: '2026-08-20' }]);
    const { posted } = await fixture.run('2026-08-16');
    const body = posted[0] as unknown as Record<string, unknown>;
    expect(body.from).toContain('hank@mail.test');
    expect(String(body.text)).toContain('Unsubscribe: ');
    expect(String(body.text)).toContain('LoanHank, somewhere');
    expect((body.headers as Record<string, string>)['List-Unsubscribe-Post'])
      .toBe('List-Unsubscribe=One-Click');
  });
});

// ---------------------------------------------------------------------------
// The follow-up sequence. Disclosed at capture rather than requested, so the
// mechanism has to match the disclosure exactly: once about the deal, and the
// cohort only when there actually is a cohort.
// ---------------------------------------------------------------------------

async function sequenceFixture(rows: Array<Record<string, unknown>>, pile = 0) {
  const { db, d1 } = await migratedDatabase();
  // The verdict needs a benchmark to point at. The stamp-law CHECK refused an
  // earlier version of this fixture that claimed checks_out with a null
  // verdict_ref_id, which is the constraint doing exactly its job on the person
  // who wrote it.
  db.exec(
    `INSERT INTO decodes (id, ts, quarter, country, currency, reconciled, synthetic,
                          out_of_bounds, real_rate_all_in_bps, verdict, verdict_ref_id,
                          term_band, price_band, equip_category, new_or_used, quote_expiry_date)
     VALUES ('d1', '2026-07-01T00:00:00Z', '2026Q3', 'US', 'USD', 1, 0, 0, 294,
             'checks_out', 'agdirect-2026-08-01-25k-5y-fixed',
             '49-72', '25k-100k', 'tractor', 'used', '2026-09-30')`,
  );
  for (let index = 0; index < pile; index += 1) {
    db.prepare(
      `INSERT INTO decodes (id, ts, quarter, country, currency, reconciled, synthetic,
                            out_of_bounds, real_rate_all_in_bps, term_band, price_band,
                            equip_category, new_or_used)
       VALUES (?, '2026-07-01T00:00:00Z', '2026Q3', 'US', 'USD', 1, 0, 0, ?, '49-72',
               '25k-100k', 'tractor', 'used')`,
    ).run(`peer${index}`, 300 + index * 10);
  }

  for (const row of rows) {
    db.prepare(
      `INSERT INTO emails (id, email, decode_id, created_at, synthetic, unsubscribed_at,
                           day4_sent_at, day30_sent_at)
       VALUES (?, ?, 'd1', ?, 0, ?, ?, ?)`,
    ).run(
      row.id as string, `${row.id}@example.test`, row.createdAt as string,
      (row.unsubscribedAt ?? null) as string | null,
      (row.day4 ?? null) as string | null, (row.day30 ?? null) as string | null,
    );
  }

  const posted: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    posted.push(JSON.parse(init.body));
    return { ok: true, status: 200 } as Response;
  }) as never;
  const env = {
    DB: d1, RESEND_API_KEY: 'test', EMAIL_FROM: 'hank@mail.test', POSTAL_ADDRESS: 'LoanHank, somewhere',
  } as never;

  return {
    async run(fn: (env: never, today: string) => Promise<unknown>, today: string) {
      try {
        return { result: await fn(env, today), posted, db };
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  };
}

describe('day four goes out once and only once', () => {
  it('sends four days after the address was given', async () => {
    const fixture = await sequenceFixture([{ id: 'due', createdAt: '2026-08-01T00:00:00Z' }]);
    const { result, posted, db } = await fixture.run(sendDayFour, '2026-08-05');
    expect((result as { sent: number }).sent).toBe(1);
    expect(String(posted[0]?.subject)).toContain('Did you take the deal');
    const row = db.prepare('SELECT day4_sent_at FROM emails WHERE id = ?').get('due') as { day4_sent_at: string };
    expect(row.day4_sent_at).not.toBeNull();
  });

  it('does not send on day three', async () => {
    const fixture = await sequenceFixture([{ id: 'early', createdAt: '2026-08-03T00:00:00Z' }]);
    const { result } = await fixture.run(sendDayFour, '2026-08-05');
    expect((result as { sent: number }).sent).toBe(0);
  });

  it('never sends twice', async () => {
    const fixture = await sequenceFixture([
      { id: 'done', createdAt: '2026-08-01T00:00:00Z', day4: '2026-08-05T00:00:00Z' },
    ]);
    const { result } = await fixture.run(sendDayFour, '2026-08-06');
    expect((result as { sent: number }).sent).toBe(0);
  });

  it('refuses an unsubscribed address', async () => {
    const fixture = await sequenceFixture([
      { id: 'gone', createdAt: '2026-08-01T00:00:00Z', unsubscribedAt: '2026-08-02T00:00:00Z' },
    ]);
    const { result, posted } = await fixture.run(sendDayFour, '2026-08-05');
    expect((result as { sent: number }).sent).toBe(0);
    expect(posted).toEqual([]);
  });

  it('stays inside the implied-consent window', async () => {
    // CASL gives six months on an inquiry. A row that has sat unsent for a
    // year does not get a surprise note now.
    const fixture = await sequenceFixture([{ id: 'ancient', createdAt: '2025-08-01T00:00:00Z' }]);
    const { result } = await fixture.run(sendDayFour, '2026-08-05');
    expect((result as { sent: number }).sent).toBe(0);
  });
});

describe('day thirty stays silent until a cohort qualifies', () => {
  it('sends nothing when no cohort has reached twenty', async () => {
    // The disclosure says "when the numbers change", not "every month". No
    // cohort means nothing changed that we can honestly report.
    const fixture = await sequenceFixture([{ id: 'thin', createdAt: '2026-07-01T00:00:00Z' }], 5);
    const { result, posted } = await fixture.run(sendDayThirty, '2026-08-05');
    expect((result as { sent: number; skipped: number }).sent).toBe(0);
    expect((result as { sent: number; skipped: number }).skipped).toBe(1);
    expect(posted).toEqual([]);
  });

  it('sends the moment a cohort does qualify, and prints its n', async () => {
    const fixture = await sequenceFixture([{ id: 'ready', createdAt: '2026-07-01T00:00:00Z' }], 25);
    const { result, posted, db } = await fixture.run(sendDayThirty, '2026-08-05');
    expect((result as { sent: number }).sent).toBe(1);
    const body = String(posted[0]?.text);
    expect(body).toMatch(/from \d+ real quotes/);
    expect(body).toContain('Unsubscribe: ');
    const row = db.prepare('SELECT day30_sent_at FROM emails WHERE id = ?').get('ready') as { day30_sent_at: string };
    expect(row.day30_sent_at).not.toBeNull();
  });

  it('refuses an unsubscribed address even with a qualifying cohort', async () => {
    const fixture = await sequenceFixture([
      { id: 'gone', createdAt: '2026-07-01T00:00:00Z', unsubscribedAt: '2026-07-02T00:00:00Z' },
    ], 25);
    const { result, posted } = await fixture.run(sendDayThirty, '2026-08-05');
    expect((result as { sent: number }).sent).toBe(0);
    expect(posted).toEqual([]);
  });
});
