import { describe, expect, it } from 'vitest';
import {
  ProjectionUnavailableError,
  addUtcMonths,
  balanceAsOf,
  buildLoanXRay,
  interestByCalendarYear,
  paymentAnchor,
  paymentCalendar,
  summariseTickedBalances,
} from '../src/finance/index.js';
import { confirmedLoanSchema, type ConfirmedLoan } from '../src/shared/schema.js';

const AS_OF = '2026-08-13';

/** Fixture A from context/05: the annual fixed-rate acceptance loan. */
const acceptanceLoan: ConfirmedLoan = {
  countryCode: 'US',
  currencyCode: 'USD',
  interestRateConvention: 'nominal_payment_frequency',
  principalBalanceCents: 32_784_000,
  annualInterestRateBps: 785,
  rateType: 'fixed',
  paymentFrequency: 'annual',
  remainingPayments: 4,
  maturityDate: '2030-03-01',
};

/**
 * Amortized on a twenty-year annual schedule at 7%, ballooning after the fifth
 * payment. The documented payment and balloon are the exact figures that
 * schedule produces, so the engine reconciles them rather than tolerating them.
 */
const balloonLoan: ConfirmedLoan = {
  countryCode: 'US',
  currencyCode: 'USD',
  interestRateConvention: 'nominal_payment_frequency',
  principalBalanceCents: 50_000_000,
  annualInterestRateBps: 700,
  rateType: 'fixed',
  paymentFrequency: 'annual',
  remainingPayments: 5,
  paymentAmountCents: 4_719_646,
  balloonAmountCents: 42_986_134,
  maturityDate: '2031-06-01',
};

/** The `interest_only_balloon` fixture: principal never moves until it all does. */
const interestOnlyLoan: ConfirmedLoan = {
  countryCode: 'US',
  currencyCode: 'USD',
  interestRateConvention: 'nominal_payment_frequency',
  principalBalanceCents: 50_000_000,
  annualInterestRateBps: 700,
  rateType: 'fixed',
  paymentFrequency: 'annual',
  remainingPayments: 4,
  interestOnly: true,
  balloonAmountCents: 50_000_000,
  maturityDate: '2030-03-01',
};

/** A revolving line, which the engine can only ever project as LIMITED. */
const revolvingLoan: ConfirmedLoan = {
  countryCode: 'US',
  currencyCode: 'USD',
  interestRateConvention: 'nominal_payment_frequency',
  principalBalanceCents: 8_000_000,
  annualInterestRateBps: 900,
  rateType: 'variable',
  paymentFrequency: 'irregular',
  loanType: 'line_of_credit',
};

const monthlyLoan: ConfirmedLoan = {
  countryCode: 'US',
  currencyCode: 'USD',
  interestRateConvention: 'nominal_payment_frequency',
  principalBalanceCents: 26_500_000,
  annualInterestRateBps: 650,
  rateType: 'fixed',
  paymentFrequency: 'monthly',
  remainingPayments: 60,
  nextPaymentDate: '2026-09-01',
};

const quarterlyLoan: ConfirmedLoan = { ...monthlyLoan, paymentFrequency: 'quarterly', remainingPayments: 8 };
const semiannualLoan: ConfirmedLoan = { ...monthlyLoan, paymentFrequency: 'semiannual', remainingPayments: 12 };

