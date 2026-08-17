import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

// A D1-shaped adapter over node:sqlite, so a query can be tested against real
// SQLite rather than against a fake that agrees with whatever it was told.
//
// D1 is SQLite. Testing the reminder sweep with a hand-rolled stub would prove
// the JavaScript around the query and nothing about the query, and the query
// is where the rules live: the window, the unsubscribe check, the once-only
// guard.

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export interface D1Like {
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
  first<T>(): Promise<T | null>;
}

export interface FakeD1 {
  // Real D1 lets a parameterless statement run straight off prepare(), and the
  // benchmark lookup does exactly that. An adapter that only worked after
  // bind() made a working route look like a 500, so it mirrors both shapes.
  prepare(sql: string): D1Like & { bind(...args: unknown[]): D1Like };
}

export async function migratedDatabase(): Promise<{ db: DatabaseSync; d1: FakeD1 }> {
  const db = new DatabaseSync(':memory:');
  const names = (await readdir(MIGRATIONS)).filter((n) => n.endsWith('.sql')).sort();
  for (const name of names) {
    const sql = await readFile(new URL(name, MIGRATIONS), 'utf8');
    // Comments come out FIRST, then the split. Splitting on ';' first cuts a
    // statement in half the moment a comment contains one, which is how a
    // perfectly good ALTER TABLE arrives at SQLite starting with "ADD".
    const withoutComments = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    for (const statement of withoutComments.split(';')) {
      const trimmed = statement.trim();
      if (trimmed !== '') db.exec(`${trimmed};`);
    }
  }

  const bound = (sql: string, args: unknown[]): D1Like => ({
    async all<T>() {
      return { results: db.prepare(sql).all(...(args as never[])) as T[] };
    },
    async run() {
      const result = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: Number(result.changes) } };
    },
    async first<T>() {
      return (db.prepare(sql).get(...(args as never[])) ?? null) as T | null;
    },
  });

  const d1: FakeD1 = {
    prepare(sql: string) {
      return {
        ...bound(sql, []),
        bind: (...args: unknown[]) => bound(sql, args),
      };
    },
  };
  return { db, d1 };
}
