import { describe, expect, it } from 'vitest';
import {
  buildEvent, fbcFromBody, fbcFromUrl, recordCapiOutcome, sendCapi, skipReason,
  type CapiInput, type CapiOutcome,
} from '../src/api/capi.js';
import { renderConfirm, renderForm, renderUnpriceable, renderVerdictTicket } from '../src/web/page.js';
import { app } from '../src/api/worker.js';
import { migratedDatabase } from './helpers/d1-sqlite.js';

// THE SENDER BEHIND THE AD-MEASUREMENT CLAIM — spec.md §7.3, §10.
//
// "We measure which ads work" is a future-tense claim about a mechanism, so it
// needs a sender like every other one, and the negative paths are where these
// fail quietly: the four skips. Every skip here is asserted as a refusal that
// leaves a row, because a send that silently fails and leaves nothing is the
// same defect species as the teardown that was promised and never queued.

const NOW_MS = 1755400000000;

function input(overrides: Partial<CapiInput> = {}): CapiInput {
  return {
    eventName: 'Decode',
    eventId: 'event-row-id',
    sourceUrl: 'https://loanhank.test/decode',
    fbc: 'fb.1.1755400000000.TESTCLICK',
    synthetic: false,
    gpc: false,
    clientIp: '203.0.113.7',
    userAgent: 'a farmer phone',
    ...overrides,
  };
}

/** Every capi test runs the real sendCapi against a counted stand-in network. */
async function withFetch(
  respond: () => Promise<unknown> | unknown,
  run: (calls: Array<{ url: string; body: string }>) => Promise<void>,
): Promise<void> {
  const calls: Array<{ url: string; body: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: init.body });
    return respond();
  }) as never;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const CONFIGURED = { META_DATASET_ID: 'DEV000', META_CAPI_TOKEN: 'token-under-test' };

