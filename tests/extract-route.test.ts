import { describe, expect, it } from 'vitest';
import { app } from '../src/api/worker.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// The camera hero's route law.
//
// Many photos, one decode: up to four images of the same paper travel in one
// merged extraction call. The per-image size law is unchanged, the four-image
// ceiling is a 413, and EVERY failure on this route renders the typed fields
// inline beside the message, because a farmer whose photo failed is standing
// at the desk with the paper in his hand and must never meet a dead end
// without the typing path in view.

function jpeg(name: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], name, { type: 'image/jpeg' });
}

async function harness(turnstileOk: boolean) {
  const { db, d1 } = await migratedDatabase();
  const env = {
    DB: d1,
    DECODE_LIMIT: { limit: async () => ({ success: true }) },
    RATE_LIMIT_SALT: 'test-salt-16-chars-plus',
    TURNSTILE_SITE_KEY: 'site',
    TURNSTILE_SECRET_KEY: 'secret',
    OPENAI_API_KEY: 'key',
  } as never;

  // siteverify answers as told; anything else (the extraction provider) is
  // refused, so the 502 path is the real catch branch, not a mock of it.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('challenges.cloudflare.com')) {
      return new Response(
        JSON.stringify({ success: turnstileOk, action: 'extract', hostname: 'loanhank.test' }),
        { status: 200 },
      );
    }
    throw new Error(`no network in tests: ${String(url)}`);
  }) as never;

  const post = (form: FormData) => app.fetch(
    new Request('https://loanhank.test/extract', { method: 'POST', body: form }),
    env,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );

  return {
    db,
    post,
    restore() { globalThis.fetch = originalFetch; },
  };
}

function photosForm(count: number): FormData {
  const form = new FormData();
  for (let index = 0; index < count; index += 1) form.append('photo', jpeg(`page-${index + 1}.jpg`));
  form.append('cf-turnstile-response', 'token');
  return form;
}

describe('the four-image ceiling', () => {
  it('refuses a fifth photo with 413 and the canonical line', async () => {
    const { post, restore } = await harness(true);
    try {
      const response = await post(photosForm(5));
      expect(response.status).toBe(413);
      const body = await response.text();
      expect(body).toContain('One decode reads up to four photos.');
      // The typing path is in view, not behind a link.
      expect(body).toContain('name="quotedPrice"');
      expect(body).toContain('value="recovery"');
    } finally {
      restore();
    }
  });
});

describe('no farmer meets a dead end on the photo path', () => {
  it('renders the typed fields beside a turnstile refusal', async () => {
    const { post, restore } = await harness(false);
    try {
      const response = await post(photosForm(1));
      expect(response.status).toBe(403);
      const body = await response.text();
      expect(body).toContain('name="quotedPrice"');
      expect(body).toContain('name="payment"');
      expect(body).toContain('value="recovery"');
    } finally {
      restore();
    }
  });

  it('renders the typed fields beside an extraction failure, on canon', async () => {
    // The provider is unreachable in tests, so this exercises the real catch
    // branch: the read failed, the message is the canonical blurry line, and
    // the four fields render beside it.
    const { post, restore } = await harness(true);
    try {
      const response = await post(photosForm(2));
      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).toContain('Too blurry to read. Try again in better light, or type the numbers.');
      expect(body).toContain('name="quotedPrice"');
      expect(body).toContain('value="recovery"');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// The funnel can tell the three doors apart (spec.md §7.1 calibration note).
// ---------------------------------------------------------------------------

async function decodeHarness() {
  const { db, d1 } = await migratedDatabase();
  const env = {
    DB: d1,
    DECODE_LIMIT: { limit: async () => ({ success: true }) },
    RATE_LIMIT_SALT: 'test-salt-16-chars-plus',
  } as never;
  const post = (form: Record<string, string>) => app.fetch(
    new Request('https://loanhank.test/decode', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    }),
    env,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );
  const decodeMeta = () => {
    const row = db.prepare("SELECT meta_json FROM events WHERE event = 'decode'").get() as { meta_json: string };
    return JSON.parse(row.meta_json) as Record<string, unknown>;
  };
  return { post, decodeMeta };
}

const QUICK = {
  quotedPrice: '84500',
  cashDiscount: '6000',
  payment: '1408.33',
  paymentFrequency: 'monthly',
  paymentCount: '60',
};

describe('decode events name their door', () => {
  it('marks a disclosure decode as typed', async () => {
    const { post, decodeMeta } = await decodeHarness();
    expect((await post({ ...QUICK, entry: 'typed' })).status).toBe(200);
    expect(decodeMeta().entry).toBe('typed');
  });

  it('marks a failure-recovery decode as recovery', async () => {
    const { post, decodeMeta } = await decodeHarness();
    expect((await post({ ...QUICK, entry: 'recovery' })).status).toBe(200);
    expect(decodeMeta().entry).toBe('recovery');
  });

  it('refuses an invented door rather than storing it', async () => {
    // entry is browser input. Anything that is not the recovery marker reads
    // as the ordinary typed path.
    const { post, decodeMeta } = await decodeHarness();
    expect((await post({ ...QUICK, entry: 'vip-lane' })).status).toBe(200);
    expect(decodeMeta().entry).toBe('typed');
  });

  it('marks a confirmed-photo decode as hero and records its photo count', async () => {
    const { post, decodeMeta } = await decodeHarness();
    const response = await post({
      ledger: '1',
      ...QUICK,
      statedRate: '0',
      downPayment: '',
      tradeAllowance: '',
      tradePayoff: '',
      deliverySetup: '',
      taxCash: '',
      taxFinance: '',
      financeOnlyFee: '',
      region: 'NE',
      quoteDate: '',
      quoteExpiryDate: '',
      photoCount: '3',
    });
    expect(response.status).toBe(200);
    const meta = decodeMeta();
    expect(meta.entry).toBe('hero');
    expect(meta.photo_count).toBe(3);
  });

  it('clamps a lied-about photo count to the ceiling', async () => {
    const { post, decodeMeta } = await decodeHarness();
    await post({
      ledger: '1',
      ...QUICK,
      statedRate: '0',
      downPayment: '',
      tradeAllowance: '',
      tradePayoff: '',
      deliverySetup: '',
      taxCash: '',
      taxFinance: '',
      financeOnlyFee: '',
      region: 'NE',
      quoteDate: '',
      quoteExpiryDate: '',
      photoCount: '9000',
    });
    expect(decodeMeta().photo_count).toBe(4);
  });
});