describe('calendar month arithmetic', () => {
  it('clamps onto short months and stays leap-aware', () => {
    // Every row is a real month-end case; the leap years are the point.
    const cases: Array<[string, number, string]> = [
      ['2028-01-31', 1, '2028-02-29'],
      ['2027-01-31', 1, '2027-02-28'],
      ['2028-02-29', 12, '2029-02-28'],
      ['2026-08-31', 3, '2026-11-30'],
      ['2030-03-01', -36, '2027-03-01'],
      ['2026-08-13', 0, '2026-08-13'],
      ['2026-12-31', 1, '2027-01-31'],
      ['2026-08-31', -6, '2026-02-28'],
      ['2100-01-31', 1, '2100-02-28'],
      ['2000-01-31', 1, '2000-02-29'],
    ];
    for (const [date, months, expected] of cases) {
      expect(`${date} + ${months} = ${addUtcMonths(date, months)}`).toBe(`${date} + ${months} = ${expected}`);
    }
  });

  it('measures the clamp from the original anchor day, never from an intermediate one', () => {
    // Iterating month by month would land on 2028-03-29; the anchor day is 31.
    expect(addUtcMonths('2028-01-31', 2)).toBe('2028-03-31');
    expect(addUtcMonths(addUtcMonths('2028-01-31', 1), 1)).toBe('2028-03-29');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addUtcMonths('2026-08-13', 17)).toBe('2028-01-13');
    expect(addUtcMonths('2026-08-13', -20)).toBe('2024-12-13');
    expect(addUtcMonths('2026-08-13', -12)).toBe('2025-08-13');
  });

  it('refuses a date it cannot trust rather than rolling it forward', () => {
    expect(() => addUtcMonths('2027-02-30', 1)).toThrow(ProjectionUnavailableError);
    expect(() => addUtcMonths('2026-13-01', 1)).toThrow(ProjectionUnavailableError);
    expect(() => addUtcMonths('not-a-date', 1)).toThrow(ProjectionUnavailableError);
    expect(() => addUtcMonths('2026-08-13T00:00:00Z', 1)).toThrow(ProjectionUnavailableError);
    expect(() => addUtcMonths('2026-08-13', 1.5)).toThrow(ProjectionUnavailableError);
  });
});

describe('payment anchoring', () => {
  it('prefers a confirmed next payment date over a back-count', () => {
    expect(paymentAnchor({ ...acceptanceLoan, nextPaymentDate: '2026-09-15' })).toEqual({
      kind: 'next_payment_date',
      firstPaymentDate: '2026-09-15',
      stepMonths: 12,
    });
  });

  it('back-counts from maturity so the final payment lands on it', () => {
    const anchor = paymentAnchor(acceptanceLoan);
    expect(anchor).toEqual({ kind: 'maturity_backcount', firstPaymentDate: '2027-03-01', stepMonths: 12 });
    if (anchor.kind === 'none') throw new Error('expected a dated anchor');
    expect(addUtcMonths(anchor.firstPaymentDate, 3 * anchor.stepMonths)).toBe(acceptanceLoan.maturityDate);
  });

  it('derives the step width from the payment frequency', () => {
    expect(paymentAnchor(monthlyLoan)).toMatchObject({ stepMonths: 1 });
    expect(paymentAnchor(quarterlyLoan)).toMatchObject({ stepMonths: 3 });
    expect(paymentAnchor(semiannualLoan)).toMatchObject({ stepMonths: 6 });
    expect(paymentAnchor(acceptanceLoan)).toMatchObject({ stepMonths: 12 });
  });

  it('back-counts a single remaining payment onto maturity itself', () => {
    expect(paymentAnchor({ ...acceptanceLoan, remainingPayments: 1 })).toEqual({
      kind: 'maturity_backcount',
      firstPaymentDate: '2030-03-01',
      stepMonths: 12,
    });
  });

  it('reports no regular frequency instead of inventing a step', () => {
    expect(paymentAnchor(revolvingLoan)).toEqual({ kind: 'none', reason: 'no_regular_frequency' });
    expect(paymentAnchor({ ...acceptanceLoan, paymentFrequency: 'unknown' })).toEqual({
      kind: 'none',
      reason: 'no_regular_frequency',
    });
  });

  it('reports no dated anchor when neither date can carry the schedule', () => {
    expect(paymentAnchor({ ...acceptanceLoan, maturityDate: undefined })).toEqual({
      kind: 'none',
      reason: 'no_dated_anchor',
    });
    expect(paymentAnchor({ ...acceptanceLoan, remainingPayments: undefined })).toEqual({
      kind: 'none',
      reason: 'no_dated_anchor',
    });
    expect(paymentAnchor({ ...acceptanceLoan, maturityDate: '2030-02-30' })).toEqual({
      kind: 'none',
      reason: 'no_dated_anchor',
    });
  });

  it('falls through to the back-count when the next payment date is unusable', () => {
    // The optional field failing must not cost the loan its calendar, and it
    // must never throw out of an anchor lookup.
    expect(paymentAnchor({ ...acceptanceLoan, nextPaymentDate: '2027-02-30' })).toEqual({
      kind: 'maturity_backcount',
      firstPaymentDate: '2027-03-01',
      stepMonths: 12,
    });
    expect(paymentAnchor({ ...acceptanceLoan, nextPaymentDate: 'soon' })).toMatchObject({
      kind: 'maturity_backcount',
    });
    expect(paymentAnchor({ ...acceptanceLoan, nextPaymentDate: '' })).toMatchObject({ kind: 'maturity_backcount' });
  });
});

