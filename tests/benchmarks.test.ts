import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  MAX_CELL_MOVE_BPS,
  cardProblems,
  parseAgDirectCard,
  parseBandLabel,
  parseTermLabel,
  refreshBenchmarks,
  refreshDue,
  type CardRow,
} from '../src/api/benchmarks.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// The rate card refreshes itself (spec.md section 4). The fixture is the real
// AgDirect page as fetched on 2026-09-02, carrying the September card. Every
// path that writes a row is proven here, and so is every path that refuses.

const FIXTURE = new URL('./fixtures/agdirect-rates-2026-09.html', import.meta.url);

async function page(): Promise<string> {
  return readFile(FIXTURE, 'utf8');
}

function fakeSnapshots() {
  const stored = new Map<string, string>();
  return {
    bucket: { put: async (key: string, value: string) => { stored.set(key, value); } },
    stored,
  };
}

async function harness(html: string | null, status = 200) {
  const { db, d1 } = await migratedDatabase();
  const snapshots = fakeSnapshots();
  const env = { DB: d1, SNAPSHOTS: snapshots.bucket } as never;
  const fetcher = (async () => {
    if (html === null) throw new Error('network down');
    return new Response(html, { status });
  }) as unknown as typeof fetch;
  return { db, env, snapshots, fetcher };
}

describe('the labels parse into the seed’s own forms', () => {
  it('reads an open band and a closed band', () => {
    expect(parseBandLabel(' $250,000 + ')).toEqual({ amountBand: '$250,000+', amountMinCents: 25_000_000, amountMaxCents: null });
    expect(parseBandLabel('$100,000 - $249,999')).toEqual({
      amountBand: '$100,000-$249,999', amountMinCents: 10_000_000, amountMaxCents: 24_999_900,
    });
    expect(parseBandLabel('$99,999 - $25,000')).toBeNull();
    expect(parseBandLabel('everything')).toBeNull();
  });

  it('reads a term range and a single term in months', () => {
    expect(parseTermLabel('2 - 3 years')).toEqual({ termBand: '2-3 years', termMinMonths: 24, termMaxMonths: 36 });
    expect(parseTermLabel('4 years')).toEqual({ termBand: '4 years', termMinMonths: 48, termMaxMonths: 48 });
    expect(parseTermLabel('7 - 6 years')).toBeNull();
  });
});

describe('the AgDirect page parses into a card', () => {
  it('reads the September card whole', async () => {
    const card = parseAgDirectCard(await page());
    expect(card.asOfDate).toBe('2026-09-01');
    expect(card.validThrough).toBe('2026-09-30');
    expect(card.rows).toHaveLength(32);
    const cell = (band: string, term: string, kind: 'fixed' | 'variable') =>
      card.rows.find((row) => row.amountBand === band && row.termBand === term && row.rateKind === kind)?.rateBps;
    expect(cell('$250,000+', '6-7 years', 'fixed')).toBe(675);
    expect(cell('$25,000-$99,999', '2-3 years', 'fixed')).toBe(725);
    expect(cell('$5,000-$24,999', '5 years', 'variable')).toBe(599);
    expect(cell('$100,000-$249,999', '4 years', 'fixed')).toBe(675);
  });

  it('refuses a page with no validity sentence', async () => {
    const html = (await page()).replace(/Rates effective/g, 'Rates were');
    expect(() => parseAgDirectCard(html)).toThrow('no "Rates effective" sentence');
  });

  it('refuses a table whose header changed shape', async () => {
    const html = (await page()).replace('<th scope="col">Fixed Rate</th>', '<th scope="col">APR</th>');
    expect(() => parseAgDirectCard(html)).toThrow('unexpected table header');
  });

  it('refuses a rate that does not parse as a rate', async () => {
    const html = (await page()).replace('<td>6.50%</td>', '<td>call us</td>');
    expect(() => parseAgDirectCard(html)).toThrow('unreadable rate');
  });
});

describe('a parsed card is guarded before it is trusted', () => {
  it('passes the real card against the seeded August card', async () => {
    const card = parseAgDirectCard(await page());
    const { db } = await migratedDatabase();
    const previous = db.prepare(
      "SELECT amount_band AS amountBand, term_band AS termBand, rate_kind AS rateKind, rate_bps AS rateBps FROM benchmarks WHERE as_of_date = '2026-08-01'",
    ).all() as never[];
    expect(cardProblems(card, previous)).toEqual([]);
  });

  it('refuses a cell that moved further than a card moves in a month', async () => {
    const card = parseAgDirectCard(await page());
    const previous = card.rows.map((row) => ({ ...row, rateBps: row.rateBps + MAX_CELL_MOVE_BPS + 1 }));
    const problems = cardProblems(card, previous);
    expect(problems.length).toBe(32);
    expect(problems[0]).toContain('more than a card moves in a month');
  });

  it('refuses a card that lost or grew a cell', async () => {
    const card = parseAgDirectCard(await page());
    const previous = [...card.rows, { amountBand: '$500,000+', termBand: '4 years', rateKind: 'fixed' as const, rateBps: 600 }];
    expect(cardProblems(card, previous).join(' ')).toContain('lost a cell');
    const shrunk = card.rows.slice(1);
    expect(cardProblems(card, shrunk).join(' ')).toContain('grew a cell');
  });

  it('refuses a unit error even with no card to compare against', async () => {
    const card = parseAgDirectCard(await page());
    card.rows[0] = { ...(card.rows[0] as CardRow), rateBps: 65_000 };
    expect(cardProblems(card, []).join(' ')).toContain('unit error');
  });
});

