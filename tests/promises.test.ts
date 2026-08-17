import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sendDayFour, sendDayThirty, sendDueReminders, sendTeardown } from '../src/api/worker.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';
import { collectTestNames, unresolvedCitations } from './helpers/test-names.js';

const NEWLINE = String.fromCharCode(10);

/** Whole block comments, so a continuation line cannot pose as product copy. */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

/** After a full stop, question mark or bang, and the whitespace following it. */
const SENTENCE_BREAK = /(?<=[.?!])\s+/;

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

  // The front-door subhead. "We'll show you the number they didn't print" is
  // the whole product stated as a commitment, so it carries a sender: a decode
  // renders the computed rate, and an unpriceable one abstains instead.
  {
    phrase: "we'll show you the number they didn't print",
    keptBy: 'the decode shows the farmer the number',
  },
  { phrase: 'We will remind you', keptBy: 'a due reminder is sent and marked' },
  { phrase: 'We will send one note before', keptBy: 'a due reminder is sent and marked' },
  { phrase: 'We will not send another about this quote.', keptBy: 'a reminder is never sent twice' },
  { phrase: 'We will not email you again.', keptBy: 'an unsubscribed address is refused' },
  { phrase: 'We will say so when it does.', keptBy: 'produces a CHECKS OUT stamp from the shipped benchmark table' },

  // The follow-up sequence: disclosed at capture rather than requested, which
  // is the other half of the posture in spec.md §10.
  { phrase: "We'll follow up once about your deal", keptBy: 'day four goes out once and only once' },

  // Ads measurement (spec.md §10). The privacy page's canon ads paragraph
  // claims we can tell which ads work, which is a claim about a mechanism, so
  // it carries a sender like every other one. Its negative paths are the four
  // skips: disabled, synthetic, GPC honoured, and not from an ad. The phrase
  // is registered ahead of the Track C copy that will carry it.
  {
    phrase: 'so we can tell which ads work',
    keptBy: 'ad measurement fires from the worker, and every skip is a refusal',
  },

  // The 404 on /email. It promises a teardown follows a fresh run, and fix 2
  // is what makes that true.
  {
    phrase: 'Run your quote again and the teardown will follow.',
    keptBy: 'sends the teardown with the PDF attached',
  },

  // Caught by the broader sweep and genuinely not commitments. Each names why
  // rather than being hidden behind a narrower pattern.
  {
    phrase: 'not a promise about every future version',
    notADelivery: 'says out loud that it is NOT a promise, which is the opposite of one',
  },

  // Both found only once the sweep moved to sentence level. They shared a line
  // with a registered phrase and were passing on its coat-tails.
  {
    phrase: 'it will be something you switch on deliberately',
    keptBy: 'keeps consent language away from it entirely',
  },
  {
    phrase: "Sometimes this tool will tell you the dealer's deal is good and you should take it.",
    keptBy: 'produces a CHECKS OUT stamp from the shipped benchmark table',
  },
  {
    phrase: 'We do not guarantee any saving',
    notADelivery: 'a refusal to promise, kept by refusing rather than by a mechanism',
  },
  {
    phrase: 'will want an independent lender to quote the same deal',
    notADelivery: 'a prediction about what farmers want, not something we undertake to do',
  },
  {
    phrase: 'some farmers will later want an independent lender',
    notADelivery: 'the same prediction, restated on the FAQ',
  },
  {
    phrase: 'Because you were going to wonder',
    notADelivery: 'describes the reader, promises nothing',
  },
  {
    phrase: 'If a dealer will take six thousand dollars off for cash',
    notADelivery: 'describes what a dealer does, and dealers are not ours to promise for',
  },
  {
    phrase: 'Will you tell my dealer?',
    notADelivery: 'a question the reader asks us, answered immediately underneath',
  },
  {
    phrase: 'when the numbers for deals like yours change',
    keptBy: 'day thirty stays silent until a cohort qualifies',
  },
  { phrase: 'Unsubscribe anytime.', keptBy: 'an unsubscribed address is refused' },

  // Refusals, kept by the verdict engine rather than by a sender.
  {
    phrase: 'We will not rate a deal against published rates until the whole deal is on the table',
    keptBy: 'abstains on an unreconciled ledger however good the rate looks',
  },
  {
    phrase: 'We will not rate a deal with money in it that nobody can explain.',
    keptBy: 'abstains while any amount is unconfirmed',
  },
  {
    phrase: 'we will show your rate but hold the verdict',
    keptBy: 'abstains while any amount is unconfirmed',
  },
  { phrase: 'When we will not give a verdict', keptBy: 'abstains while any amount is unconfirmed' },

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

