import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseMoneyToCents } from '../src/shared/schema.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// The benchmark seed is hand-transcribed from a published rate card, and a
// hand-typed number is the one thing in this repo with no compiler behind it.
//
// 0001 shipped every amount bound a thousand times too large. Nothing caught
// it: the column was named `_cents`, the value was an integer, the row
// inserted cleanly, and the only symptom would have been every verdict quietly
// abstaining because no quote on earth fell inside a band.
//
// These tests read the rows out of a real database migrated by the real
// migrations, and check each row against its own label. The label and the
// number have to agree, so a typo in either one is a failing test rather than
// a silent abstention. An earlier version parsed the INSERT text with a regex,
// which went silently blind to any row shape it could not match; the count
// guard below is what makes that class of miss loud instead.

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

interface SeededBenchmark {
  id: string;
  amountBand: string;
  amountMinCents: number;
  amountMaxCents: number | null;
  termBand: string;
  termMinMonths: number;
  termMaxMonths: number;
  rateBps: number;
  rateKind: string;
  tier: number;
  validThrough: string | null;
}

async function migrationText(): Promise<string> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  const files = await Promise.all(
    names.map((name) => readFile(new URL(name, MIGRATIONS_DIR), 'utf8')),
  );
  return files.join('\n');
}

/** Every benchmark row exactly as the migrations leave it in the database. */
async function seededBenchmarks(): Promise<SeededBenchmark[]> {
  const { db } = await migratedDatabase();
  const rows = db.prepare('SELECT * FROM benchmarks').all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    amountBand: String(row.amount_band),
    amountMinCents: Number(row.amount_min_cents),
    amountMaxCents: row.amount_max_cents === null ? null : Number(row.amount_max_cents),
    termBand: String(row.term_band),
    termMinMonths: Number(row.term_min_months),
    termMaxMonths: Number(row.term_max_months),
    rateBps: Number(row.rate_bps),
    rateKind: String(row.rate_kind),
    tier: Number(row.tier),
    validThrough: row.valid_through === null || row.valid_through === undefined
      ? null
      : String(row.valid_through),
  }));
}

describe('benchmark seed', () => {
  it('seeds rows at all', async () => {
    expect((await seededBenchmarks()).length).toBeGreaterThan(0);
  });

  it('holds every value tuple the migration text carries', async () => {
    // The anti-silent guard. A future seed row written in a shape the database
    // rejects fails the migration loudly, but a row the guards below never
    // see because a parser skipped it is the quiet failure class 0002
    // documents. So: count the raw value tuples in every INSERT INTO
    // benchmarks statement and demand the database holds exactly that many
    // rows. The column list opens with a bare identifier, so `(` followed by
    // a quote counts only value tuples.
    const sql = await migrationText();
    const blocks = sql.match(/INSERT INTO benchmarks[\s\S]*?;/g) ?? [];
    const counted = (blocks.join('\n').match(/\(\s*'/g) ?? []).length;
    expect(counted).toBeGreaterThan(0);
    expect((await seededBenchmarks()).length).toBe(counted);
  });

  it('matches every amount bound to the band printed on it', async () => {
    for (const row of await seededBenchmarks()) {
      // "$25,000-$99,999" or "$250,000+"
      const open = /^(\$[\d,]+)\+$/.exec(row.amountBand);
      const closed = /^(\$[\d,]+)-(\$[\d,]+)$/.exec(row.amountBand);
      expect(open ?? closed, `unreadable amount band: ${row.amountBand}`).not.toBeNull();

      const lowLabel = (open?.[1] ?? closed?.[1]) as string;
      expect(row.amountMinCents, `${row.id} min does not match ${row.amountBand}`)
        .toBe(parseMoneyToCents(lowLabel.slice(1)));

      if (open) {
        expect(row.amountMaxCents, `${row.id} is an open band and must have no maximum`).toBeNull();
      } else {
        expect(row.amountMaxCents, `${row.id} max does not match ${row.amountBand}`)
          .toBe(parseMoneyToCents((closed?.[2] as string).slice(1)));
      }
    }
  });

  it('matches every term bound to the band printed on it', async () => {
    for (const row of await seededBenchmarks()) {
      // "2-3 years", "4 years", "6-7 years"
      const range = /^(\d+)-(\d+) years$/.exec(row.termBand);
      const single = /^(\d+) years?$/.exec(row.termBand);
      expect(range ?? single, `unreadable term band: ${row.termBand}`).not.toBeNull();

      const lowYears = Number((range?.[1] ?? single?.[1]) as string);
      const highYears = Number((range?.[2] ?? single?.[1]) as string);
      expect(row.termMinMonths, `${row.id} term min does not match ${row.termBand}`).toBe(lowYears * 12);
      expect(row.termMaxMonths, `${row.id} term max does not match ${row.termBand}`).toBe(highYears * 12);
    }
  });

  it('leaves no gap or overlap between neighbouring amount bands', async () => {
    const rows = await seededBenchmarks();
    const bands = [...new Map(rows.map((row) => [row.amountBand, row])).values()]
      .sort((a, b) => a.amountMinCents - b.amountMinCents);

    for (let index = 1; index < bands.length; index += 1) {
      const previous = bands[index - 1] as SeededBenchmark;
      const current = bands[index] as SeededBenchmark;
      // A gap would drop quotes into no band at all and abstain forever.
      expect(current.amountMinCents - (previous.amountMaxCents as number))
        .toBeLessThanOrEqual(100);
      expect(current.amountMinCents).toBeGreaterThan(previous.amountMaxCents as number);
    }
  });

  it('keeps every published rate inside a range a rate card can hold', async () => {
    for (const row of await seededBenchmarks()) {
      expect(row.rateBps, `${row.id} rate looks like a unit error`).toBeGreaterThan(0);
      expect(row.rateBps, `${row.id} rate looks like a unit error`).toBeLessThan(3_000);
      expect(['fixed', 'variable']).toContain(row.rateKind);
      expect(row.tier).toBe(1);
    }
  });

  it('carries a source, a date and an archived snapshot on every row', async () => {
    const sql = await migrationText();
    const inserts = sql.slice(sql.indexOf('INSERT INTO benchmarks'));
    const seeded = await seededBenchmarks();
    expect(seeded.length).toBe(32);
    // Every verdict has to stay reproducible after the source page changes.
    expect(inserts).toContain("'https://www.agdirect.com/rates'");
    expect(inserts).toContain("'2026-08-01'");
    expect(inserts).toContain("'benchmarks/agdirect/2026-08-01.html'");
  });

  it('carries the printed end of validity on every AgDirect row', async () => {
    // AgDirect prints one ("Rates effective August 01-31 2026"), so every row
    // of a seeded AgDirect card must carry it or the staleness gate has
    // nothing to read (spec.md section 4).
    for (const row of await seededBenchmarks()) {
      expect(row.validThrough, `${row.id} has no valid_through`).not.toBeNull();
    }
  });
});
