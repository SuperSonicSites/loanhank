import { describe, expect, it } from 'vitest';
import {
  buildPaymentCalendar,
  calendarFootnote,
  portfolioBalanceTile,
  type PaymentCalendarView,
} from '../../standalone/src/app/payment-calendar.js';
import { buildLoanXRay } from '../../src/finance/index.js';
import type { SavedLoan } from '../../src/shared/schema.js';

/**
 * The date the fixture X-Rays are built at. `paymentCalendar` dates a
 * schedule from the loan's own anchor, not from this date, so it stays fixed
 * across every test — only `todayIso` passed into `buildPaymentCalendar`
 * varies, exactly as `tests/finance.calendar.test.ts` reuses one `xray`
 * against several `asOfDate`s.
 */
const XRAY_AS_OF = '2026-08-13';

/**
 * `SavedLoan['confirmedLoan']` (the persisted, `z.infer` shape) rather than
 * the standalone `ConfirmedLoan` export (`z.input`, where every
 * default-bearing field is optional): a saved loan's terms are always fully
 * resolved, and `buildLoanXRay` happily accepts this more-specific shape
 * wherever it asks for the input one.
 */
const BASE_TERMS: SavedLoan['confirmedLoan'] = {
  countryCode: 'US',
  currencyCode: 'USD',
  interestRateConvention: 'nominal_payment_frequency',
  principalBalanceCents: 12_000_000,
  annualInterestRateBps: 600,
  rateType: 'fixed',
  paymentFrequency: 'monthly',
  interestOnly: false,
  loanType: 'term_loan',
  termsSource: 'document',
  remainingPayments: 6,
  nextPaymentDate: '2026-12-01',
};

type LoanOverrides =
  & Partial<Omit<SavedLoan, 'confirmedLoan'>>
  & { confirmedLoan?: Partial<SavedLoan['confirmedLoan']> };

/**
 * `xray` defaults to the real `buildLoanXRay` output for the (possibly
 * overridden) confirmed terms, so a test gets a genuine dated schedule for
 * free; a test that wants a LIMITED or garbage payload overrides `xray`
 * directly, or overrides `confirmedLoan` in a way that steers the real
 * engine into LIMITED (e.g. an unstated interest convention).
 */
function loan(overrides: LoanOverrides = {}): SavedLoan {
  const { confirmedLoan: confirmedOverrides, ...rest } = overrides;
  const confirmedLoan: SavedLoan['confirmedLoan'] = { ...BASE_TERMS, ...confirmedOverrides };
  return {
    id: 'loan-base',
    nickname: 'Base note',
    countryCode: 'US',
    currencyCode: 'USD',
    xray: buildLoanXRay(confirmedLoan, XRAY_AS_OF),
    activeWatchCount: 0,
    savedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...rest,
    confirmedLoan,
  };
}