describe('ad measurement fires from the worker, and every skip is a refusal', () => {
  it('sends the event when every gate is open', async () => {
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({ fbtrace_id: 'trace-1' }) }),
      async (calls) => {
        const outcome = await sendCapi(CONFIGURED, input(), NOW_MS);
        expect(outcome).toEqual({ status: 'sent', http: 200, fbtrace: 'trace-1' });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://graph.facebook.com/v26.0/DEV000/events');
        const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
        expect(body.access_token).toBe('token-under-test');
        const events = body.data as Array<Record<string, unknown>>;
        expect(events).toHaveLength(1);
        expect(events[0]?.event_name).toBe('Decode');
      },
    );
  });

  it('keeps the token out of the URL, where query strings land in logs', async () => {
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async (calls) => {
        await sendCapi(CONFIGURED, input(), NOW_MS);
        expect(calls[0]?.url).not.toContain('token-under-test');
        expect(calls[0]?.url).not.toContain('access_token');
      },
    );
  });

  it('carries the test event code only when one is configured', async () => {
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async (calls) => {
        await sendCapi({ ...CONFIGURED, META_TEST_EVENT_CODE: 'TEST55' }, input(), NOW_MS);
        await sendCapi(CONFIGURED, input(), NOW_MS);
        expect((JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>).test_event_code).toBe('TEST55');
        expect(JSON.parse(calls[1]?.body ?? '{}')).not.toHaveProperty('test_event_code');
      },
    );
  });

  it('returns each skip reason, in the order that was chosen on purpose', () => {
    // Synthetic wins over gpc, and gpc wins over not_from_ad, so an honoured
    // opt-out is logged as an opt-out rather than hidden behind "not from an
    // ad", and verification traffic reads as what it is.
    expect(skipReason({ synthetic: true, gpc: true, fbc: null })).toBe('synthetic');
    expect(skipReason({ synthetic: true, gpc: false, fbc: 'fb.1.1.x' })).toBe('synthetic');
    expect(skipReason({ synthetic: false, gpc: true, fbc: null })).toBe('gpc');
    expect(skipReason({ synthetic: false, gpc: true, fbc: 'fb.1.1.x' })).toBe('gpc');
    expect(skipReason({ synthetic: false, gpc: false, fbc: null })).toBe('not_from_ad');
    expect(skipReason({ synthetic: false, gpc: false, fbc: 'fb.1.1.x' })).toBeNull();
  });

  it('skips as disabled when no dataset is configured, and never reaches for the network', async () => {
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async (calls) => {
        expect(await sendCapi({}, input(), NOW_MS)).toEqual({ status: 'skipped', reason: 'disabled' });
        expect(await sendCapi({ META_DATASET_ID: 'DEV000' }, input(), NOW_MS))
          .toEqual({ status: 'skipped', reason: 'disabled' });
        expect(calls).toEqual([]);
      },
    );
  });

  it('skips synthetic, gpc and organic traffic without fetching, even fully configured', async () => {
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async (calls) => {
        expect(await sendCapi(CONFIGURED, input({ synthetic: true }), NOW_MS))
          .toEqual({ status: 'skipped', reason: 'synthetic' });
        expect(await sendCapi(CONFIGURED, input({ gpc: true }), NOW_MS))
          .toEqual({ status: 'skipped', reason: 'gpc' });
        expect(await sendCapi(CONFIGURED, input({ fbc: null }), NOW_MS))
          .toEqual({ status: 'skipped', reason: 'not_from_ad' });
        expect(calls).toEqual([]);
      },
    );
  });

  it('reports a refusal from Meta as failed rather than throwing', async () => {
    await withFetch(
      () => ({
        ok: false,
        status: 400,
        text: async () => '{"error":{"message":"Invalid OAuth access token","type":"OAuthException","code":190}}',
      }),
      async () => {
        const outcome = await sendCapi(CONFIGURED, input(), NOW_MS);
        expect(outcome).toEqual({ status: 'failed', http: 400, error: 'OAuthException code 190' });
      },
    );
  });

  it('reports a dead network as failed rather than throwing', async () => {
    await withFetch(
      () => { throw new Error('network down'); },
      async () => {
        const outcome = await sendCapi(CONFIGURED, input(), NOW_MS);
        expect(outcome.status).toBe('failed');
        expect((outcome as { error: string }).error).toContain('network down');
      },
    );
  });

  it("stores Meta's error type and code, never its message", async () => {
    // Graph API validation errors echo offending values into their message
    // text, and the request this one answers carried the click tag. A message
    // stored verbatim would be spec.md §9.5 broken by a debugging convenience.
    await withFetch(
      () => ({
        ok: false,
        status: 400,
        text: async () => '{"error":{"message":"Unsupported fbc fb.1.1755400000000.TESTCLICK","type":"OAuthException","code":100}}',
      }),
      async () => {
        const outcome = await sendCapi(CONFIGURED, input(), NOW_MS) as { error: string };
        expect(outcome.error).toBe('OAuthException code 100');
        expect(outcome.error).not.toContain('TESTCLICK');
      },
    );
  });

  it('stores nothing legible from an error body it cannot parse', async () => {
    await withFetch(
      () => ({ ok: false, status: 500, text: async () => 'fb.1.1755400000000.TESTCLICK '.repeat(200) }),
      async () => {
        const outcome = await sendCapi(CONFIGURED, input(), NOW_MS) as { error: string };
        expect(outcome.error).toBe('unreadable error body');
      },
    );
  });

  it('serializes no outcome carrying an fb. value, even when Meta echoes the click id back', async () => {
    // spec.md §10: nothing persisted, in any table, meta_json included, and
    // Meta's error bodies echo the offending value back. This is the realistic
    // Graph API shape: error_user_msg quoting the rejected fbc verbatim. The
    // serialized outcome is what recordCapiOutcome writes, so if fb. survives
    // into it anywhere, a click tag just landed in the events table.
    await withFetch(
      () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          error: {
            message: 'Invalid parameter',
            error_user_msg: 'The click ID fb.1.1755400000000.TESTCLICK123 in the fbc parameter could not be validated.',
            type: 'OAuthException',
            code: 100,
            error_subcode: 2804003,
            fbtrace_id: 'A1bC2dE3f',
          },
        }),
      }),
      async () => {
        const outcome = await sendCapi(CONFIGURED, input(), NOW_MS);
        expect(outcome.status).toBe('failed');
        expect(JSON.stringify(outcome)).not.toMatch(/fb\./);
      },
    );
  });
});