describe('payment calendar', () => {
  it('dates the stored schedule without restating a single cent of it', () => {
    const xray = buildLoanXRay(acceptanceLoan, AS_OF);
    const schedule = xray.current.schedule!;
    expect(schedule).toHaveLength(4);

    const { anchor, entries } = paymentCalendar(acceptanceLoan, xray, { asOfDate: AS_OF });
    expect(anchor).toEqual({ kind: 'maturity_backcount', firstPaymentDate: '2027-03-01', stepMonths: 12 });
    expect(entries.map((entry) => entry.date)).toEqual([
      '2027-03-01',
      '2028-03-01',
      '2029-03-01',
      '2030-03-01',
    ]);

    let running = acceptanceLoan.principalBalanceCents;
    for (const [index, entry] of entries.entries()) {
      const row = schedule[index]!;
      expect({
        period: entry.period,
        paymentCents: entry.paymentCents,
        principalCents: entry.principalCents,
        interestCents: entry.interestCents,
        balloonCents: entry.balloonCents,
      }).toEqual(row);
      running -= row.principalCents + row.balloonCents;
      expect(entry.balanceAfterCents).toBe(running);
    }
    // Guaranteed by the engine's final-period plug, asserted here rather than
    // enforced at runtime.
    expect(entries.at(-1)!.balanceAfterCents).toBe(0);
  });

  it('retires a balloon on its own row and still clears the balance', () => {
    const xray = buildLoanXRay(balloonLoan, AS_OF);
    expect(xray.current.mode).toBe('FULL');
    const { anchor, entries } = paymentCalendar(balloonLoan, xray, { asOfDate: AS_OF });

    expect(anchor).toEqual({ kind: 'maturity_backcount', firstPaymentDate: '2027-06-01', stepMonths: 12 });
    expect(entries.map((entry) => entry.date)).toEqual([
      '2027-06-01',
      '2028-06-01',
      '2029-06-01',
      '2030-06-01',
      '2031-06-01',
    ]);
    expect(entries.slice(0, -1).map((entry) => entry.balloonCents)).toEqual([0, 0, 0, 0]);
    expect(entries.at(-1)!.balloonCents).toBe(42_986_134);
    expect(entries.at(-1)!.date).toBe(balloonLoan.maturityDate);
    expect(entries.at(-1)!.balanceAfterCents).toBe(0);
    // Cents come from the schedule, not from the calendar.
    expect(entries.map((entry) => entry.paymentCents)).toEqual(xray.current.schedule!.map((row) => row.paymentCents));
  });

  it('holds an interest-only balance flat until the balloon clears it', () => {
    const xray = buildLoanXRay(interestOnlyLoan, AS_OF);
    const { entries } = paymentCalendar(interestOnlyLoan, xray, { asOfDate: AS_OF });

    expect(entries.map((entry) => entry.principalCents)).toEqual([0, 0, 0, 0]);
    expect(entries.map((entry) => entry.balanceAfterCents)).toEqual([50_000_000, 50_000_000, 50_000_000, 0]);
    expect(entries.map((entry) => entry.interestCents)).toEqual([3_500_000, 3_500_000, 3_500_000, 3_500_000]);
    expect(entries.at(-1)!.balloonCents).toBe(50_000_000);
  });

  it('steps monthly, quarterly, and semiannual schedules by their own width', () => {
    for (const [loan, expectedDates] of [
      [monthlyLoan, ['2026-09-01', '2026-10-01', '2026-11-01']],
      [quarterlyLoan, ['2026-09-01', '2026-12-01', '2027-03-01']],
      [semiannualLoan, ['2026-09-01', '2027-03-01', '2027-09-01']],
    ] as Array<[ConfirmedLoan, string[]]>) {
      const xray = buildLoanXRay(loan, AS_OF);
      const { anchor, entries } = paymentCalendar(loan, xray, { asOfDate: AS_OF });
      expect(anchor).toMatchObject({ kind: 'next_payment_date', firstPaymentDate: '2026-09-01' });
      expect(entries).toHaveLength(loan.remainingPayments!);
      expect(entries.slice(0, 3).map((entry) => entry.date)).toEqual(expectedDates);
      expect(entries.at(-1)!.balanceAfterCents).toBe(0);
    }
    // Sixty monthly payments from September 2026 land in August 2031.
    expect(paymentCalendar(monthlyLoan, buildLoanXRay(monthlyLoan, AS_OF), { asOfDate: AS_OF }).entries.at(-1)!.date)
      .toBe('2031-08-01');
  });

  it('keeps only the payments inside an explicit horizon', () => {
    const xray = buildLoanXRay(monthlyLoan, AS_OF);
    const horizon = paymentCalendar(monthlyLoan, xray, { asOfDate: AS_OF, horizonMonths: 3 });
    expect(horizon.entries.map((entry) => entry.date)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);

    // Strictly after the analysis date: a payment due today is already history.
    const onPaymentDay = paymentCalendar(monthlyLoan, xray, { asOfDate: '2026-09-01', horizonMonths: 2 });
    expect(onPaymentDay.entries.map((entry) => entry.date)).toEqual(['2026-10-01', '2026-11-01']);

    // A horizon that reaches past the final payment stops at the schedule.
    expect(paymentCalendar(acceptanceLoan, buildLoanXRay(acceptanceLoan, AS_OF), {
      asOfDate: AS_OF,
      horizonMonths: 600,
    }).entries).toHaveLength(4);
    // And one that reaches nothing yields nothing, without losing the anchor.
    const empty = paymentCalendar(acceptanceLoan, buildLoanXRay(acceptanceLoan, AS_OF), {
      asOfDate: AS_OF,
      horizonMonths: 1,
    });
    expect(empty.entries).toEqual([]);
    expect(empty.anchor).toMatchObject({ kind: 'maturity_backcount' });
  });

  it('reports the anchor but no entries when the X-Ray carries no full schedule', () => {
    const limitedLoan: ConfirmedLoan = { ...acceptanceLoan, interestRateConvention: 'unknown' };
    const limited = buildLoanXRay(limitedLoan, AS_OF);
    expect(limited.current.mode).toBe('LIMITED');
    const fromLimited = paymentCalendar(limitedLoan, limited, { asOfDate: AS_OF });
    expect(fromLimited.entries).toEqual([]);
    expect(fromLimited.anchor).toEqual({
      kind: 'maturity_backcount',
      firstPaymentDate: '2027-03-01',
      stepMonths: 12,
    });

    for (const garbage of [
      null,
      undefined,
      'a schedule, honest',
      {},
      { current: null },
      { current: { mode: 'FULL' } },
      { current: { mode: 'FULL', schedule: 'four payments' } },
      { current: { mode: 'FULL', schedule: [{ period: 1 }] } },
      { current: { mode: 'FULL', schedule: [{ period: 1, paymentCents: Number.NaN, principalCents: 0, interestCents: 0, balloonCents: 0 }] } },
      { current: { mode: 'LIMITED', schedule: [] } },
    ]) {
      const calendar = paymentCalendar(acceptanceLoan, garbage, { asOfDate: AS_OF });
      expect(calendar.entries).toEqual([]);
      expect(calendar.anchor).toMatchObject({ kind: 'maturity_backcount' });
    }
  });

  it('reports no entries and the reason when the loan cannot be dated at all', () => {
    const calendar = paymentCalendar(revolvingLoan, buildLoanXRay(revolvingLoan, AS_OF), { asOfDate: AS_OF });
    expect(calendar).toEqual({ anchor: { kind: 'none', reason: 'no_regular_frequency' }, entries: [] });
  });

  it('requires an explicit analysis date', () => {
    expect(() => paymentCalendar(acceptanceLoan, buildLoanXRay(acceptanceLoan, AS_OF), { asOfDate: '13/08/2026' }))
      .toThrow(ProjectionUnavailableError);
  });
});