/**
 * Future-tense shapes worth catching.
 *
 * A bare "will", not just "we will". The narrow version missed "they will
 * appear here", "the teardown will follow" and "this page will say so plainly",
 * every one of which is a commitment somebody has to keep. It catches ordinary
 * descriptive sentences too, and those are registered with a reason rather
 * than hidden behind a narrower pattern. "you'll" joined when the protective
 * promise shipped: a promise about what the farmer will know is still ours to
 * keep, whoever the sentence's subject is.
 */
const FUTURE = /\b(will|we'll|you'll|going to|we can find)\b/gi;

async function productCopy(): Promise<string[]> {
  const found: string[] = [];
  for (const file of SOURCES) {
    const raw = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    // Block comments come out WHOLE first. Skipping only lines that OPEN a
    // comment left every continuation line looking like product copy, which
    // is how a CSS comment about print styling arrived here claiming to be a
    // promise. Same failure shape as the sweep that could not see past a '<'.
    const text = raw.replace(BLOCK_COMMENT, ' ');
    for (const line of text.split(NEWLINE)) {
      const trimmed = line.trim();
      // Line comments explain the rules and are allowed to quote them.
      if (trimmed.startsWith('//')) continue;
      // SENTENCE level, not line level. A line holding two sentences passed
      // whole the moment one registered phrase appeared anywhere in it, so a
      // registered sentence laundered every unregistered neighbour sharing
      // its line. Split first and each claim answers for itself.
      for (const sentence of trimmed.split(SENTENCE_BREAK)) {
        if (sentence.trim() === '') continue;
        if (FUTURE.test(sentence)) found.push(sentence.trim());
        FUTURE.lastIndex = 0;
      }
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

  it('resolves every named keeper to a test that really exists', async () => {
    // The keystone. A keptBy that names nothing is a promise with no sender
    // wearing a citation, and a resolver that cannot tell the difference is
    // decoration.
    // The whole suite, this file included. Excluding it would also exclude the
    // delivery tests that live here, which is a gate that fails for the wrong
    // reason. Self-matching is already impossible: names come from call sites,
    // and `keptBy: 'x'` is not a call site.
    const names = await collectTestNames();
    const unresolved = unresolvedCitations(PROMISES, names);
    expect(unresolved, unresolved.join(NEWLINE)).toEqual([]);
  });

  it('rejects a citation that names a guard which does not exist', async () => {
    // The tamper test. Everything above only means something if this fails
    // when it should, so the fabricated citation is planted here rather than
    // trusted to a human remembering to try it once.
    const names = await collectTestNames();
    const planted = unresolvedCitations(
      [{ phrase: "We'll do a thing.", keptBy: 'a guard that was never written' }],
      names,
    );
    expect(planted).toHaveLength(1);
    expect(planted[0]).toContain('a guard that was never written');
  });

  it('cannot be satisfied by the registry quoting itself', async () => {
    // The exact defect being fixed. The old resolver searched raw file text,
    // and the registry file was in the corpus, so `keptBy: 'x'` matched its
    // own registration line. Names now come from describe/it call sites only,
    // so a registry line can never look like a test.
    const names = await collectTestNames();
    expect(names.has('a guard that was never written')).toBe(false);
    // Proof the parser is reading call sites and not just any quoted string:
    // this very test's own title is present, and a keptBy value is not.
    expect(names.has('cannot be satisfied by the registry quoting itself')).toBe(true);
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
  // The send this whole law was written to protect, and the one thing that had
  // no test. The previous version of this block asserted the reminder harness
  // covered "the same sender path", which was false: there were four separate
  // fetch calls and this was the unguarded one. There is one send path now and
  // this drives it.
  async function teardownFixture() {
    const { db, d1 } = await migratedDatabase();
    db.exec(
      `INSERT INTO decodes (id, ts, quarter, finance_price_cents, cash_discount_cents,
                            cash_price_cents, amount_financed_cents, payment_amount_cents,
                            payment_count, real_rate_all_in_bps, reconciled, verdict,
                            verdict_ref_id, benchmark_at_ts)
       VALUES ('d1', '2026-08-16T00:00:00Z', '2026Q3', 8450000, 600000, 7850000, 8450000,
               140833, 60, 294, 1, 'checks_out', 'agdirect-2026-08-01-25k-5y-fixed',
               '2026-08-01')`,
    );
    const row = db.prepare('SELECT * FROM decodes WHERE id = ?').get('d1') as Record<string, unknown>;
    const env = {
      DB: d1, RESEND_API_KEY: 'test', EMAIL_FROM: 'hank@mail.test',
      POSTAL_ADDRESS: 'LoanHank, somewhere',
    } as never;
    const posted: Array<Record<string, unknown>> = [];
    const transport = async (_url: string, init: { body: string }) => {
      posted.push(JSON.parse(init.body));
      return { ok: true, status: 200 };
    };
    return { env, row, posted, transport };
  }

  it('sends the teardown with the PDF attached', async () => {
    const { env, row, posted, transport } = await teardownFixture();
    const result = await sendTeardown(
      env,
      { emailId: 'e1', to: 'farmer@example.test', row, origin: 'https://example.test' },
      transport as never,
    );
    expect(result.ok).toBe(true);
    const body = posted[0] as Record<string, unknown>;
    expect(body.to).toEqual(['farmer@example.test']);
    expect(body.subject).toBe('Your teardown');

    const attachments = body.attachments as Array<{ filename: string; content: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).toBe('loanhank-teardown.pdf');
    // Base64 of a real PDF, so a silently empty attachment fails here rather
    // than in somebody's inbox.
    const decoded = Buffer.from(attachments[0]?.content ?? '', 'base64');
    expect(decoded.subarray(0, 5).toString()).toBe('%PDF-');
    expect(decoded.byteLength).toBeGreaterThan(1_000);
  });

  it('carries the postal address and a one-click unsubscribe', async () => {
    const { env, row, posted, transport } = await teardownFixture();
    await sendTeardown(
      env,
      { emailId: 'e1', to: 'farmer@example.test', row, origin: 'https://example.test' },
      transport as never,
    );
    const body = posted[0] as Record<string, unknown>;
    expect(String(body.text)).toContain('LoanHank, somewhere');
    expect(String(body.text)).toContain('Unsubscribe: https://example.test/unsubscribe/e1');
    const headers = body.headers as Record<string, string>;
    expect(headers['List-Unsubscribe']).toBe('<https://example.test/unsubscribe/e1>');
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('refuses to send when sending is not configured', async () => {
    const { row, posted, transport } = await teardownFixture();
    const bare = { RESEND_API_KEY: '', EMAIL_FROM: '', POSTAL_ADDRESS: '' } as never;
    const result = await sendTeardown(
      bare,
      { emailId: 'e1', to: 'farmer@example.test', row, origin: 'https://example.test' },
      transport as never,
    );
    expect(result.ok).toBe(false);
    expect(posted).toEqual([]);
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
