import { describe, expect, it } from 'vitest';
import {
  KILLED_COPY_PATTERNS,
  PRE_RESULT_COPY_PATTERNS,
  PROVENANCE_VOCABULARY,
} from '../../standalone/src/copy-doctrine.js';
import {
  CONTENT_LAST_MODIFIED,
  findPublicRoute,
  isPublicPath,
  PRIVATE_PATH_PREFIXES,
  PUBLIC_ROUTES,
} from '../../standalone/src/routes-manifest.js';
import { OPERATOR } from '../../standalone/src/operator.js';
import { renderPublicPage, renderRobots, renderSitemap } from '../../standalone/src/ssr/render.js';
import { decisionHeadline, decisionSupport, conventionLabel, projectionLabelText } from '../../standalone/src/app/format.js';
import { verdictLight } from '../../standalone/src/app/verdict.js';
import { alertCopy } from '../../standalone/src/alerts.js';
import { KIND_LABEL } from '../../standalone/src/app/screens/Watch.js';
import { calendarFootnote, portfolioBalanceTile } from '../../standalone/src/app/payment-calendar.js';
import { deriveFindings } from '../../standalone/src/app/findings.js';
import { PROVENANCE_LABEL } from '../../standalone/src/app/components.js';
import { buildLoanXRay, compareScenario, formatCurrency, projectCurrentLoan } from '../../src/finance/index.js';
import { alertKinds, decisionStateSchema, type SavedLoan } from '../../src/shared/schema.js';

const ORIGIN = 'https://loanhank.test';