describe('balance as of a date', () => {
  const xray = buildLoanXRay(acceptanceLoan, AS_OF);
  const schedule = xray.current.schedule!;

  it('returns the confirmed balance before the first payment is due', () => {
    expect(balanceAsOf(acceptanceLoan, xray, AS_OF)).toEqual({
      balanceCents: 32_784_000,
      periodsElapsed: 0,
      anchored: true,
    });
  });

  it('subtracts the schedule exactly, to the cent, mid-term', () => {
    const midTerm = balanceAsOf(acceptanceLoan, xray, '2028-06-01');
    expect(midTerm.periodsElapsed).toBe(2);
    expect(midTerm.anchored).toBe(true);
    expect(midTerm.balanceCents).toBe(32_784_000 - schedule[0]!.principalCents - schedule[1]!.principalCents);
    // A payment counts on the day it falls due, not the day after.
    expect(balanceAsOf(acceptanceLoan, xray, '2027-03-01').periodsElapsed).toBe(1);
    expect(balanceAsOf(acceptanceLoan, xray, '2027-02-28').periodsElapsed).toBe(0);
  });

  it('clears to zero once every payment has elapsed', () => {
    expect(balanceAsOf(acceptanceLoan, xray, '2030-03-01')).toEqual({
      balanceCents: 0,
      periodsElapsed: 4,
      anchored: true,
    });
    expect(balanceAsOf(acceptanceLoan, xray, '2031-01-01')).toEqual({
      balanceCents: 0,
      periodsElapsed: 4,
      anchored: true,
    });
  });

  it('passes an undateable loan through untouched rather than rolling it forward', () => {
    expect(balanceAsOf(revolvingLoan, buildLoanXRay(revolvingLoan, AS_OF), '2030-03-01')).toEqual({
      balanceCents: 8_000_000,
      periodsElapsed: 0,
      anchored: false,
    });
    // A dateable loan with an unreadable X-Ray is equally untouched.
    expect(balanceAsOf(acceptanceLoan, { current: { mode: 'LIMITED' } }, '2030-03-01')).toEqual({
      balanceCents: 32_784_000,
      periodsElapsed: 0,
      anchored: false,
    });
  });
});