describe('the click tag is built, checked, and stripped', () => {
  it('builds fb.1.{ms}.{id} from a landing URL that carried fbclid', () => {
    expect(fbcFromUrl(new URL('https://loanhank.test/?fbclid=TESTCLICK123'), NOW_MS))
      .toBe('fb.1.1755400000000.TESTCLICK123');
  });

  it('builds nothing from an organic landing', () => {
    expect(fbcFromUrl(new URL('https://loanhank.test/'), NOW_MS)).toBeNull();
    expect(fbcFromUrl(new URL('https://loanhank.test/?utm_source=meta'), NOW_MS)).toBeNull();
  });

  it('accepts only the exact fbc shape back off a form', () => {
    expect(fbcFromBody('fb.1.1755400000000.TESTCLICK123')).toBe('fb.1.1755400000000.TESTCLICK123');
    expect(fbcFromBody(undefined)).toBeNull();
    expect(fbcFromBody('')).toBeNull();
    expect(fbcFromBody('fb.2.1.x')).toBeNull();
    expect(fbcFromBody('anything else at all')).toBeNull();
    expect(fbcFromBody('fb.1.notdigits.x')).toBeNull();
  });

  it('stamps the events.id it was handed as the event id', () => {
    const event = buildEvent({ ...input(), fbc: 'fb.1.1.x', eventId: 'the-row-that-was-written' }, NOW_MS);
    expect(event.event_id).toBe('the-row-that-was-written');
  });

  it('ships the source URL with fbclid stripped', () => {
    const event = buildEvent({
      ...input(),
      fbc: 'fb.1.1.x',
      sourceUrl: 'https://loanhank.test/?utm_source=meta&fbclid=TESTCLICK123',
    }, NOW_MS);
    expect(String(event.event_source_url)).not.toContain('fbclid');
    expect(String(event.event_source_url)).not.toContain('TESTCLICK123');
    expect(String(event.event_source_url)).toContain('utm_source=meta');
  });

  it('carries Limited Data Use with country and state both zero', () => {
    const event = buildEvent({ ...input(), fbc: 'fb.1.1.x' }, NOW_MS);
    expect(event.data_processing_options).toEqual(['LDU']);
    expect(event.data_processing_options_country).toBe(0);
    expect(event.data_processing_options_state).toBe(0);
  });
});

describe('the hidden field carries the tag to the decode POST, and dies there', () => {
  // No cookie and no JavaScript exist to carry it (spec.md Decision 2), so a
  // form that drops the field kills measurement silently. The carriers are
  // exactly the forms that end in a decode: the landing pair (camera hero and
  // typed disclosure), the confirm screen, and the retry screen beside an
  // unpriceable answer. Nothing past the decode carries it, because Meta
  // hears about decodes and nothing else (spec.md §10, one event not three).
  const FBC = 'fb.1.1755405000000.TESTCLICK123';
  const FIELD = `<input type="hidden" name="fbc" value="${FBC}">`;

  const confirmView = { rows: [], frequency: 'monthly', warnings: [] };
  const ticketView = {
    rate: '9.90%',
    verdict: 'none' as const,
    verdictLine: 'We can show you the rate. We are not rating this deal yet.',
    lines: [],
    reference: null,
    footnote: null,
    missing: [],
    assumption: null,
    gate: { decodeId: '00000000-0000-4000-8000-000000000000' },
  };

  it('rides the landing forms, the confirm form, and the unpriceable retry form', () => {
    const landing = renderForm(undefined, [], { turnstileSiteKey: 'site-key' }, {}, FBC);
    expect(landing.split(FIELD)).toHaveLength(3); // camera hero and typed disclosure
    expect(renderConfirm({ ...confirmView, fbc: FBC })).toContain(FIELD);
    expect(renderUnpriceable('Those numbers do not add up.', {}, FBC)).toContain(FIELD);
  });

  it('never rides the ticket: the gates have no carrier at all', () => {
    // The ticket renders after the decode already fired. A tag here could only
    // feed an event the canon copy says does not exist.
    expect(renderVerdictTicket(ticketView)).not.toContain('fbc');
  });

  it('renders nothing at all when the visit carried no tag', () => {
    expect(renderForm(undefined, [], { turnstileSiteKey: 'site-key' }, {}, null)).not.toContain('name="fbc"');
    expect(renderConfirm(confirmView)).not.toContain('name="fbc"');
    expect(renderUnpriceable('Those numbers do not add up.')).not.toContain('name="fbc"');
  });
});