describe('public route allowlist', () => {
  it('is private by default — no app, auth, or API path is public', () => {
    for (const path of ['/app', '/app/', '/app/loans', '/auth/callback', '/v1/session', '/v1/analyses/abc']) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it('contains the required core pages plus reviewed educational pages', () => {
    const core = PUBLIC_ROUTES.filter((route) => route.kind === 'core').map((route) => route.path);
    expect(core).toEqual(['/', '/how-it-works', '/privacy', '/terms']);
    expect(PUBLIC_ROUTES.filter((route) => route.kind === 'educational').length).toBeGreaterThan(0);
    // Tool pages are the one public class that reads its query string, so the
    // set is pinned: adding one is a reviewed change, not a drive-by.
    const tools = PUBLIC_ROUTES.filter((route) => route.kind === 'tool').map((route) => route.path);
    expect(tools).toEqual(['/tools/dealer-offer']);
    for (const route of PUBLIC_ROUTES) {
      if (route.kind === 'educational') expect(route.path.startsWith('/learn/')).toBe(true);
      if (route.kind === 'tool') expect(route.path.startsWith('/tools/')).toBe(true);
    }
  });

  it('normalises a trailing slash rather than serving a second URL', () => {
    expect(findPublicRoute('/how-it-works/')?.path).toBe('/how-it-works');
  });
});

describe('server-rendered public pages', () => {
  for (const route of PUBLIC_ROUTES) {
    it(`renders ${route.path} as complete, crawlable HTML`, () => {
      const html = renderPublicPage(route, ORIGIN);

      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<html lang="en" data-theme="light">');
      expect(html).toContain(`<title>`);
      expect(html).toContain(`<meta name="description"`);
      expect(html).toContain(`<link rel="canonical" href="${ORIGIN}${route.path}">`);
      expect(html).toContain('<meta property="og:title"');

      // Exactly one h1, and a main landmark for the skip link.
      expect(html.match(/<h1[ >]/g) ?? []).toHaveLength(1);
      expect(html).toContain('<main id="main" class="lh-shell-main">');

      // No client JavaScript and no user state.
      expect(html).not.toContain('<script');
      expect(html).not.toContain('onclick=');
      expect(html).not.toMatch(/\bstyle="/);

      // No third-party host may be referenced.
      const externalHosts = [...html.matchAll(/https?:\/\/([^"'\s/]+)/g)]
        .map((match) => match[1]!)
        .filter((host) => !host.includes('loanhank.test') && !host.includes('www.w3.org'));
      expect(externalHosts).toEqual([]);
    });
  }

  it('never uses the banned copy on any public page', () => {
    for (const route of PUBLIC_ROUTES) {
      const html = renderPublicPage(route, ORIGIN);
      for (const pattern of KILLED_COPY_PATTERNS) {
        expect(pattern.test(html), `${route.path} matched ${pattern}`).toBe(false);
      }
      // Every SSR public route is pre-result by definition.
      for (const pattern of PRE_RESULT_COPY_PATTERNS) {
        expect(pattern.test(html), `${route.path} matched pre-result ban ${pattern}`).toBe(false);
      }
    }
  });

  it('keeps the app label and headline vocabularies inside the doctrine', () => {
    expect(Object.values(PROVENANCE_LABEL).sort()).toEqual([...PROVENANCE_VOCABULARY].sort());

    // The clipboard findings are copy too, so one row of every kind is built
    // from a fixed fixture and swept alongside the label vocabularies.
    const nowIso = '2026-08-14T12:00:00.000Z';
    const freshlySaved = '2026-08-14T02:00:00.000Z';
    const baseLoan = {
      countryCode: 'US',
      currencyCode: 'USD',
      confirmedLoan: {
        countryCode: 'US',
        currencyCode: 'USD',
        interestRateConvention: 'nominal_payment_frequency',
        principalBalanceCents: 32_784_000,
        annualInterestRateBps: 785,
        rateType: 'fixed',
        paymentFrequency: 'monthly',
        interestOnly: false,
        loanType: 'term_loan',
        termsSource: 'document',
      },
      xray: null,
      activeWatchCount: 0,
      savedAt: '2025-08-14T02:00:00.000Z',
      updatedAt: '2025-08-14T02:00:00.000Z',
    } satisfies Omit<SavedLoan, 'id' | 'nickname'>;
    const findings = deriveFindings([
      {
        ...baseLoan,
        id: 'loan-scenario',
        nickname: 'North quarter note',
        latestScenario: {
          id: 'scenario-1',
          loanId: 'loan-scenario',
          name: 'Same term at a lower rate',
          createdAt: '2026-08-01T00:00:00.000Z',
          input: {
            candidateAnnualRateBps: 685,
            remainingPeriods: 48,
            paymentFrequency: 'monthly',
            feesCents: 0,
            feeTreatment: 'cash',
          },
          result: { annualCashflowChangeCents: 1_234_500, projectedInterestChangeCents: 987_600 },
        },
      },
      {
        ...baseLoan,
        id: 'loan-maturity',
        nickname: 'Pasture note',
        confirmedLoan: { ...baseLoan.confirmedLoan, maturityDate: '2027-03-01' },
      },
      { ...baseLoan, id: 'loan-green', nickname: 'Bin site note', savedAt: freshlySaved, xray: { decisionState: 'CURRENT_LOAN_REASONABLE' } },
      { ...baseLoan, id: 'loan-neutral', nickname: 'Equipment note', savedAt: freshlySaved, xray: { decisionState: 'VARIABLE_RATE_EXPOSURE' } },
    ], [], nowIso);
    expect(findings.map((finding) => finding.kind)).toEqual([
      'saved_scenario_improvement',
      'maturity_unwatched',
      'freshly_saved',
      'freshly_saved',
    ]);

    const surfaces = [
      ...decisionStateSchema.options.map((state) => decisionHeadline(state)),
      ...decisionStateSchema.options.map((state) => decisionSupport(state)),
      ...decisionStateSchema.options.map((state) => verdictLight(state).label),
      ...decisionStateSchema.options.map((state) => verdictLight(state).support),
      ...findings.flatMap((finding) => [finding.title, finding.detail]),
      conventionLabel('nominal_semiannual'),
      conventionLabel('unknown'),
      projectionLabelText('FIXED_RATE'),
      projectionLabelText('CURRENT_RATE_HELD_CONSTANT'),
      ...alertKinds.flatMap((kind) => {
        const copy = alertCopy(kind, 'North quarter note');
        return [copy.title, copy.body];
      }),
      ...Object.values(KIND_LABEL),
      calendarFootnote({ groups: [], includedLoanCount: 3, excludedLoanCount: 1 }, 4),
      portfolioBalanceTile({ loanCount: 4, tickedLoanCount: 3, totalBalanceCents: 1_000_00 }).sub,
      portfolioBalanceTile({ loanCount: 4, tickedLoanCount: 3, totalBalanceCents: 1_000_00 }).footnote ?? '',

    ];
    for (const text of surfaces) {
      for (const pattern of KILLED_COPY_PATTERNS) {
        expect(pattern.test(text), `"${text}" matched ${pattern}`).toBe(false);
      }
    }
  });
  it('never lets a figure, date, or balance into an alert message', () => {
    // The strongest privacy promise in the product, mechanically checked:
    // notification copy carries no dollar figure, percentage, ISO date, or
    // thousands-grouped number for any alert kind.
    const figureLike = /[$%]|\d{4}-\d{2}-\d{2}|\d{1,3}(?:,\d{3})+/;
    for (const kind of alertKinds) {
      const copy = alertCopy(kind, 'North quarter note');
      expect(`${copy.title} ${copy.body}`).not.toMatch(figureLike);
    }
  });


  it('publishes only engine-computed sample figures on the front door', () => {
    const sampleLoan = {
      countryCode: 'US',
      currencyCode: 'USD',
      interestRateConvention: 'nominal_payment_frequency',
      principalBalanceCents: 32_784_000,
      annualInterestRateBps: 785,
      rateType: 'fixed',
      paymentFrequency: 'annual',
      remainingPayments: 4,
      maturityDate: '2030-03-01',
    } as const;
    const xray = buildLoanXRay(sampleLoan, '2026-08-01');
    const sameTerm = compareScenario(xray.current, sampleLoan, {
      candidateAnnualRateBps: 685,
      remainingPeriods: 4,
      paymentFrequency: 'annual',
      feesCents: 0,
      feeTreatment: 'cash',
    }, '2026-08-01');
    // The home page is the mockup's single-action landing — no sample figures
    // on it by design (owner decision, 2026-08-14); the learn pages carry the
    // engine-derived numbers instead.
    const tradeoff = renderPublicPage(findPublicRoute('/learn/cash-flow-vs-lifetime-interest')!, ORIGIN);
    expect(tradeoff).toContain(formatCurrency(sameTerm.annualCashflowChangeCents));
    expect(tradeoff).toContain(formatCurrency(xray.current.projectedInterestCents!));
  });

  it('computes the dealer-offer comparison with the engine, not by hand', () => {
    const route = findPublicRoute('/tools/dealer-offer')!;
    const html = renderPublicPage(
      route,
      ORIGIN,
      new URLSearchParams('country=US&price=82500&discount=4000&dealer_rate=0&your_rate=7.9&term=5&freq=annual'),
    );

    // The same two synthetic loans the page builds: the discounted price at
    // your own rate, and the full price at the dealer's promotional rate.
    // The as-of date is an engine input only — it is never rendered, and no
    // figure below depends on it.
    const asOfDate = new Date().toISOString().slice(0, 10);
    const loan = (principalBalanceCents: number, annualInterestRateBps: number) => ({
      countryCode: 'US',
      currencyCode: 'USD',
      interestRateConvention: 'nominal_payment_frequency',
      principalBalanceCents,
      annualInterestRateBps,
      rateType: 'fixed',
      paymentFrequency: 'annual',
      remainingPayments: 5,
      interestOnly: false,
      loanType: 'term_loan',
      termsSource: 'manual',
    } as const);
    const own = projectCurrentLoan(loan(7_850_000, 790), asOfDate);
    const dealer = projectCurrentLoan(loan(8_250_000, 0), asOfDate);

    for (const side of [own, dealer]) {
      expect(side.mode).toBe('FULL');
      expect(html).toContain(formatCurrency(side.periodicPaymentCents!));
      expect(html).toContain(formatCurrency(side.projectedInterestCents!));
      expect(html).toContain(formatCurrency(side.totalCashOutflowCents!));
    }
    expect(html).toContain(formatCurrency(Math.abs(own.totalCashOutflowCents! - dealer.totalCashOutflowCents!)));

    // A result page is still a public page: same doctrine, same zero-JS rule.
    for (const pattern of KILLED_COPY_PATTERNS) expect(pattern.test(html), `matched ${pattern}`).toBe(false);
    for (const pattern of PRE_RESULT_COPY_PATTERNS) expect(pattern.test(html), `matched ${pattern}`).toBe(false);
    expect(html.match(/<h1[ >]/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('<script');

    // With no query the page is the bare form — no figures, no comparison.
    expect(renderPublicPage(route, ORIGIN)).not.toContain('Side by side');
  });

  it('describes cash-flow relief without calling it savings', () => {
    const html = renderPublicPage(findPublicRoute('/learn/cash-flow-vs-lifetime-interest')!, ORIGIN);
    expect(html).toContain('Cash-flow relief is not the same as savings');
    expect(html).toContain('more</em> interest');
  });

  it('names the operator on the privacy and terms pages', () => {
    // Green before AND after the owner fills operator.ts: the pages must show
    // whatever OPERATOR currently holds (placeholder pre-launch, real identity
    // after), never silently drop it.
    const privacy = renderPublicPage(findPublicRoute('/privacy')!, ORIGIN);
    expect(privacy).toContain(OPERATOR.legalName);
    expect(privacy).toContain(OPERATOR.contactEmail);
    const terms = renderPublicPage(findPublicRoute('/terms')!, ORIGIN);
    expect(terms).toContain(OPERATOR.legalName);
    expect(terms).toContain(OPERATOR.contactEmail);
    expect(terms).toContain(OPERATOR.jurisdiction);
  });
});

describe('sitemap and robots', () => {
  it('lists exactly the allowlisted routes and nothing else', () => {
    const sitemap = renderSitemap(ORIGIN, CONTENT_LAST_MODIFIED);
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
    expect(locations).toEqual(PUBLIC_ROUTES.map((route) => `${ORIGIN}${route.path}`));
    for (const prefix of PRIVATE_PATH_PREFIXES) {
      expect(sitemap).not.toContain(`${ORIGIN}${prefix}`);
    }
    expect(sitemap).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
  });

  it('disallows every private prefix and points at the sitemap', () => {
    const robots = renderRobots(ORIGIN);
    for (const prefix of PRIVATE_PATH_PREFIXES) {
      expect(robots).toContain(`Disallow: ${prefix}`);
    }
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(robots).not.toContain('Allow: /');
  });
});