describe('buildPaymentCalendar', () => {
  it('groups across a Dec→Jan boundary, in chronological order, with rows sorted by date then nickname', () => {
    // Two monthly payments each — Dec 2026 and Jan 2027 — is enough to prove
    // the year-boundary grouping without the other exclusion/label tests'
    // six-payment default spilling into extra months here.
    const zulu = loan({ id: 'loan-zulu', nickname: 'Zulu note', confirmedLoan: { remainingPayments: 2 } });
    const alpha = loan({ id: 'loan-alpha', nickname: 'Alpha note', confirmedLoan: { remainingPayments: 2 } });
    const mike = loan({
      id: 'loan-mike',
      nickname: 'Mike note',
      confirmedLoan: { nextPaymentDate: '2026-12-15', remainingPayments: 1 },
    });

    const view = buildPaymentCalendar([zulu, alpha, mike], '2026-11-20');

    expect(view.groups.map((group) => group.monthKey)).toEqual(['2026-12', '2027-01']);
    expect(view.groups.map((group) => group.monthLabel)).toEqual(['Dec 2026', 'Jan 2027']);

    // Same date, two nicknames: nickname breaks the tie. A later date in the
    // same month sorts after both.
    expect(view.groups[0]!.rows.map((row) => [row.dateIso, row.nickname])).toEqual([
      ['2026-12-01', 'Alpha note'],
      ['2026-12-01', 'Zulu note'],
      ['2026-12-15', 'Mike note'],
    ]);
    expect(view.groups[1]!.rows.map((row) => [row.dateIso, row.nickname])).toEqual([
      ['2027-01-01', 'Alpha note'],
      ['2027-01-01', 'Zulu note'],
    ]);

    // Input order must never leak into the result.
    expect(buildPaymentCalendar([mike, zulu, alpha], '2026-11-20')).toEqual(view);
  });

  it('excludes an anchorless loan, a loan with a LIMITED X-Ray, and a loan with a garbage stored X-Ray', () => {
    const anchorless = loan({
      id: 'loan-anchorless',
      confirmedLoan: { paymentFrequency: 'irregular', nextPaymentDate: undefined },
    });
    const limited = loan({
      id: 'loan-limited',
      confirmedLoan: { interestRateConvention: 'unknown' },
    });
    const garbage = loan({
      id: 'loan-garbage',
      xray: { current: { mode: 'FULL', schedule: 'not an array' } },
    });
    // Sanity: `limited` really does carry a LIMITED projection, not a FULL
    // one that happens to have no rows — otherwise this test would not be
    // exercising the branch it claims to.
    expect((limited.xray as { current: { mode: string } }).current.mode).toBe('LIMITED');

    const view = buildPaymentCalendar([anchorless, limited, garbage], '2026-11-20');

    expect(view.groups).toEqual([]);
    expect(view.includedLoanCount).toBe(0);
    expect(view.excludedLoanCount).toBe(3);
  });

  it('mixes an included and an excluded loan correctly in the same call', () => {
    const dated = loan({ id: 'loan-dated', nickname: 'Dated note' });
    const undated = loan({ id: 'loan-undated', confirmedLoan: { paymentFrequency: 'unknown', nextPaymentDate: undefined } });

    const view = buildPaymentCalendar([dated, undated], '2026-11-20');

    expect(view.includedLoanCount).toBe(1);
    expect(view.excludedLoanCount).toBe(1);
    expect(view.groups.flatMap((group) => group.rows).every((row) => row.loanId === 'loan-dated')).toBe(true);
  });

  it('hand-rolls every month label byte-exact, independent of the runtime ICU build', () => {
    const labels = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      const oneMonth = loan({
        id: `loan-${month}`,
        confirmedLoan: { nextPaymentDate: `2027-${month}-15`, remainingPayments: 1 },
      });
      const view = buildPaymentCalendar([oneMonth], '2027-01-01');
      return view.groups[0]?.monthLabel;
    });

    expect(labels).toEqual([
      'Jan 2027', 'Feb 2027', 'Mar 2027', 'Apr 2027', 'May 2027', 'Jun 2027',
      'Jul 2027', 'Aug 2027', 'Sep 2027', 'Oct 2027', 'Nov 2027', 'Dec 2027',
    ]);
  });

  it('keeps every row in its own currency and carries no aggregate figure anywhere in the shape', () => {
    const usd = loan({ id: 'loan-usd', nickname: 'US note' });
    const cad = loan({
      id: 'loan-cad',
      nickname: 'CA note',
      countryCode: 'CA',
      currencyCode: 'CAD',
      confirmedLoan: {
        countryCode: 'CA',
        currencyCode: 'CAD',
        interestRateConvention: 'nominal_semiannual',
        principalBalanceCents: 8_000_000,
      },
    });

    const view = buildPaymentCalendar([usd, cad], '2026-11-20');

    const usdRow = view.groups[0]!.rows.find((row) => row.loanId === 'loan-usd');
    const cadRow = view.groups[0]!.rows.find((row) => row.loanId === 'loan-cad');
    expect(usdRow).toMatchObject({ countryCode: 'US', currencyCode: 'USD' });
    expect(cadRow).toMatchObject({ countryCode: 'CA', currencyCode: 'CAD' });

    // No group or view-level field ever sums a cent across rows or loans.
    expect(Object.keys(view)).toEqual(['groups', 'includedLoanCount', 'excludedLoanCount']);
    for (const group of view.groups) {
      expect(Object.keys(group)).toEqual(['monthKey', 'monthLabel', 'rows']);
      for (const row of group.rows) {
        expect(Object.keys(row)).toEqual(['loanId', 'nickname', 'dateIso', 'paymentCents', 'countryCode', 'currencyCode']);
      }
    }
  });

  it('returns no groups and no exclusions for no loans', () => {
    expect(buildPaymentCalendar([], '2026-11-20')).toEqual({ groups: [], includedLoanCount: 0, excludedLoanCount: 0 });
  });
});

describe('calendarFootnote', () => {
  it('states the included count against the caller-supplied total, verbatim', () => {
    const view: PaymentCalendarView = { groups: [], includedLoanCount: 2, excludedLoanCount: 1 };
    expect(calendarFootnote(view, 3)).toBe(
      '2 of 3 loans have a dated schedule. Dates come from the payment anchor you confirmed.',
    );
  });

  it('reads correctly at zero', () => {
    const view: PaymentCalendarView = { groups: [], includedLoanCount: 0, excludedLoanCount: 0 };
    expect(calendarFootnote(view, 0)).toBe(
      '0 of 0 loans have a dated schedule. Dates come from the payment anchor you confirmed.',
    );
  });
});

describe('portfolioBalanceTile', () => {
  it('stays Known with no footnote when nothing ticked', () => {
    expect(portfolioBalanceTile({ loanCount: 4, tickedLoanCount: 0, totalBalanceCents: 500_000 })).toEqual({
      value: 500_000,
      sub: 'Known',
      footnote: null,
    });
  });

  it('switches to Estimated with the exact ticked-count footnote once anything ticked', () => {
    expect(portfolioBalanceTile({ loanCount: 5, tickedLoanCount: 2, totalBalanceCents: 999_900 })).toEqual({
      value: 999_900,
      sub: 'Estimated · as of today',
      footnote: '2 of 5 loans estimated to today; the rest show their confirmed balance.',
    });
  });

  it('is still Estimated when every loan ticked, not just some', () => {
    const tile = portfolioBalanceTile({ loanCount: 3, tickedLoanCount: 3, totalBalanceCents: 100 });
    expect(tile.sub).toBe('Estimated · as of today');
    expect(tile.footnote).toBe('3 of 3 loans estimated to today; the rest show their confirmed balance.');
  });
});
