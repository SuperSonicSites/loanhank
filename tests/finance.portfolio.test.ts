import { describe, expect, it } from 'vitest';
import {
  ProjectionUnavailableError,
  buildLoanXRay,
  summariseSavedLoans,
  type PortfolioLoanInput,
} from '../src/finance/index.js';
import type { ConfirmedLoan } from '../src/shared/schema.js';

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

/** The two figures a roll-up reads, in the shape `buildLoanXRay` writes them. */
const fullXRay = (annualizedDebtServiceCents: number, projectedInterestCents: number): unknown => ({
  decisionState: 'CURRENT_LOAN_REASONABLE',
  current: { mode: 'FULL', annualizedDebtServiceCents, projectedInterestCents },
});

function entry(overrides: Partial<PortfolioLoanInput> = {}): PortfolioLoanInput {
  return {
    currencyCode: 'USD',
    countryCode: 'US',
    confirmedLoan: { principalBalanceCents: 10_000_000, annualInterestRateBps: 500 },
    xray: null,
    ...overrides,
  };
}

describe('saved-loan portfolio roll-up', () => {
  it('mirrors a single full projection instead of recomputing it', () => {
    const xray = buildLoanXRay(acceptanceLoan, AS_OF);
    expect(xray.current.mode).toBe('FULL');

    const [summary, ...rest] = summariseSavedLoans([{
      currencyCode: 'USD',
      countryCode: 'US',
      confirmedLoan: {
        principalBalanceCents: acceptanceLoan.principalBalanceCents,
        annualInterestRateBps: acceptanceLoan.annualInterestRateBps,
        maturityDate: acceptanceLoan.maturityDate,
      },
      xray,
    }], AS_OF);

    expect(rest).toEqual([]);
    expect(summary).toEqual({
      currencyCode: 'USD',
      countryCode: 'US',
      loanCount: 1,
      totalBalanceCents: 32_784_000,
      blendedRateBps: 785,
      nextMaturityDate: '2030-03-01',
      annualizedDebtServiceCents: xray.current.annualizedDebtServiceCents,
      projectedInterestCents: xray.current.projectedInterestCents,
      averageMonthlyServiceCents: Math.round(xray.current.annualizedDebtServiceCents! / 12),
      projectionLoanCount: 1,
      excludedLoanCount: 0,
    });
  });

  it('weights the blended rate by balance, not by loan count', () => {
    const [summary] = summariseSavedLoans([
      entry({ confirmedLoan: { principalBalanceCents: 10_000_000, annualInterestRateBps: 500 } }),
      entry({ confirmedLoan: { principalBalanceCents: 30_000_000, annualInterestRateBps: 700 } }),
    ], AS_OF);

    // Balance-weighted: (100k × 5.00% + 300k × 7.00%) ÷ 400k = 6.50%.
    // A plain mean of the two rates would have been 600 bps.
    expect(summary?.blendedRateBps).toBe(650);
    expect(summary?.totalBalanceCents).toBe(40_000_000);
  });

  it('rounds the blended rate and the monthly average half-up', () => {
    const [halfBps] = summariseSavedLoans([
      entry({ confirmedLoan: { principalBalanceCents: 10_000_000, annualInterestRateBps: 500 } }),
      entry({ confirmedLoan: { principalBalanceCents: 10_000_000, annualInterestRateBps: 501 } }),
    ], AS_OF);
    // Exactly 500.5 bps — half-up, never banker's rounding or a float artefact.
    expect(halfBps?.blendedRateBps).toBe(501);

    const [halfCent] = summariseSavedLoans([
      entry({ xray: fullXRay(6, 0) }),
    ], AS_OF);
    // 6 ÷ 12 = 0.5 cents.
    expect(halfCent?.averageMonthlyServiceCents).toBe(1);
    expect(halfCent?.annualizedDebtServiceCents).toBe(6);
  });

  it('keeps USD and CAD in separate groups and never blends them', () => {
    const summaries = summariseSavedLoans([
      entry({
        currencyCode: 'USD',
        countryCode: 'US',
        confirmedLoan: { principalBalanceCents: 10_000_000, annualInterestRateBps: 500 },
        xray: fullXRay(1_200_000, 300_000),
      }),
      entry({
        currencyCode: 'CAD',
        countryCode: 'CA',
        confirmedLoan: { principalBalanceCents: 90_000_000, annualInterestRateBps: 900 },
        xray: fullXRay(9_000_000, 4_000_000),
      }),
    ], AS_OF);

    expect(summaries.map((summary) => summary.currencyCode)).toEqual(['CAD', 'USD']);
    const [canada, unitedStates] = summaries;
    expect(canada?.countryCode).toBe('CA');
    expect(unitedStates?.countryCode).toBe('US');

    // Every US figure matches the US-only roll-up exactly: the CAD loan is not
    // converted, averaged in, or otherwise able to move a US number.
    const usOnly = summariseSavedLoans([
      entry({ confirmedLoan: { principalBalanceCents: 10_000_000, annualInterestRateBps: 500 }, xray: fullXRay(1_200_000, 300_000) }),
    ], AS_OF);
    expect(unitedStates).toEqual(usOnly[0]);
    expect(canada?.totalBalanceCents).toBe(90_000_000);
    expect(canada?.blendedRateBps).toBe(900);
  });

  it('sorts the groups by currency ascending whatever order the loans arrive in', () => {
    const summaries = summariseSavedLoans([
      entry({ currencyCode: 'USD', countryCode: 'US' }),
      entry({ currencyCode: 'CAD', countryCode: 'CA' }),
      entry({ currencyCode: 'USD', countryCode: 'US' }),
    ], AS_OF);
    expect(summaries.map((summary) => summary.currencyCode)).toEqual(['CAD', 'USD']);
    expect(summaries.map((summary) => summary.loanCount)).toEqual([1, 2]);
  });

  it('flags every loan it could not project instead of summing a silent zero', () => {
    const limited = buildLoanXRay(revolvingLoan, AS_OF);
    expect(limited.current.mode).toBe('LIMITED');

    const [summary] = summariseSavedLoans([
      entry({ confirmedLoan: { principalBalanceCents: 8_000_000, annualInterestRateBps: 900 }, xray: limited }),
      entry({ confirmedLoan: { principalBalanceCents: 2_000_000, annualInterestRateBps: 100 }, xray: {} }),
      entry({ confirmedLoan: { principalBalanceCents: 2_000_000, annualInterestRateBps: 100 }, xray: null }),
      entry({ confirmedLoan: { principalBalanceCents: 2_000_000, annualInterestRateBps: 100 }, xray: 'not a payload' }),
      entry({
        confirmedLoan: { principalBalanceCents: 2_000_000, annualInterestRateBps: 100 },
        xray: { current: { mode: 'FULL', annualizedDebtServiceCents: Number.NaN, projectedInterestCents: 1 } },
      }),
    ], AS_OF);

    expect(summary?.loanCount).toBe(5);
    expect(summary?.projectionLoanCount).toBe(0);
    expect(summary?.excludedLoanCount).toBe(5);
    expect(summary?.annualizedDebtServiceCents).toBeNull();
    expect(summary?.projectedInterestCents).toBeNull();
    expect(summary?.averageMonthlyServiceCents).toBeNull();
    // Balance and rate come from the confirmed loan, so they are still counted.
    expect(summary?.totalBalanceCents).toBe(16_000_000);
    expect(summary?.blendedRateBps).toBe(500);
  });

  it('projects only the loans that narrowed, and says how many it left out', () => {
    const [summary] = summariseSavedLoans([
      entry({ xray: fullXRay(1_200_000, 300_000) }),
      entry({ xray: buildLoanXRay(revolvingLoan, AS_OF) }),
    ], AS_OF);

    expect(summary?.loanCount).toBe(2);
    expect(summary?.projectionLoanCount).toBe(1);
    expect(summary?.excludedLoanCount).toBe(1);
    expect(summary?.annualizedDebtServiceCents).toBe(1_200_000);
    expect(summary?.projectedInterestCents).toBe(300_000);
    expect(summary?.averageMonthlyServiceCents).toBe(100_000);
  });

  it('reports the earliest maturity on or after the as-of date', () => {
    const [summary] = summariseSavedLoans([
      entry({ confirmedLoan: { principalBalanceCents: 1_000_000, annualInterestRateBps: 500, maturityDate: '2029-01-01' } }),
      entry({ confirmedLoan: { principalBalanceCents: 1_000_000, annualInterestRateBps: 500, maturityDate: '2020-01-01' } }),
      entry({ confirmedLoan: { principalBalanceCents: 1_000_000, annualInterestRateBps: 500 } }),
      entry({ confirmedLoan: { principalBalanceCents: 1_000_000, annualInterestRateBps: 500, maturityDate: AS_OF } }),
      entry({ confirmedLoan: { principalBalanceCents: 1_000_000, annualInterestRateBps: 500, maturityDate: '2027-06-30' } }),
    ], AS_OF);
    // The as-of date itself counts; the 2020 maturity and the undated loan do not.
    expect(summary?.nextMaturityDate).toBe(AS_OF);

    const [pastOnly] = summariseSavedLoans([
      entry({ confirmedLoan: { principalBalanceCents: 1_000_000, annualInterestRateBps: 500, maturityDate: '2020-01-01' } }),
      entry({ confirmedLoan: { principalBalanceCents: 1_000_000, annualInterestRateBps: 500 } }),
    ], AS_OF);
    expect(pastOnly?.nextMaturityDate).toBeNull();

    const [undated] = summariseSavedLoans([entry()], AS_OF);
    expect(undated?.nextMaturityDate).toBeNull();
  });

  it('returns nothing for an empty portfolio and refuses an implicit clock', () => {
    expect(summariseSavedLoans([], AS_OF)).toEqual([]);
    expect(() => summariseSavedLoans([entry()], '13-08-2026')).toThrow(ProjectionUnavailableError);
    expect(() => summariseSavedLoans([entry()], '2026-02-30')).toThrow(ProjectionUnavailableError);
  });
});