describe('refreshBenchmarks writes only what survives the guards', () => {
  it('writes the September card behind the August one, archived first', async () => {
    const { db, env, snapshots, fetcher } = await harness(await page());
    const outcome = await refreshBenchmarks(env, '2026-09-02', fetcher);
    expect(outcome.outcome).toBe('refreshed');
    const rows = db.prepare("SELECT COUNT(*) AS n FROM benchmarks WHERE as_of_date = '2026-09-01'").get() as { n: number };
    expect(rows.n).toBe(32);
    const sample = db.prepare("SELECT * FROM benchmarks WHERE id = 'agdirect-2026-09-01-25k-5y-fixed'").get() as Record<string, unknown>;
    expect(sample.rate_bps).toBe(725);
    expect(sample.valid_through).toBe('2026-09-30');
    expect(sample.snapshot_key).toBe('benchmarks/agdirect/2026-09-01.html');
    expect(sample.tier).toBe(1);
    expect(snapshots.stored.has('benchmarks/agdirect/2026-09-01.html')).toBe(true);
    // The August card is untouched: append only, a past verdict stays checkable.
    const august = db.prepare("SELECT COUNT(*) AS n FROM benchmarks WHERE as_of_date = '2026-08-01'").get() as { n: number };
    expect(august.n).toBe(32);
    const event = db.prepare("SELECT meta_json FROM events WHERE event = 'benchmark_refreshed'").get() as { meta_json: string };
    expect(JSON.parse(event.meta_json).rows).toBe(32);
  });

  it('is idempotent: the same card twice is unchanged', async () => {
    const { db, env, fetcher } = await harness(await page());
    await refreshBenchmarks(env, '2026-09-02', fetcher);
    const second = await refreshBenchmarks(env, '2026-09-03', fetcher);
    expect(second.outcome).toBe('unchanged');
    const rows = db.prepare('SELECT COUNT(*) AS n FROM benchmarks').get() as { n: number };
    expect(rows.n).toBe(64);
  });

  it('refuses a misread card, writes nothing, and archives the page for a person', async () => {
    const html = (await page()).replace('<td>7.25%</td>', '<td>72.50%</td>');
    const { db, env, snapshots, fetcher } = await harness(html);
    const outcome = await refreshBenchmarks(env, '2026-09-02', fetcher);
    expect(outcome.outcome).toBe('refused');
    if (outcome.outcome === 'refused') {
      expect(outcome.reasons.join(' ')).toContain('more than a card moves');
      expect(outcome.snapshotKey).toBe('benchmarks/agdirect/refused-2026-09-02.html');
    }
    const rows = db.prepare('SELECT COUNT(*) AS n FROM benchmarks').get() as { n: number };
    expect(rows.n).toBe(32);
    expect(snapshots.stored.has('benchmarks/agdirect/refused-2026-09-02.html')).toBe(true);
    const event = db.prepare("SELECT COUNT(*) AS n FROM events WHERE event = 'benchmark_refused'").get() as { n: number };
    expect(event.n).toBe(1);
  });

  it('reports an unreachable source and touches nothing', async () => {
    const { db, env, fetcher } = await harness(null);
    const outcome = await refreshBenchmarks(env, '2026-09-02', fetcher);
    expect(outcome.outcome).toBe('unreachable');
    const rows = db.prepare('SELECT COUNT(*) AS n FROM benchmarks').get() as { n: number };
    expect(rows.n).toBe(32);
    const event = db.prepare("SELECT COUNT(*) AS n FROM events WHERE event = 'benchmark_unreachable'").get() as { n: number };
    expect(event.n).toBe(1);
  });

  it('treats a non-200 answer as unreachable', async () => {
    const { env, fetcher } = await harness('<html>maintenance</html>', 503);
    expect((await refreshBenchmarks(env, '2026-09-02', fetcher)).outcome).toBe('unreachable');
  });
});

describe('refreshDue rations the lazy refresh', () => {
  it('is due when nothing has ever been checked', async () => {
    const { env } = await harness(null);
    expect(await refreshDue(env)).toBe(true);
  });

  it('is not due within an hour of the last attempt, whatever its outcome', async () => {
    const { env, fetcher } = await harness(null);
    await refreshBenchmarks(env, '2026-09-02', fetcher);
    expect(await refreshDue(env)).toBe(false);
    expect(await refreshDue(env, new Date(Date.now() + 2 * 60 * 60 * 1000))).toBe(true);
  });
});