describe('ticked balance roll-up', () => {
  const usdXRay = buildLoanXRay(acceptanceLoan, AS_OF);
  const cadLoan: ConfirmedLoan = {
    ...acceptanceLoan,
    countryCode: 'CA',
    currencyCode: 'CAD',
    interestRateConvention: 'nominal_semiannual',
    principalBalanceCents: 20_000_000,
  };

  it('never blends currencies, and orders the groups by code unit', () => {
    const summaries = summariseTickedBalances([
      { currencyCode: 'USD', countryCode: 'US', confirmedLoan: acceptanceLoan, xray: usdXRay },
      { currencyCode: 'CAD', countryCode: 'CA', confirmedLoan: cadLoan, xray: buildLoanXRay(cadLoan, AS_OF) },
    ], AS_OF);

    expect(summaries.map((summary) => summary.currencyCode)).toEqual(['CAD', 'USD']);
    expect(summaries[0]).toEqual({
      currencyCode: 'CAD',
      countryCode: 'CA',
      loanCount: 1,
      tickedLoanCount: 1,
      totalBalanceCents: 20_000_000,
    });
    expect(summaries[1]).toEqual({
      currencyCode: 'USD',
      countryCode: 'US',
      loanCount: 1,
      tickedLoanCount: 1,
      totalBalanceCents: 32_784_000,
    });
  });

  it('counts what actually ticked and still carries what did not', () => {
    const asOf = '2028-06-01';
    const ticked = balanceAsOf(acceptanceLoan, usdXRay, asOf);
    expect(ticked.anchored).toBe(true);
    expect(ticked.balanceCents).toBeLessThan(acceptanceLoan.principalBalanceCents);

    const [summary, ...rest] = summariseTickedBalances([
      { currencyCode: 'USD', countryCode: 'US', confirmedLoan: acceptanceLoan, xray: usdXRay },
      { currencyCode: 'USD', countryCode: 'US', confirmedLoan: revolvingLoan, xray: buildLoanXRay(revolvingLoan, AS_OF) },
    ], asOf);

    expect(rest).toEqual([]);
    expect(summary).toEqual({
      currencyCode: 'USD',
      countryCode: 'US',
      loanCount: 2,
      tickedLoanCount: 1,
      totalBalanceCents: ticked.balanceCents + revolvingLoan.principalBalanceCents,
    });
  });

  it('returns no groups for no loans, and requires an explicit analysis date', () => {
    expect(summariseTickedBalances([], AS_OF)).toEqual([]);
    expect(() => summariseTickedBalances([], '2026-8-13')).toThrow(ProjectionUnavailableError);
  });
});

