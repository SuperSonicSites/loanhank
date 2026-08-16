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

export interface FakeD1 {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta: { changes: number } }>;
      first<T>(): Promise<T | null>;
    };
  };
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

  const d1: FakeD1 = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const statement = db.prepare(sql);
          return {
            async all<T>() {
              return { results: statement.all(...(args as never[])) as T[] };
            },
            async run() {
              const result = statement.run(...(args as never[]));
              return { meta: { changes: Number(result.changes) } };
            },
            async first<T>() {
              return (statement.get(...(args as never[])) ?? null) as T | null;
            },
          };
        },
      };
    },
  };
  return { db, d1 };
}
