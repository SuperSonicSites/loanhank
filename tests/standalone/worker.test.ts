import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StaticExtractor } from '../../src/api/extractor.js';
import { createWorker } from '../../standalone/src/worker.js';
import { SESSION_COOKIE } from '../../standalone/src/session.js';
import type { StandaloneEnv } from '../../standalone/src/env.js';
import { createFakeSupabase } from './supabase-fake.js';
import { distAssets, executionContext, fixtureExtraction, pdfBytes, testEnv } from './fixtures.js';

const ORIGIN = 'https://loanhank.test';

let supabase: ReturnType<typeof createFakeSupabase>;
let restore: () => void;
let env: StandaloneEnv;

const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtraction) });

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const context = executionContext();
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, init), env, context);
  await context.settle();
  return response;
}

/** Same-origin headers a browser would attach to a state-changing request. */
function mutation(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...(init.headers as Record<string, string> | undefined) },
  };
}

beforeEach(() => {
  supabase = createFakeSupabase();
  restore = supabase.install();
  env = testEnv(distAssets());
});

afterEach(() => restore());

describe('route classes', () => {
  it('serves allowlisted public pages as cacheable, indexable HTML with no client JavaScript', async () => {
    for (const path of ['/', '/how-it-works', '/privacy', '/learn/amortization-basics']) {
      const response = await call(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('cache-control'), path)
        .toBe('public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
      expect(response.headers.get('x-robots-tag'), path).toBeNull();
      const html = await response.text();
      expect(html, path).not.toContain('<script');
      expect(html, path).toContain('<link rel="canonical"');
    }
  });

  it('serves a tool page with its own shorter edge TTL, bare or parameterised', async () => {
    // A tool page renders from the query string, so the edge keys every
    // parameter combination separately — hence the hour, not the day. It is
    // still public HTML: indexable, cookie-free, and JavaScript-free.
    for (const path of [
      '/tools/dealer-offer',
      '/tools/dealer-offer?country=US&price=82500&discount=4000&dealer_rate=0&your_rate=7.9&term=5&freq=annual',
    ]) {
      const response = await call(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('cache-control'), path).toBe('public, max-age=300, s-maxage=3600');
      expect(response.headers.get('x-robots-tag'), path).toBeNull();
      expect(response.headers.get('vary')?.toLowerCase() ?? '', path).not.toContain('cookie');
      expect(await response.text(), path).not.toContain('<script');
    }
  });

  it('sends a visitor carrying a session cookie from / to the dashboard', async () => {
    // Cookie presence is the whole test — the worker deliberately does not
    // validate the session here, so the redirect costs no round-trip. It is a
    // private response, so no shared cache can ever replay it to a guest.
    const response = await call('/', { headers: { cookie: `${SESSION_COOKIE}=whatever` } });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/loans');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('vary')?.toLowerCase()).toContain('cookie');
  });

  it('still serves / as shared-cacheable public HTML to a cookieless visitor', async () => {
    const response = await call('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control'))
      .toBe('public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
    expect(response.headers.get('x-robots-tag')).toBeNull();
    expect(await response.text()).toContain('<link rel="canonical"');
    // Both variants of / must be keyed apart, or an edge cache hands the guest
    // page to a signed-in visitor (or the redirect to a crawler).
    expect(response.headers.get('vary')?.toLowerCase()).toContain('cookie');
    // No other public page has two variants, so none of them pays that key.
    expect((await call('/how-it-works')).headers.get('vary')?.toLowerCase()).not.toContain('cookie');
  });

  it('serves the app shell light unless the appearance cookie opts into dark', async () => {
    // Light (the cream identity) is the default for everyone — the device
    // setting is never consulted. Dark is an explicit opt-in written by the
    // Account screen's Appearance switch into the lh_theme cookie.
    const light = await call('/loans');
    expect(await light.text()).toContain('<html lang="en" data-theme="light">');

    const dark = await call('/loans', { headers: { cookie: 'lh_theme=dark' } });
    expect(await dark.text()).toContain('<html lang="en" data-theme="dark">');
  });

  it('stamps every public page with the light theme', async () => {
    const response = await call('/');
    const body = await response.text();
    expect(body).toContain('<html lang="en" data-theme="light">');
    expect(body).toContain('<meta name="color-scheme" content="light">');
  });


  it('keeps every private class noindex and uncached', async () => {
    for (const path of ['/analyze', '/loans', '/watch', '/account', '/v1/session', '/health']) {
      const response = await call(path);
      expect(response.headers.get('cache-control'), path).toBe('private, no-store');
      expect(response.headers.get('x-robots-tag'), path).toBe('noindex, nofollow');
    }
  });

  it('permanently redirects the retired /app paths to their replacements', async () => {
    // Installed PWAs still launch the old start_url, so these must keep working.
    for (const [from, to] of [
      ['/app', '/'],
      ['/app/', '/'],
      ['/app/analyze', '/analyze'],
      ['/app/loans', '/loans'],
      ['/app/?source=pwa', '/?source=pwa'],
      ['/app/nonexistent', '/'],
    ] as const) {
      const response = await call(from);
      expect(response.status, from).toBe(301);
      expect(response.headers.get('location'), from).toBe(to);
    }
  });

  it('treats an unknown path as private and gives nothing away', async () => {
    const response = await call('/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('marks content-hashed assets immutable and the service worker revalidating', async () => {
    const shell = await call('/loans');
    const hashed = (await shell.text()).match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    expect(hashed).toBeTruthy();
    expect((await call(hashed!)).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await call('/sw.js')).headers.get('cache-control')).toBe('no-cache');
  });

  it('allows exactly one third-party origin in the CSP: Turnstile, script and frame only', async () => {
    const policy = (await call('/')).headers.get('content-security-policy') ?? '';
    expect(policy).toContain("font-src 'self'");
    expect(policy).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(policy).toContain('frame-src https://challenges.cloudflare.com');
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain('unsafe-inline');
    // Turnstile is the ONLY external origin anywhere in the policy.
    const origins = [...policy.matchAll(/https?:\/\/([^\s;]+)/g)].map((match) => match[1]);
    expect([...new Set(origins)]).toEqual(['challenges.cloudflare.com']);
  });

  it('keeps the app shell free of user state so it can stay no-store', async () => {
    const html = await (await call('/app/')).text();
    expect(html).not.toContain('csrf');
    expect(html).not.toMatch(/__LH_[A-Z]+__/);
  });
});

describe('cross-site protection', () => {
  it('refuses a state-changing request from another origin', async () => {
    const response = await call('/v1/events', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'landing_view', sessionId: crypto.randomUUID() }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: 'CROSS_SITE_REQUEST_BLOCKED', message: 'This request was blocked.' },
    });
  });

  it('accepts the same request from this origin', async () => {
    const response = await call('/v1/events', mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'landing_view', sessionId: crypto.randomUUID() }),
    }));
    expect(response.status).toBe(204);
  });
});