describe('confirmed-loan date ordering', () => {
  it('accepts a next payment on or before maturity', () => {
    expect(confirmedLoanSchema.safeParse({ ...acceptanceLoan, nextPaymentDate: '2027-03-01' }).success).toBe(true);
    // The final payment falls on maturity itself; that is the normal case.
    expect(confirmedLoanSchema.safeParse({ ...acceptanceLoan, nextPaymentDate: '2030-03-01' }).success).toBe(true);
    expect(confirmedLoanSchema.safeParse({ ...acceptanceLoan, nextPaymentDate: undefined }).success).toBe(true);
    expect(confirmedLoanSchema.safeParse({
      ...acceptanceLoan,
      maturityDate: undefined,
      nextPaymentDate: '2099-01-01',
    }).success).toBe(true);
  });

  it('rejects a next payment falling after maturity', () => {
    const result = confirmedLoanSchema.safeParse({ ...acceptanceLoan, nextPaymentDate: '2030-03-02' });
    expect(result.success).toBe(false);
    expect(result.error!.issues).toContainEqual(expect.objectContaining({
      path: ['nextPaymentDate'],
      message: 'The next payment date is after the maturity date.',
    }));
  });
});

describe('interest by calendar year', () => {
  const sumOf = (
    entries: ReturnType<typeof paymentCalendar>['entries'],
    key: 'interestCents' | 'paymentCents',
  ) => entries.reduce((total, entry) => total + entry[key], 0);

  it('splits a December/January straddle by the date on each payment', () => {
    const { entries } = paymentCalendar(monthlyLoan, buildLoanXRay(monthlyLoan, AS_OF), { asOfDate: AS_OF });
    const opening = monthlyLoan.principalBalanceCents;
    const inYear = (year: string) => entries.filter((entry) => entry.date.startsWith(`${year}-`));

    const first = interestByCalendarYear(entries, opening, 2026);
    const second = interestByCalendarYear(entries, opening, 2027);

    // Sixty payments from September 2026: four fall in 2026, twelve in 2027.
    expect(first.paymentsInYear).toBe(4);
    expect(second.paymentsInYear).toBe(12);
    expect(first.interestCents).toBe(sumOf(inYear('2026'), 'interestCents'));
    expect(second.interestCents).toBe(sumOf(inYear('2027'), 'interestCents'));
    expect(first.paymentCents).toBe(sumOf(inYear('2026'), 'paymentCents'));

    // The December payment stays in December, whatever clock reads the report:
    // each closing balance is the one the schedule reaches on its own last row.
    expect(first.closingBalanceCents).toBe(inYear('2026').at(-1)!.balanceAfterCents);
    expect(second.closingBalanceCents).toBe(inYear('2027').at(-1)!.balanceAfterCents);
    expect(second.closingBalanceCents).toBeLessThan(first.closingBalanceCents);

    // Nothing is dropped or double counted across the boundary.
    expect(first.interestCents + second.interestCents)
      .toBe(sumOf(entries.slice(0, 16), 'interestCents'));
  });

  it('leaves the opening balance untouched for a year before the first payment', () => {
    const { entries } = paymentCalendar(acceptanceLoan, buildLoanXRay(acceptanceLoan, AS_OF), { asOfDate: AS_OF });
    // Back-counted from a March 2030 maturity, the first payment is in 2027.
    expect(entries[0]!.date).toBe('2027-03-01');

    expect(interestByCalendarYear(entries, acceptanceLoan.principalBalanceCents, 2026)).toEqual({
      year: 2026,
      paymentsInYear: 0,
      interestCents: 0,
      paymentCents: 0,
      closingBalanceCents: acceptanceLoan.principalBalanceCents,
    });
  });

  it('reports a paid-off balance for a year after the schedule ends', () => {
    const { entries } = paymentCalendar(acceptanceLoan, buildLoanXRay(acceptanceLoan, AS_OF), { asOfDate: AS_OF });
    expect(entries.at(-1)!.date).toBe('2030-03-01');

    expect(interestByCalendarYear(entries, acceptanceLoan.principalBalanceCents, 2031)).toEqual({
      year: 2031,
      paymentsInYear: 0,
      interestCents: 0,
      paymentCents: 0,
      closingBalanceCents: 0,
    });
  });

  it('counts a balloon as money paid out, never as interest', () => {
    const { entries } = paymentCalendar(balloonLoan, buildLoanXRay(balloonLoan, AS_OF), { asOfDate: AS_OF });
    const final = entries.at(-1)!;
    expect(final.date).toBe('2031-06-01');
    expect(final.balloonCents).toBe(42_986_134);

    const slice = interestByCalendarYear(entries, balloonLoan.principalBalanceCents, 2031);
    expect(slice.paymentsInYear).toBe(1);
    // The balloon lands in the payment column and nowhere near the interest one.
    expect(slice.interestCents).toBe(final.interestCents);
    expect(slice.paymentCents).toBe(final.paymentCents + final.balloonCents);
    expect(slice.paymentCents).toBeGreaterThan(slice.interestCents);
    expect(slice.closingBalanceCents).toBe(0);
  });

  it('requires a whole four-digit calendar year', () => {
    expect(() => interestByCalendarYear([], 100, 2026.5)).toThrow(ProjectionUnavailableError);
    expect(() => interestByCalendarYear([], 100, 0)).toThrow(ProjectionUnavailableError);
    expect(() => interestByCalendarYear([], 100, 10_000)).toThrow(ProjectionUnavailableError);
  });
});
