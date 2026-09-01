import { describe, expect, it } from 'vitest';
import { backupToR2 } from '../src/api/worker.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// The nightly backup is the company's only off-database copy, and it used to
// load every table whole into a 128 MB isolate: it would have started failing
// at exactly the traffic level ad spend is meant to buy, which is the moment
// the copy matters most. Now it pages by rowid and streams multipart parts,
// and the events table is pruned to a retention window only after a backup
// has landed, so every pruned row survives in the backups.

function fakeBackups(failOn: 'nothing' | 'upload' = 'nothing') {
  const chunks: string[] = [];
  let completed = false;
  let aborted = false;
  const bucket = {
    createMultipartUpload: async () => ({
      uploadPart: async (partNumber: number, value: string) => {
        if (failOn === 'upload') throw new Error('r2 is down');
        chunks.push(value);
        return { partNumber, etag: `etag-${partNumber}` };
      },
      complete: async () => {
        completed = true;
        return {};
      },
      abort: async () => {
        aborted = true;
      },
    }),
  };
  return {
    bucket,
    dump: () => chunks.join(''),
    completed: () => completed,
    aborted: () => aborted,
  };
}

async function harness(failOn: 'nothing' | 'upload' = 'nothing') {
  const { db, d1 } = await migratedDatabase();
  const backups = fakeBackups(failOn);
  const env = { DB: d1, BACKUPS: backups.bucket } as never;
  return { db, env, backups };
}

describe('the nightly backup survives a big pile', () => {
  it('pages through more rows than one query carries and the dump replays whole', async () => {
    const { db, env, backups } = await harness();
    // Well past one 5,000-row page.
    const insert = db.prepare(
      "INSERT INTO events (id, event, ts, meta_json, synthetic) VALUES (?, 'page_view', ?, '{}', 0)",
    );
    for (let index = 0; index < 12_000; index += 1) {
      insert.run(`ev-${index}`, '2026-08-30T00:00:00Z');
    }

    const result = await backupToR2(env, '2026-08-31');
    expect(backups.completed()).toBe(true);
    // 12,000 events plus the 32 seeded benchmark rows.
    expect(result.rows).toBe(12_032);

    // The dump must replay whole into a second migrated database.
    const { db: replayDb } = await migratedDatabase();
    replayDb.exec(backups.dump());
    const events = replayDb.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    expect(events.n).toBe(12_000);
    const benchmarks = replayDb.prepare('SELECT COUNT(*) AS n FROM benchmarks').get() as { n: number };
    expect(benchmarks.n).toBe(32);
  });

  it('prunes stale events only after the backup landed, and records the count', async () => {
    const { db, env } = await harness();
    db.exec(
      `INSERT INTO events (id, event, ts, meta_json, synthetic) VALUES
         ('old', 'page_view', '2025-01-01T00:00:00Z', '{}', 0),
         ('fresh', 'page_view', datetime('now'), '{}', 0)`,
    );
    await backupToR2(env, '2026-08-31');
    const ids = db.prepare("SELECT id FROM events WHERE event = 'page_view'").all() as Array<{ id: string }>;
    expect(ids.map((row) => row.id)).toEqual(['fresh']);
    const completedMeta = db.prepare(
      "SELECT meta_json FROM events WHERE event = 'backup_completed'",
    ).get() as { meta_json: string };
    expect(JSON.parse(completedMeta.meta_json).pruned).toBe(1);
  });

  it('prunes nothing when the backup fails', async () => {
    const { db, env, backups } = await harness('upload');
    db.exec(
      `INSERT INTO events (id, event, ts, meta_json, synthetic)
       VALUES ('old', 'page_view', '2025-01-01T00:00:00Z', '{}', 0)`,
    );
    await expect(backupToR2(env, '2026-08-31')).rejects.toThrow('r2 is down');
    expect(backups.aborted()).toBe(true);
    const survivors = db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    expect(survivors.n).toBe(1);
  });

  it('never touches decodes, emails, or benchmarks', async () => {
    const { db, env } = await harness();
    db.exec(
      `INSERT INTO decodes (id, ts, quarter) VALUES ('ancient', '2020-01-01T00:00:00Z', '2020Q1')`,
    );
    db.exec(
      `INSERT INTO emails (id, email, decode_id, created_at)
       VALUES ('ancient-e', 'old@example.test', 'ancient', '2020-01-01T00:00:00Z')`,
    );
    await backupToR2(env, '2026-08-31');
    expect((db.prepare('SELECT COUNT(*) AS n FROM decodes').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM emails').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM benchmarks').get() as { n: number }).n).toBe(32);
  });
});