describe('the request headers reach the gates as wired, not as assumed', () => {
  // capi.test.ts proves sendCapi refuses when the flags are true; this proves
  // the flags come from the actual request. Without it, hardcoding gpc to
  // false in measureAd would pass the whole suite while shipping an opted-out
  // browser's event to Meta, which is the CPRA violation spec.md §10 exists
  // to prevent, failing open and invisibly.
  const FBC = 'fb.1.1755405000000.TESTCLICK123';
  const FORM = 'quotedPrice=84500&cashDiscount=6000&payment=1408.33&paymentFrequency=monthly&paymentCount=60';

  async function routeHarness({ limited = false }: { limited?: boolean } = {}) {
    const { db, d1 } = await migratedDatabase();
    const env = {
      DB: d1,
      DECODE_LIMIT: { limit: async () => ({ success: !limited }) },
      RATE_LIMIT_SALT: 'test-salt-test-salt',
      META_DATASET_ID: 'DEV000',
      META_CAPI_TOKEN: 'token-under-test',
    };
    const pending: Array<Promise<unknown>> = [];
    const post = async (headers: Record<string, string>, form: string) => {
      const response = await app.fetch(
        new Request('https://loanhank.test/decode', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
          body: form,
        }),
        env as never,
        {
          waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
          passThroughOnException: () => {},
        } as never,
      );
      await Promise.all(pending.splice(0));
      return response;
    };
    const outcome = () => {
      const row = db.prepare(
        "SELECT meta_json FROM events WHERE event = 'decode' ORDER BY rowid DESC LIMIT 1",
      ).get() as { meta_json: string };
      return (JSON.parse(row.meta_json) as { capi: unknown }).capi;
    };
    const events = () => (db.prepare('SELECT event FROM events').all() as Array<{ event: string }>)
      .map((row) => row.event);
    return { post, outcome, events };
  }

  it('honours Sec-GPC: 1 on the route, and nothing reaches the network', async () => {
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async (calls) => {
        const { post, outcome } = await routeHarness();
        await post({ 'sec-gpc': '1' }, `${FORM}&fbc=${FBC}`);
        expect(outcome()).toEqual({ status: 'skipped', reason: 'gpc' });
        expect(calls).toEqual([]);
      },
    );
  });

  it('honours the synthetic marker on the route, and nothing reaches the network', async () => {
    // The header is law, not local convention: spec.md §7.2 defines
    // `x-loanhank-synthetic: 1` as how verification traffic declares itself
    // at request time, because an event cannot be un-sent the way a row can
    // be flagged. It is opt-in, so it fails toward "real": forgetting it
    // sends a real event, which is why it is the second line of defence
    // behind the dev dataset and the unset secret, never the first.
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async (calls) => {
        const { post, outcome } = await routeHarness();
        await post({ 'x-loanhank-synthetic': '1' }, `${FORM}&fbc=${FBC}`);
        expect(outcome()).toEqual({ status: 'skipped', reason: 'synthetic' });
        expect(calls).toEqual([]);
      },
    );
  });

  it('records an ad-free decode as not_from_ad on the route', async () => {
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async (calls) => {
        const { post, outcome } = await routeHarness();
        await post({}, FORM);
        expect(outcome()).toEqual({ status: 'skipped', reason: 'not_from_ad' });
        expect(calls).toEqual([]);
      },
    );
  });

  it('sends from the route with the request headers riding along', async () => {
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({ fbtrace_id: 'trace-route' }) }),
      async (calls) => {
        const { post, outcome } = await routeHarness();
        await post(
          { 'cf-connecting-ip': '198.51.100.9', 'user-agent': 'route-test-agent' },
          `${FORM}&fbc=${FBC}`,
        );
        expect(outcome()).toEqual({ status: 'sent', http: 200, fbtrace: 'trace-route' });
        expect(calls).toHaveLength(1);
        const body = JSON.parse(calls[0]?.body ?? '{}') as { data: Array<Record<string, unknown>> };
        const userData = body.data[0]?.user_data as Record<string, unknown>;
        expect(userData.fbc).toBe(FBC);
        expect(userData.client_ip_address).toBe('198.51.100.9');
        expect(userData.client_user_agent).toBe('route-test-agent');
      },
    );
  });

  // A farmer who is refused, fixes his numbers and completes must still count
  // as the ad-attributed decode he is, or cost per decode inflates and the
  // §7.1 wall reads wrong. Each refusal below reaches a DIFFERENT branch, and
  // they were unguarded as a set: a mutation dropping the tag from both
  // engine-unpriceable call sites left the whole suite green.
  // The recorded event is asserted alongside the tag, so these cannot quietly
  // collapse onto one branch: the first is refused by the schema, the other
  // two are refused by the engine down each of the two decode paths.
  const REFUSALS: Array<[string, string, string]> = [
    ['a ledger the schema refuses', `ledger=1&quotedPrice=&payment=&paymentCount=&fbc=${FBC}`, 'decode_rejected'],
    [
      'numbers the engine cannot price',
      `quotedPrice=6000&cashDiscount=6000&payment=100&paymentFrequency=monthly&paymentCount=60&fbc=${FBC}`,
      'decode_unpriceable',
    ],
    [
      'a ledger the engine cannot price',
      `ledger=1&quotedPrice=6000&cashDiscount=6000&payment=100&paymentFrequency=monthly`
      + `&paymentCount=60&region=NE&fbc=${FBC}`,
      'decode_unpriceable',
    ],
  ];

  for (const [what, form, event] of REFUSALS) {
    it(`carries the tag onto the retry screen after ${what}`, async () => {
      await withFetch(
        () => ({ ok: true, status: 200, json: async () => ({}) }),
        async () => {
          const { post, events } = await routeHarness();
          const response = await post({}, form);
          expect(response.status).toBe(422);
          expect(events()).toContain(event);
          expect(await response.text()).toContain(`name="fbc" value="${FBC}"`);
        },
      );
    });
  }

  it('carries the tag onto the retry screen when the limiter refuses', async () => {
    // The refusal that arrives before the body is even parsed. It renders the
    // same retry form as the others, so it threads the same way or it is the
    // one screen that quietly drops the tag.
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async () => {
        const { post } = await routeHarness({ limited: true });
        const response = await post({}, `${FORM}&fbc=${FBC}`);
        expect(response.status).toBe(429);
        expect(await response.text()).toContain(`name="fbc" value="${FBC}"`);
      },
    );
  });

  it('withholds the tag from the retry screen under GPC', async () => {
    await withFetch(
      () => ({ ok: true, status: 200, json: async () => ({}) }),
      async () => {
        const { post } = await routeHarness();
        const response = await post(
          { 'sec-gpc': '1' },
          `ledger=1&quotedPrice=&payment=&paymentCount=&fbc=${FBC}`,
        );
        expect(response.status).toBe(422);
        expect(await response.text()).not.toContain('name="fbc"');
      },
    );
  });
});

