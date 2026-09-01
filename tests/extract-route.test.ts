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

describe('the upload ceilings', () => {
  const bigJpeg = (name: string, sizeBytes: number): File => {
    const bytes = new Uint8Array(sizeBytes);
    bytes.set([0xff, 0xd8, 0xff]);
    return new File([bytes], name, { type: 'image/jpeg' });
  };

  it('refuses photos that together top the total cap with 413', async () => {
    // Four files each under the per-file law, 28 MB summed. Buffered and
    // base64-doubled that is more than a 128 MB isolate survives, so the cap
    // is on the decode, not just the file.
    const { post, restore } = await harness(true);
    try {
      const form = new FormData();
      for (let index = 0; index < 4; index += 1) form.append('photo', bigJpeg(`page-${index + 1}.jpg`, 7 * 1024 * 1024));
      form.append('cf-turnstile-response', 'token');
      const response = await post(form);
      expect(response.status).toBe(413);
      const body = await response.text();
      expect(body).toContain('Those photos add up to more than we can take in one upload.');
      expect(body).toContain('name="quotedPrice"');
      expect(body).toContain('value="recovery"');
    } finally {
      restore();
    }
  });

  it('refuses a file whose bytes are not the type it claims', async () => {
    const { post, restore } = await harness(true);
    try {
      const form = new FormData();
      form.append('photo', new File([new TextEncoder().encode('GIF89a-not-a-jpeg')], 'sneaky.jpg', { type: 'image/jpeg' }));
      form.append('cf-turnstile-response', 'token');
      const response = await post(form);
      expect(response.status).toBe(422);
      const body = await response.text();
      expect(body).toContain('One of those files is either too large or not a photo we can read.');
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

  it('says the reader is down when the provider is unreachable, typed fields beside', async () => {
    // The provider is unreachable in tests, so this exercises the real catch
    // branch: primary fails, the fallback is tried and fails too, and the
    // farmer is told the truth instead of being blamed for his photo.
    const { db, post, restore } = await harness(true);
    try {
      const response = await post(photosForm(2));
      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).toContain('Our reader is down right now, not your photo.');
      expect(body).not.toContain('Too blurry');
      expect(body).toContain('name="quotedPrice"');
      expect(body).toContain('value="recovery"');
      const event = db.prepare("SELECT meta_json FROM events WHERE event = 'extract_failed'").get() as
        { meta_json: string } | undefined;
      const meta = JSON.parse(event?.meta_json ?? '{}') as Record<string, unknown>;
      expect(meta.kind).toBe('provider');
      expect(meta.fallback_tried).toBe(true);
    } finally {
      restore();
    }
  });
});

// A schema-valid extraction for driving the route with a stubbed client.
function stubExtraction() {
  const money = (value: number | null) => ({ value_cents: value, confidence: value === null ? 0 : 0.99 });
  const plain = <T>(value: T | null) => ({ value, confidence: value === null ? 0 : 0.99 });
  return {
    document_type: 'equipment_quote' as const,
    quoted_price: money(8_450_000),
    cash_discount: money(600_000),
    payment_amount: money(140_833),
    payment_frequency: plain<'monthly'>('monthly'),
    payment_count: plain(60),
    stated_rate_bps: plain(0),
    down_payment: money(0),
    trade_allowance: money(0),
    trade_payoff: money(null),
    balloon: money(null),
    delivery_setup: money(0),
    quote_date: plain('2026-08-11'),
    quote_expiry_date: plain('2026-08-31'),
    brand: plain('John Deere'),
    model_year: plain(2021),
    hours: plain(1_240),
    list_price: money(9_120_000),
    new_or_used: plain<'used'>('used'),
    warnings: [],
  };
}

describe('the reader recovers and abstains through the route', () => {
  it('recovers through the fallback model end to end', async () => {
    const { post, restore } = await harness(true);
    try {
      let calls = 0;
      const client = {
        responses: {
          parse: async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error('server error'), { status: 500 });
            return { output_parsed: stubExtraction() };
          },
        },
      };
      const { d1 } = await migratedDatabase();
      const response = await app.fetch(
        new Request('https://loanhank.test/extract', { method: 'POST', body: photosForm(1) }),
        {
          DB: d1,
          DECODE_LIMIT: { limit: async () => ({ success: true }) },
          RATE_LIMIT_SALT: 'test-salt-16-chars-plus',
          TURNSTILE_SITE_KEY: 'site',
          TURNSTILE_SECRET_KEY: 'secret',
          OPENAI_API_KEY: 'key',
          OPENAI_CLIENT: client,
        } as never,
        { waitUntil: () => {}, passThroughOnException: () => {} } as never,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Check these against your paper.');
      expect(calls).toBe(2);
    } finally {
      restore();
    }
  });

  it('shows the blurry line for an unreadable result', async () => {
    const { post, restore } = await harness(true);
    try {
      const client = { responses: { parse: async () => ({ output_parsed: null }) } };
      const { d1 } = await migratedDatabase();
      const response = await app.fetch(
        new Request('https://loanhank.test/extract', { method: 'POST', body: photosForm(1) }),
        {
          DB: d1,
          DECODE_LIMIT: { limit: async () => ({ success: true }) },
          RATE_LIMIT_SALT: 'test-salt-16-chars-plus',
          TURNSTILE_SITE_KEY: 'site',
          TURNSTILE_SECRET_KEY: 'secret',
          OPENAI_API_KEY: 'key',
          OPENAI_CLIENT: client,
        } as never,
        { waitUntil: () => {}, passThroughOnException: () => {} } as never,
      );
      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).toContain('Too blurry to read.');
      expect(body).not.toContain('reader is down');
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
  return { db, post, decodeMeta };
}

const QUICK = {
  quotedPrice: '84500',
  cashDiscount: '6000',
  payment: '1408.33',
  paymentFrequency: 'monthly',
  paymentCount: '60',
};

describe('the decode shows the farmer the number', () => {
  // The subhead promises "we'll show you the number they didn't print", which
  // is a future-tense commitment and needs a sender like every other one
  // (spec.md §7.3). This is that sender: a decode comes back with the rate
  // rendered in the headline slot, not merely with a 200.
  // The rate lands in markup, never merely in the stylesheet. Asserting on the
  // bare class name passed on the inlined CSS, which every page carries, so
  // the check proved nothing until it was anchored to the rendered tag.
  const RATE_RENDERED = /class="headline-rate">\d+\.\d{2}%</;

  it('renders the computed rate on the ticket', async () => {
    const { post } = await decodeHarness();
    const response = await post({ ...QUICK, entry: 'typed' });
    expect(response.status).toBe(200);
    // A real figure in the slot, never an empty box where the number goes.
    expect(await response.text()).toMatch(RATE_RENDERED);
  });

  it('says so plainly rather than printing a number it cannot stand behind', async () => {
    // The other half of the same promise. Numbers that do not add up to a
    // deal get an abstention, not a figure.
    const { post } = await decodeHarness();
    const response = await post({ ...QUICK, payment: '1', entry: 'typed' });
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).not.toMatch(RATE_RENDERED);
    expect(body).not.toContain('class="headline-rate">');
  });
});

describe('a balloon rides the quick path whole', () => {
  // spec.md 2.2: balloon is a ledger field, and the quick path asks for it too
  // because a balloon deal priced without its balloon is a confidently wrong
  // number, the one fatal bug class.
  it('prices the balloon, stores it, and shows it on the ticket', async () => {
    const { db, post } = await decodeHarness();
    const response = await post({ ...QUICK, balloon: '12,000', entry: 'typed' });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Balloon at the end');
    const row = db.prepare('SELECT balloon_cents FROM decodes').get() as { balloon_cents: number };
    expect(row.balloon_cents).toBe(1_200_000);
  });

  it('shows no balloon line when there is none', async () => {
    const { post } = await decodeHarness();
    const response = await post({ ...QUICK, entry: 'typed' });
    expect(await response.text()).not.toContain('Balloon at the end');
  });
});

const LEDGER = {
  ledger: '1',
  quotedPrice: '84500',
  cashDiscount: '6000',
  payment: '1408.33',
  paymentFrequency: 'monthly',
  paymentCount: '60',
  balloon: '',
  statedRate: '0',
  region: 'NE',
  extracted: '{"quotedPrice":"84500"}',
};

describe('a refused ledger keeps the farmer’s numbers on the screen', () => {
  // A farmer who snapped photos, waited for the read, and corrected a dozen
  // fields used to lose all of it to one typo: the refusal dumped him on an
  // empty four-field form that can never earn a verdict. A refusal now
  // re-renders the confirm screen with everything he posted.
  it('re-renders the confirm screen with every value he typed', async () => {
    const { post } = await decodeHarness();
    const response = await post({ ...LEDGER, region: '' });
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain('value="84500"');
    expect(body).toContain('value="1408.33"');
    expect(body).toContain('We could not read a couple of these.');
    expect(body).toContain('Pick the state or province the deal is in.');
    expect(body).toContain('name="ledger" value="1"');
    // The original snapshot rides through, so the retry still records
    // corrections and takes the verdict path.
    expect(body).toContain('&quot;quotedPrice&quot;');
  });

  it('re-renders an unpriceable ledger the same way', async () => {
    const { post } = await decodeHarness();
    const response = await post({ ...LEDGER, payment: '1' });
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain('value="84500"');
    expect(body).toContain('do not add up to a deal we can price');
    expect(body).toContain('name="ledger" value="1"');
  });

  it('keeps the checkboxes and the region he picked', async () => {
    const { post } = await decodeHarness();
    const response = await post({ ...LEDGER, payment: '1', unexplainedAmount: 'on' });
    const body = await response.text();
    expect(body).toContain('name="unexplainedAmount" checked');
    expect(body).toContain('<option value="NE" selected>');
  });

  it('never claims a retyped value was read from the paper', async () => {
    const { post } = await decodeHarness();
    const response = await post({ ...LEDGER, region: '' });
    expect(await response.text()).not.toContain('Read from your paper');
  });
});

describe('the typed retry keeps what the farmer gave it', () => {
  it('keeps the campaign labels on a validation retry', async () => {
    // The same defect the codebase fixed for fbc and for refuseDecode and
    // missed here: a farmer from an ad who mistypes once must still count as
    // the ad-attributed decode he is (spec 7.1).
    const { post } = await decodeHarness();
    const response = await post({
      quotedPrice: '84500', cashDiscount: '', payment: 'garbage', balloon: '',
      paymentFrequency: 'monthly', paymentCount: '60', utm_campaign: 'august-tractor', entry: 'typed',
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain('name="utm_campaign" value="august-tractor"');
  });

  it('keeps the typed values when the deal cannot be priced', async () => {
    const { post } = await decodeHarness();
    const response = await post({
      quotedPrice: '84500', cashDiscount: '', payment: '1', balloon: '',
      paymentFrequency: 'monthly', paymentCount: '60', entry: 'typed',
    });
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain('value="84500"');
    expect(body).toContain('do not add up to a deal we can price');
  });
});

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
