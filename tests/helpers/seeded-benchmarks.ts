import { readdir, readFile } from 'node:fs/promises';
import type { BenchmarkRow } from '../../src/finance/index.js';

// Reads the benchmark table out of the migrations as text, applying later
// corrections the way the database would. Tests that use this are checking the
// data that actually ships, not a convenient copy of it.

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

export async function migrationText(): Promise<string> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  const files = await Promise.all(
    names.map((name) => readFile(new URL(name, MIGRATIONS_DIR), 'utf8')),
  );
  return files.join('\n');
}

function parseInserts(sql: string): BenchmarkRow[] {
  const rows: BenchmarkRow[] = [];
  const tuple =
    /\('([^']+)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']+)',\s*(\d+),\s*(\d+|NULL),\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*'([^']+)',\s*(\d+)\)/g;
  for (const m of sql.matchAll(tuple)) {
    rows.push({
      id: m[1] as string,
      source: m[2] as string,
      sourceUrl: m[3] as string,
      asOfDate: m[4] as string,
      amountBand: m[6] as string,
      amountMinCents: Number(m[7]),
      amountMaxCents: m[8] === 'NULL' ? null : Number(m[8]),
      termBand: m[9] as string,
      termMinMonths: Number(m[10]),
      termMaxMonths: Number(m[11]),
      rateBps: Number(m[12]),
      rateKind: (m[13] as string) === 'variable' ? 'variable' : 'fixed',
      tier: Number(m[14]),
      // The seed is American. 0003 makes it explicit in the table.
      country: 'US',
    });
  }
  return rows;
}

function applyCorrections(sql: string, rows: BenchmarkRow[]): BenchmarkRow[] {
  const update =
    /UPDATE benchmarks SET amount_min_cents\s*=\s*(\d+),\s*amount_max_cents\s*=\s*(\d+|NULL)\s+WHERE amount_band\s*=\s*'([^']+)'/g;
  const corrected = rows.map((row) => ({ ...row }));
  for (const m of sql.matchAll(update)) {
    for (const row of corrected) {
      if (row.amountBand === m[3]) {
        row.amountMinCents = Number(m[1]);
        row.amountMaxCents = m[2] === 'NULL' ? null : Number(m[2]);
      }
    }
  }
  return corrected;
}

/** Every benchmark row exactly as the migrations leave it. */
export async function seededBenchmarks(): Promise<BenchmarkRow[]> {
  const sql = await migrationText();
  return applyCorrections(sql, parseInserts(sql));
}
