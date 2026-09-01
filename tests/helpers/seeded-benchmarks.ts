import type { BenchmarkRow } from '../../src/finance/index.js';
import { migratedDatabase } from './d1-sqlite.js';

// Reads the benchmark table out of a real SQLite database migrated by the real
// migrations, so tests that use this are checking the data that actually
// ships, not a convenient copy of it.
//
// This used to parse the INSERT tuples out of the migration text with a regex.
// That parser went silently blind to any row shape it could not match, which
// is the same failure class migration 0002 documents: a quiet miss on the very
// operation the guard exists for. The database applies every migration or
// fails loudly, so reading it back cannot skip a row.

export async function seededBenchmarks(): Promise<BenchmarkRow[]> {
  const { db } = await migratedDatabase();
  const rows = db.prepare('SELECT * FROM benchmarks').all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    source: String(row.source),
    sourceUrl: String(row.source_url),
    asOfDate: String(row.as_of_date),
    amountBand: String(row.amount_band),
    amountMinCents: Number(row.amount_min_cents),
    amountMaxCents: row.amount_max_cents === null ? null : Number(row.amount_max_cents),
    termBand: String(row.term_band),
    termMinMonths: Number(row.term_min_months),
    termMaxMonths: Number(row.term_max_months),
    rateBps: Number(row.rate_bps),
    rateKind: String(row.rate_kind) === 'variable' ? 'variable' : 'fixed',
    tier: Number(row.tier),
    country: String(row.country) === 'CA' ? 'CA' : 'US',
    validThrough: row.valid_through === null || row.valid_through === undefined
      ? null
      : String(row.valid_through),
  }));
}
