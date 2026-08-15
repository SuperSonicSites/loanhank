import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseMoneyToCents } from '../src/shared/schema.js';

// The benchmark seed is hand-transcribed from a published rate card, and a
// hand-typed number is the one thing in this repo with no compiler behind it.
//
// 0001 shipped every amount bound a thousand times too large. Nothing caught
// it: the column was named `_cents`, the value was an integer, the row
// inserted cleanly, and the only symptom would have been every verdict quietly
// abstaining because no quote on earth fell inside a band.
//
// These tests read the migrations as text and check each row against its own
// label. The label and the number have to agree, so a typo in either one is a
// failing test rather than a silent abstention.

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
}

async function migrationText(): Promise<string> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  const files = await Promise.all(
    names.map((name) => readFile(new URL(name, MIGRATIONS_DIR), 'utf8')),
  );
  return files.join('\n');
}

/** Pull the seeded benchmark tuples straight out of the INSERT in 0001. */
function seededBenchmarks(sql: string): SeededBenchmark[] {
  const rows: SeededBenchmark[] = [];
  const tuple =
    /\('([^']+)',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'([^']+)',\s*(\d+),\s*(\d+|NULL),\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*'([^']+)',\s*(\d+)\)/g;
  for (const match of sql.matchAll(tuple)) {
    rows.push({
      id: match[1] as string,
      amountBand: match[2] as string,
      amountMinCents: Number(match[3]),
      amountMaxCents: match[4] === 'NULL' ? null : Number(match[4]),
      termBand: match[5] as string,
      termMinMonths: Number(match[6]),
      termMaxMonths: Number(match[7]),
      rateBps: Number(match[8]),
      rateKind: match[9] as string,
      tier: Number(match[10]),
    });
  }
  return rows;
}

/** Later UPDATEs win, the same way they do in the database. */
function applyBandCorrections(sql: string, rows: SeededBenchmark[]): SeededBenchmark[] {
  const update =
    /UPDATE benchmarks SET amount_min_cents\s*=\s*(\d+),\s*amount_max_cents\s*=\s*(\d+|NULL)\s+WHERE amount_band\s*=\s*'([^']+)'/g;
  const corrected = rows.map((row) => ({ ...row }));
  for (const match of sql.matchAll(update)) {
    for (const row of corrected) {
      if (row.amountBand === match[3]) {
        row.amountMinCents = Number(match[1]);
        row.amountMaxCents = match[2] === 'NULL' ? null : Number(match[2]);
      }
    }
  }
  return corrected;
}

describe('benchmark seed', () => {
  it('seeds rows at all', async () => {
    const rows = applyBandCorrections(await migrationText(), seededBenchmarks(await migrationText()));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('matches every amount bound to the band printed on it', async () => {
    const sql = await migrationText();
    const rows = applyBandCorrections(sql, seededBenchmarks(sql));

    for (const row of rows) {
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
    const sql = await migrationText();
    for (const row of seededBenchmarks(sql)) {
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
    const sql = await migrationText();
    const rows = applyBandCorrections(sql, seededBenchmarks(sql));
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
    for (const row of seededBenchmarks(await migrationText())) {
      expect(row.rateBps, `${row.id} rate looks like a unit error`).toBeGreaterThan(0);
      expect(row.rateBps, `${row.id} rate looks like a unit error`).toBeLessThan(3_000);
      expect(['fixed', 'variable']).toContain(row.rateKind);
      expect(row.tier).toBe(1);
    }
  });

  it('carries a source, a date and an archived snapshot on every row', async () => {
    const sql = await migrationText();
    const inserts = sql.slice(sql.indexOf('INSERT INTO benchmarks'));
    const seeded = seededBenchmarks(sql);
    expect(seeded.length).toBe(32);
    // Every verdict has to stay reproducible after the source page changes.
    expect(inserts).toContain("'https://www.agdirect.com/rates'");
    expect(inserts).toContain("'2026-08-01'");
    expect(inserts).toContain("'benchmarks/agdirect/2026-08-01.html'");
  });
});
