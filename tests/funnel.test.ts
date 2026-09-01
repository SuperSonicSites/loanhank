import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// The morning ritual is one query, and until now nothing ran it in a test: a
// broken funnel.sql is a blind morning that looks exactly like a quiet one.
// This runs the real file against the real schema and asserts the failure
// columns answer, so a schema change that breaks the ritual fails here first.

describe('the morning query', () => {
  it('answers with the failure columns against the real schema', async () => {
    const { db } = await migratedDatabase();
    const sql = await readFile(new URL('../ops/funnel.sql', import.meta.url), 'utf8');
    const row = db.prepare(sql).get() as Record<string, unknown>;

    for (const column of [
      'page_views', 'decodes', 'decodes_rejected', 'decodes_unpriceable',
      'extracts_failed', 'emails_failed', 'pile_total', 'pile_reconciled',
      'days_since_backup', 'days_until_benchmark_expiry',
    ]) {
      expect(row, `funnel.sql no longer answers ${column}`).toHaveProperty(column);
    }
    expect(row.extracts_failed).toBe(0);
    expect(row.emails_failed).toBe(0);
    // The seeded card is dated, so the clock must read a number, not NULL.
    expect(typeof row.days_until_benchmark_expiry).toBe('number');
  });

  it('counts a failure the moment one lands in the window', async () => {
    const { db } = await migratedDatabase();
    db.exec(
      `INSERT INTO events (id, event, ts, meta_json, synthetic)
       VALUES ('e1', 'extract_failed', datetime('now'), '{}', 0),
              ('e2', 'email_failed', datetime('now'), '{}', 0),
              ('e3', 'extract_failed', datetime('now'), '{}', 1)`,
    );
    const sql = await readFile(new URL('../ops/funnel.sql', import.meta.url), 'utf8');
    const row = db.prepare(sql).get() as Record<string, unknown>;
    // Synthetic rows stay out of the morning numbers, as everywhere.
    expect(row.extracts_failed).toBe(1);
    expect(row.emails_failed).toBe(1);
  });
});
