import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { app } from '../src/api/worker.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// spec.md §9.5 and §8.2, enforced where it was found to be false.
//
// The schema test asserts no COLUMN can hold a dealer name or an SSN. That was
// true and insufficient: `events.meta_json` is a JSON blob, the extraction diff
// copied whatever keys the browser posted into it, and "nowhere to land" had a
// hole in exactly the one place nothing looked.
//
// So this drives the real route with a hostile body and then reads the
// database back, recursively, through every value in every JSON column. The
// enforcement now lives where the failure was.

const FORBIDDEN = [
  'valley ridge equipment', 'dealership', 'salesperson', 'd. weller',
  '123-45-6789', 'vr-88213', '4111111111111111', 'routing',
  'farmer@example', '555-0100', '1470 county road',
];

/** Every string anywhere inside a value, however deeply nested. */
function everyString(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    found.push(value);
    // A string might itself be JSON, which is the case that matters here.
    if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
      try {
        everyString(JSON.parse(value), found);
      } catch {
        // Not JSON. The raw string is already recorded above.
      }
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) everyString(entry, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      found.push(key);
      everyString(entry, found);
    }
  }
  return found;
}

async function harness() {
  const { db, d1 } = await migratedDatabase();
  const env = {
    DB: d1,
    DECODE_LIMIT: { limit: async () => ({ success: true }) },
    RATE_LIMIT_SALT: 'test-salt',
    TURNSTILE_SITE_KEY: '',
  } as never;

  const post = (path: string, form: Record<string, string>) =>
    app.fetch(
      new Request(`https://loanhank.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      }),
      env,
      { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {} } as never,
    );

  /** Every value in every row of every table, flattened to strings. */
  const everythingStored = () => {
    const strings: string[] = [];
    for (const table of ['decodes', 'emails', 'events', 'benchmarks']) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
      for (const row of rows) everyString(row, strings);
    }
    return strings.join(' ').toLowerCase();
  };

  return { db, post, everythingStored };
}

const LEDGER = {
  ledger: '1',
  quotedPrice: '84500',
  cashDiscount: '6000',
  payment: '1408.33',
  paymentFrequency: 'monthly',
  paymentCount: '60',
  statedRate: '0',
  region: 'NE',
};

describe('a hostile confirm screen cannot smuggle anything into the pile', () => {
  it('drops unknown keys from the extraction snapshot', async () => {
    const { post, everythingStored } = await harness();
    // Exactly the attack the audit found: the snapshot is a browser-supplied
    // string and every key in it used to be copied into events.meta_json.
    const hostile = JSON.stringify({
      quotedPrice: '84500',
      dealerName: 'Valley Ridge Equipment',
      salesperson: 'D. Weller',
      ssn: '123-45-6789',
      serial: 'VR-88213',
      customerPhone: '555-0100',
    });
    const response = await post('/decode', { ...LEDGER, extracted: hostile });
    if (response.status !== 200) {
      // Surface the real reason instead of an opaque 500.
      throw new Error(`decode failed ${response.status}: ${(await response.text()).slice(0, 400)}`);
    }

    const stored = everythingStored();
    for (const secret of FORBIDDEN) {
      expect(stored, `"${secret}" reached the database`).not.toContain(secret);
    }
    // And the key names themselves are gone, not merely their values.
    for (const key of ['dealername', 'salesperson', 'customerphone', 'serial']) {
      expect(stored, `the key "${key}" reached the database`).not.toContain(key);
    }
  });

  it('still records a real correction, so the allowlist did not just break it', async () => {
    // A closed list that drops everything is not a fix, it is a broken feature
    // that happens to be safe.
    const { db, post } = await harness();
    await post('/decode', {
      ...LEDGER,
      extracted: JSON.stringify({ quotedPrice: '80000', payment: '1408.33' }),
    });
    const rows = db.prepare("SELECT meta_json FROM events WHERE event = 'extraction_diff'")
      .all() as Array<{ meta_json: string }>;
    expect(rows).toHaveLength(1);
    const meta = JSON.parse(rows[0]?.meta_json ?? '{}');
    expect(meta.corrected_fields).toEqual(['quotedPrice']);
    expect(meta.field_count).toBe(1);
  });

  it('holds against a posted brand that is really a dealership', async () => {
    const { post, everythingStored } = await harness();
    await post('/decode', { ...LEDGER, brand: 'Valley Ridge Equipment', model: 'Dealership Co' });
    expect(everythingStored()).not.toContain('valley ridge equipment');
  });
});

describe('nothing forbidden survives an ordinary decode either', () => {
  it('stores no identifier of any kind on the happy path', async () => {
    const { post, everythingStored } = await harness();
    await post('/decode', LEDGER);
    const stored = everythingStored();
    for (const secret of FORBIDDEN) {
      expect(stored, `"${secret}" reached the database`).not.toContain(secret);
    }
  });
});

describe('campaign labels survive every decode path', () => {
  // spec.md §9.5 permits exactly four, and ops/ads.md judges channels by
  // UTM-tagged decodes. The quick path was dropping all four while page_view
  // and the ledger path kept theirs, which makes cost per completed decode a
  // number computed from two thirds of the decodes.
  const UTM = {
    utm_source: 'meta',
    utm_medium: 'cpc',
    utm_campaign: 'zero-percent-aug',
    utm_content: 'grease-pencil-a',
  };

  async function decodeEventMeta(form: Record<string, string>) {
    const { db, post } = await harness();
    await post('/decode', form);
    const row = db.prepare("SELECT meta_json FROM events WHERE event = 'decode'")
      .get() as { meta_json: string } | undefined;
    return JSON.parse(row?.meta_json ?? '{}');
  }

  it('keeps all four on the quick path', async () => {
    const meta = await decodeEventMeta({
      quotedPrice: '84500', cashDiscount: '6000', payment: '1408.33',
      paymentFrequency: 'monthly', paymentCount: '60', ...UTM,
    });
    expect(meta).toMatchObject(UTM);
  });

  it('keeps all four on the ledger path', async () => {
    const meta = await decodeEventMeta({ ...LEDGER, ...UTM });
    expect(meta).toMatchObject(UTM);
  });

  it('stores no fifth query field, whatever is posted', async () => {
    // The allowlist is the point. fbclid identifies a browser and utm_term can
    // carry a user's own search text, so neither is ours to keep.
    const meta = await decodeEventMeta({
      ...LEDGER, ...UTM, fbclid: 'IwAR-should-never-land', utm_term: 'tractor financing',
    });
    expect(meta).toMatchObject(UTM);
    expect(JSON.stringify(meta)).not.toContain('IwAR');
    expect(Object.keys(meta)).not.toContain('utm_term');
    expect(Object.keys(meta)).not.toContain('fbclid');
  });
});

describe('brand is a closed manufacturer list', () => {
  it('accepts a real manufacturer', async () => {
    const { db, post } = await harness();
    await post('/decode', { ...LEDGER, brand: 'John Deere' });
    const row = db.prepare('SELECT brand FROM decodes').get() as { brand: string | null };
    expect(row.brand).toBe('John Deere');
  });

  it('matches case-insensitively, because a farmer types how he types', async () => {
    const { db, post } = await harness();
    await post('/decode', { ...LEDGER, brand: 'case ih' });
    const row = db.prepare('SELECT brand FROM decodes').get() as { brand: string | null };
    expect(row.brand).toBe('Case IH');
  });

  it('stores null for anything that is not on the list', async () => {
    const { db, post } = await harness();
    await post('/decode', { ...LEDGER, brand: 'Valley Ridge Equipment Co.' });
    const row = db.prepare('SELECT brand FROM decodes').get() as { brand: string | null };
    // A dealership name must have no path in, even posted straight at the route.
    expect(row.brand).toBeNull();
  });

  it('offers the list on the confirm screen rather than a free box', async () => {
    const page = await readFile(new URL('../src/web/page.ts', import.meta.url), 'utf8');
    // A select can only return what we put in it, which is the whole point.
    expect(page).toContain('row.choices === undefined');
    expect(page).toContain('<option value="">Not listed</option>');
  });
});