describe('guest analysis flow', () => {
  async function runToReady() {
    const created = await call('/v1/upload-sessions', mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 2_048, countryCode: 'US' }),
    }));
    expect(created.status).toBe(201);
    const session = await created.json() as { analysisId: string; analysisKey: string; uploadEndpoint: string };

    const uploaded = await call(session.uploadEndpoint, mutation({
      method: 'PUT',
      headers: { 'content-type': 'application/pdf', 'x-analysis-key': session.analysisKey },
      body: pdfBytes(),
    }));
    expect(uploaded.status).toBe(204);
    expect(supabase.state.objects.size).toBe(1);

    const started = await call(`/v1/analyses/${session.analysisId}/start`, mutation({
      method: 'POST',
      headers: { 'x-analysis-key': session.analysisKey },
    }));
    const extraction = await started.json() as { status: string };
    expect(extraction.status).toBe('NEEDS_CONFIRMATION');

    const confirmed = await call(`/v1/analyses/${session.analysisId}/confirm`, mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-analysis-key': session.analysisKey },
      body: JSON.stringify({
        countryCode: 'US',
        currencyCode: 'USD',
        interestRateConvention: 'nominal_payment_frequency',
        principalBalanceCents: 32_784_000,
        annualInterestRateBps: 785,
        rateType: 'fixed',
        paymentAmountCents: 9_865_144,
        paymentFrequency: 'annual',
        remainingPayments: 4,
        maturityDate: '2030-03-01',
        interestOnly: false,
        loanType: 'term_loan',
      }),
    }));
    return { session, confirmed };
  }

  it('extracts, confirms, and returns the deterministic acceptance figures', async () => {
    const { confirmed } = await runToReady();
    expect(confirmed.status).toBe(200);
    const body = await confirmed.json() as {
      status: string;
      xray: { current: { annualizedDebtServiceCents: number; projectedInterestCents: number } };
    };
    expect(body.status).toBe('READY');
    // context/12 fixture A: $98,651.44 a year, ~$66,765.75 remaining interest.
    // context/05 allows a small stated tolerance on the published fixture.
    expect(body.xray.current.annualizedDebtServiceCents).toBe(9_865_144);
    expect(Math.abs(body.xray.current.projectedInterestCents - 6_676_575)).toBeLessThanOrEqual(2);
  });

  it('deletes the raw document once the analysis is confirmed', async () => {
    await runToReady();
    expect(supabase.state.objects.size).toBe(0);
  });

  it('reports a wrong access key exactly like a nonexistent analysis', async () => {
    const { session } = await runToReady();
    const unowned = await call(`/v1/analyses/${session.analysisId}`, { headers: { 'x-analysis-key': 'not-the-key' } });
    const missing = await call(`/v1/analyses/${crypto.randomUUID()}`, { headers: { 'x-analysis-key': 'not-the-key' } });
    expect(unowned.status).toBe(missing.status);
    expect(await unowned.text()).toBe(await missing.text());
  });

  it('never puts a borrower identifier in the object path', async () => {
    const created = await call('/v1/upload-sessions', mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 2_048, countryCode: 'US' }),
    }));
    const session = await created.json() as { analysisKey: string; uploadEndpoint: string };
    await call(session.uploadEndpoint, mutation({
      method: 'PUT',
      headers: { 'content-type': 'application/pdf', 'x-analysis-key': session.analysisKey },
      body: pdfBytes(),
    }));
    const stored = [...supabase.state.objects.keys()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^analyses\/[0-9a-f-]{36}\/source\.pdf$/);
  });

  it('deletes the stored object when the guest deletes the analysis', async () => {
    const created = await call('/v1/upload-sessions', mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 2_048, countryCode: 'US' }),
    }));
    const session = await created.json() as { analysisId: string; analysisKey: string; uploadEndpoint: string };
    await call(session.uploadEndpoint, mutation({
      method: 'PUT',
      headers: { 'content-type': 'application/pdf', 'x-analysis-key': session.analysisKey },
      body: pdfBytes(),
    }));
    expect(supabase.state.objects.size).toBe(1);

    const deleted = await call(`/v1/analyses/${session.analysisId}`, mutation({
      method: 'DELETE',
      headers: { 'x-analysis-key': session.analysisKey },
    }));
    expect(deleted.status).toBe(204);
    expect(supabase.state.objects.size).toBe(0);
    expect(supabase.table('analyses')).toHaveLength(0);
  });

  it('rejects a body whose magic bytes do not match the declared type', async () => {
    const created = await call('/v1/upload-sessions', mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 8, countryCode: 'US' }),
    }));
    const session = await created.json() as { analysisKey: string; uploadEndpoint: string };
    const response = await call(session.uploadEndpoint, mutation({
      method: 'PUT',
      headers: { 'content-type': 'application/pdf', 'x-analysis-key': session.analysisKey },
      body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    }));
    expect(response.status).toBe(415);
    expect(supabase.state.objects.size).toBe(0);
  });
});

describe('document processing gate', () => {
  it('fails closed when no extractor is injected and the operator has not attested', async () => {
    const production = createWorker();
    const context = executionContext();
    const response = await production.fetch(
      new Request(`${ORIGIN}/v1/upload-sessions`, mutation({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 2_048, countryCode: 'US' }),
      })),
      env,
      context,
    );
    await context.settle();
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('DOCUMENT_PROCESSING_NOT_READY');
  });
});