describe('every outcome lands on the events row it measures', () => {
  async function eventFixture() {
    const { db, d1 } = await migratedDatabase();
    db.exec(
      `INSERT INTO events (id, event, decode_id, ts, meta_json)
       VALUES ('ev1', 'decode', NULL, '2026-08-17T00:00:00Z', '{"utm_source":"meta"}')`,
    );
    return { db, d1 };
  }

  it('patches the outcome into meta_json without writing a second row', async () => {
    const { db, d1 } = await eventFixture();
    const outcome: CapiOutcome = { status: 'sent', http: 200, fbtrace: 'trace-9' };
    await recordCapiOutcome(d1, 'ev1', outcome);

    const rows = db.prepare("SELECT meta_json FROM events WHERE event = 'decode'").all() as
      Array<{ meta_json: string }>;
    expect(rows).toHaveLength(1);
    const meta = JSON.parse(rows[0]?.meta_json ?? '{}') as Record<string, unknown>;
    // The campaign label survives the patch: ops/funnel.sql still counts.
    expect(meta.utm_source).toBe('meta');
    expect(meta.capi).toEqual(outcome);
  });

  it('records a skip the same way, so an opt-out is a row and not an absence', async () => {
    const { db, d1 } = await eventFixture();
    await recordCapiOutcome(d1, 'ev1', { status: 'skipped', reason: 'gpc' });
    const row = db.prepare('SELECT meta_json FROM events WHERE id = ?').get('ev1') as { meta_json: string };
    expect((JSON.parse(row.meta_json) as { capi: unknown }).capi)
      .toEqual({ status: 'skipped', reason: 'gpc' });
  });

  it('never lands the click tag itself in the table', async () => {
    // spec.md §9.5: fbclid is transient, used for the send in the request that
    // carries it and never written down. The outcome is status plumbing only.
    const { db, d1 } = await eventFixture();
    await recordCapiOutcome(d1, 'ev1', await sendCapi({}, input(), NOW_MS));
    const row = db.prepare('SELECT meta_json FROM events WHERE id = ?').get('ev1') as { meta_json: string };
    expect(row.meta_json).not.toContain('fbclid');
    expect(row.meta_json).not.toContain('fb.1.');
    expect(row.meta_json).not.toContain('TESTCLICK');
  });
});
