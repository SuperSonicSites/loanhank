import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildLoanXRay,
  calculatePaymentCents,
  calculateBreakEvenRate,
  compareScenario,
  decideScenario,
  monthsToRecoverFees,
  projectCurrentLoan,
  scenarioNarrative,
} from '../src/finance/index.js';
import type { ConfirmedLoan, ScenarioRequest } from '../src/shared/schema.js';

const AS_OF = '2026-08-13';
type Fixture = {
  loan: { principal_cents: number; annual_rate_bps: number; payment_frequency: ConfirmedLoan['paymentFrequency']; remaining_periods?: number; rate_type: ConfirmedLoan['rateType']; interest_only?: boolean; balloon_cents?: number; loan_type?: string };
  expected?: Record<string, number>;
  scenarios?: Array<{ input: { annual_rate_bps: number; remaining_periods: number; payment_frequency: 'monthly' | 'quarterly' | 'semiannual' | 'annual'; fees_cents: number; fee_treatment: 'cash' | 'financed' }; expected: Record<string, number> }>;
};

const fixtureData = JSON.parse(await readFile(new URL('../sample_data/SYNTHETIC_TEST_CASES.json', import.meta.url), 'utf8')) as { tolerance_cents: number; cases: Fixture[] };
const close = (actual: number | undefined, expected: number) => expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(fixtureData.tolerance_cents);
const loanOf = (fixture: Fixture): ConfirmedLoan => ({
  principalBalanceCents: fixture.loan.principal_cents,
  annualInterestRateBps: fixture.loan.annual_rate_bps,
  paymentFrequency: fixture.loan.payment_frequency,
  remainingPayments: fixture.loan.remaining_periods,
  rateType: fixture.loan.rate_type,
  interestOnly: fixture.loan.interest_only ?? false,
  balloonAmountCents: fixture.loan.balloon_cents,
  loanType: fixture.loan.loan_type === 'line_of_credit' ? 'line_of_credit' : 'term_loan',
});

describe('deterministic finance engine', () => {
  it('matches the standard-amortization acceptance fixtures', () => {
    const standard = fixtureData.cases.filter((item) => item.expected?.periodic_payment_cents);
    expect(standard).toHaveLength(3);
    for (const fixture of standard) {
      const projection = projectCurrentLoan(loanOf(fixture), AS_OF);
      close(projection.periodicPaymentCents, fixture.expected!.periodic_payment_cents!);
      close(projection.annualizedDebtServiceCents, fixture.expected!.annualized_debt_service_cents!);
      close(projection.projectedInterestCents, fixture.expected!.projected_remaining_interest_cents!);
      close(projection.projectedPaymentsCents, fixture.expected!.projected_remaining_payments_cents!);
    }
  });

  it('drives every remaining fixture case from the file, not from re-typed variants', () => {
    // The standard filter above keys on periodic_payment_cents, which silently
    // excluded these; each is now asserted from the fixture file itself.
    const byId = new Map(fixtureData.cases.map((item) => [(item as { id?: string }).id, item]));

    const interestOnly = byId.get('interest_only_balloon')!;
    const ioProjection = projectCurrentLoan(loanOf(interestOnly), AS_OF);
    expect(ioProjection.mode).toBe('FULL');
    close(ioProjection.periodicPaymentCents, interestOnly.expected!.regular_interest_payment_cents!);
    close(ioProjection.projectedInterestCents, interestOnly.expected!.projected_remaining_interest_cents!);
    close(ioProjection.balloonCents, interestOnly.expected!.balloon_cents!);
    close(ioProjection.finalYearCashOutflowCents, interestOnly.expected!.final_year_cash_outflow_cents!);

    const variable = byId.get('variable_rate_projection')!;
    const variableProjection = projectCurrentLoan(loanOf(variable), AS_OF);
    expect(variableProjection.projectionLabel).toBe('CURRENT_RATE_HELD_CONSTANT');
    expect(variableProjection.provenance).toBe('ESTIMATED');

    const revolving = byId.get('line_of_credit_limited')!;
    const revolvingProjection = projectCurrentLoan(loanOf(revolving), AS_OF);
    expect(revolvingProjection.mode).toBe('LIMITED');
    expect(revolvingProjection.annualizedInterestAtCurrentBalanceCents).toBeGreaterThan(0);
    expect(revolvingProjection.schedule).toBeUndefined();
  });

  it.each([
    ['monthly', 12],
    ['quarterly', 4],
    ['semiannual', 2],
    ['annual', 1],
  ] as const)('reconciles every rounded %s schedule to the cent', (paymentFrequency, periodsPerYear) => {
    const loan: ConfirmedLoan = {
      principalBalanceCents: 12_345_678,
      annualInterestRateBps: 713,
      paymentFrequency,
      remainingPayments: periodsPerYear * 7 + 1,
      rateType: 'fixed',
      interestOnly: false,
      loanType: 'term_loan',
    };
    const result = projectCurrentLoan(loan, AS_OF);
    expect(result.mode).toBe('FULL');
    const schedule = result.schedule!;
    const principal = schedule.reduce((sum, row) => sum + row.principalCents, 0);
    const interest = schedule.reduce((sum, row) => sum + row.interestCents, 0);
    const payments = schedule.reduce((sum, row) => sum + row.paymentCents, 0);
    expect(principal + (result.balloonCents ?? 0)).toBe(loan.principalBalanceCents);
    expect(payments).toBe(principal + interest);
    expect(result.projectedInterestCents).toBe(interest);
    expect(result.projectedPaymentsCents).toBe(payments);
    expect(result.totalCashOutflowCents).toBe(payments + (result.balloonCents ?? 0));
    expect(result.calculationDisclosure).toMatchObject({ periodsPerYear, asOfDate: AS_OF });
  });

  it('handles zero interest without floating-point drift', () => {
    const loan: ConfirmedLoan = { principalBalanceCents: 1_200_000, annualInterestRateBps: 0, paymentFrequency: 'monthly', remainingPayments: 12, rateType: 'fixed', interestOnly: false, loanType: 'term_loan' };
    const result = projectCurrentLoan(loan, AS_OF);
    expect(result.periodicPaymentCents).toBe(100_000);
    expect(result.projectedInterestCents).toBe(0);
    expect(result.projectedPaymentsCents).toBe(1_200_000);
    expect(result.schedule?.at(-1)?.paymentCents).toBe(100_000);
  });

  it('uses Canadian nominal semiannual conversion across payment frequencies and CAD cent rounding', () => {
    expect(calculatePaymentCents(10_000_000, 500, 'monthly', 300, 'nominal_semiannual')).toBe(58_160);
    expect(calculatePaymentCents(10_000_000, 500, 'quarterly', 100, 'nominal_semiannual')).toBe(175_202);
    const monthly = projectCurrentLoan({
      countryCode: 'CA', currencyCode: 'CAD', interestRateConvention: 'nominal_semiannual',
      principalBalanceCents: 10_000_000, annualInterestRateBps: 500, paymentFrequency: 'monthly',
      remainingPayments: 300, rateType: 'fixed', interestOnly: false, loanType: 'term_loan',
    }, AS_OF);
    expect(monthly.calculationDisclosure).toMatchObject({
      interestRateConvention: 'nominal_semiannual', periodicRateDecimal: '0.0041239154651443', periodsPerYear: 12,
    });
    expect(monthly.schedule?.reduce((sum, row) => sum + row.principalCents, 0)).toBe(10_000_000);
  });

  it('stops a Canadian projection when the compounding convention is unknown', () => {
    const result = projectCurrentLoan({
      countryCode: 'CA', currencyCode: 'CAD', interestRateConvention: 'unknown',
      principalBalanceCents: 10_000_000, annualInterestRateBps: 500, paymentFrequency: 'monthly',
      remainingPayments: 120, rateType: 'variable', interestOnly: false, loanType: 'term_loan',
    }, AS_OF);
    expect(result).toMatchObject({ mode: 'LIMITED', requiredFields: ['interestRateConvention'] });
  });

  it.each([
    ['monthly', 18, 60_000, 1_080_000, 13_080_000, 12_720_000],
    ['quarterly', 6, 180_000, 1_080_000, 13_080_000, 12_720_000],
    ['semiannual', 3, 360_000, 1_080_000, 13_080_000, 12_720_000],
    ['annual', 2, 720_000, 1_440_000, 13_440_000, 12_720_000],
  ] as const)('calculates exact %s interest-only totals and a partial final year', (paymentFrequency, periods, payment, interest, outflow, finalYear) => {
    const result = projectCurrentLoan({
      principalBalanceCents: 12_000_000,
      annualInterestRateBps: 600,
      paymentFrequency,
      remainingPayments: periods,
      rateType: 'fixed',
      interestOnly: true,
      loanType: 'term_loan',
    }, AS_OF);
    expect(result.periodicPaymentCents).toBe(payment);
    expect(result.projectedInterestCents).toBe(interest);
    expect(result.projectedPaymentsCents).toBe(interest);
    expect(result.totalCashOutflowCents).toBe(outflow);
    expect(result.finalYearCashOutflowCents).toBe(finalYear);
  });

  it('applies documented payments and adds a reconciled explicit balloon', () => {
    const result = projectCurrentLoan({
      principalBalanceCents: 10_000_000,
      annualInterestRateBps: 1_000,
      paymentAmountCents: 3_000_000,
      paymentFrequency: 'annual',
      remainingPayments: 3,
      balloonAmountCents: 3_380_000,
      rateType: 'fixed',
      interestOnly: false,
      loanType: 'term_loan',
    }, AS_OF);
    expect(result.mode).toBe('FULL');
    expect(result.projectedInterestCents).toBe(2_380_000);
    expect(result.projectedPaymentsCents).toBe(9_000_000);
    expect(result.totalCashOutflowCents).toBe(12_380_000);
    expect(result.finalYearCashOutflowCents).toBe(6_380_000);
    expect(result.schedule?.at(-1)).toMatchObject({ paymentCents: 3_000_000, balloonCents: 3_380_000 });
  });

  it('returns a limited X-Ray when balloon mechanics are missing or inconsistent', () => {
    const base: ConfirmedLoan = {
      principalBalanceCents: 10_000_000,
      annualInterestRateBps: 1_000,
      paymentFrequency: 'annual',
      remainingPayments: 3,
      balloonAmountCents: 3_380_000,
      rateType: 'fixed',
      interestOnly: false,
      loanType: 'term_loan',
    };
    const missingPayment = projectCurrentLoan(base, AS_OF);
    expect(missingPayment).toMatchObject({ mode: 'LIMITED', requiredFields: ['paymentAmountCents'] });
    const mismatch = projectCurrentLoan({ ...base, paymentAmountCents: 3_000_000, balloonAmountCents: 1_000_000 }, AS_OF);
    expect(mismatch.mode).toBe('LIMITED');
    expect(mismatch.limitedReason).toMatch(/do not reconcile/i);
  });

  it('labels variable projections and limits revolving credit', () => {
    const variable = projectCurrentLoan({ ...loanOf(fixtureData.cases[0]!), rateType: 'variable' }, AS_OF);
    expect(variable.projectionLabel).toBe('CURRENT_RATE_HELD_CONSTANT');
    const line = projectCurrentLoan({ ...loanOf(fixtureData.cases[0]!), loanType: 'line_of_credit' }, AS_OF);
    expect(line.mode).toBe('LIMITED');
    expect(line.schedule).toBeUndefined();
  });

  it('matches shorter and longer scenario fixtures with cash and financed fees', () => {
    const fixture = fixtureData.cases[0]!;
    const loan = loanOf(fixture);
    const current = projectCurrentLoan(loan, AS_OF);
    for (const scenarioFixture of fixture.scenarios!) {
      const input: ScenarioRequest = {
        candidateAnnualRateBps: scenarioFixture.input.annual_rate_bps,
        remainingPeriods: scenarioFixture.input.remaining_periods,
        paymentFrequency: scenarioFixture.input.payment_frequency,
        feesCents: scenarioFixture.input.fees_cents,
        feeTreatment: scenarioFixture.input.fee_treatment,
      };
      const result = compareScenario(current, loan, input, AS_OF);
      close(result.periodicPaymentCents, scenarioFixture.expected.periodic_payment_cents!);
      close(result.projectedInterestCents, scenarioFixture.expected.projected_interest_cents!);
    }
    const cash = compareScenario(current, loan, { candidateAnnualRateBps: 650, remainingPeriods: 4, paymentFrequency: 'annual', feesCents: 50_000, feeTreatment: 'cash' }, AS_OF);
    const financed = compareScenario(current, loan, { candidateAnnualRateBps: 650, remainingPeriods: 4, paymentFrequency: 'annual', feesCents: 50_000, feeTreatment: 'financed' }, AS_OF);
    expect(financed.periodicPaymentCents).toBeGreaterThan(cash.periodicPaymentCents);
    expect(cash.totalCashOutflowCents).not.toBe(financed.totalCashOutflowCents);
  });

  it('does not classify equal period counts with different frequencies as same-term', () => {
    const loan = loanOf(fixtureData.cases[0]!);
    const current = projectCurrentLoan(loan, AS_OF);
    const scenario = compareScenario(current, loan, {
      candidateAnnualRateBps: 100,
      remainingPeriods: loan.remainingPayments,
      paymentFrequency: 'semiannual',
      feesCents: 0,
      feeTreatment: 'cash',
    }, AS_OF);
    expect(decideScenario(current, loan, AS_OF, scenario)).not.toBe('SAME_TERM_RATE_SAVINGS_POSSIBLE');
  });

  it('uses only the fixed asOfDate for maturity classification', () => {
    const loan = { ...loanOf(fixtureData.cases[0]!), maturityDate: '2028-02-01' };
    expect(buildLoanXRay(loan, '2026-08-13').decisionState).toBe('MATURITY_OR_BALLOON_SOON');
    expect(buildLoanXRay(loan, '2025-01-01').decisionState).toBe('NO_SCENARIO_TESTED_YET');
    expect(buildLoanXRay(loan, AS_OF).asOfDate).toBe(AS_OF);
  });

  it('never asserts the neutral verdict before a scenario has been tested', () => {
    const loan = loanOf(fixtureData.cases[0]!);
    const current = projectCurrentLoan(loan, AS_OF);
    expect(decideScenario(current, loan, AS_OF)).toBe('NO_SCENARIO_TESTED_YET');
    const immaterial = compareScenario(current, loan, {
      candidateAnnualRateBps: loan.annualInterestRateBps,
      remainingPeriods: loan.remainingPayments,
      paymentFrequency: 'annual',
      feesCents: 0,
      feeTreatment: 'cash',
    }, AS_OF);
    expect(decideScenario(current, loan, AS_OF, immaterial)).toBe('CURRENT_LOAN_REASONABLE');
  });

  it('keeps variable-rate exposure visible after a scenario is tested', () => {
    const loan: ConfirmedLoan = { ...loanOf(fixtureData.cases[0]!), rateType: 'variable' };
    const current = projectCurrentLoan(loan, AS_OF);
    expect(decideScenario(current, loan, AS_OF)).toBe('VARIABLE_RATE_EXPOSURE');
    const scenario = compareScenario(current, loan, {
      candidateAnnualRateBps: 500,
      remainingPeriods: loan.remainingPayments,
      paymentFrequency: 'annual',
      feesCents: 0,
      feeTreatment: 'cash',
    }, AS_OF);
    expect(decideScenario(current, loan, AS_OF, scenario)).toBe('VARIABLE_RATE_EXPOSURE');
  });

  it('classifies a stated balloon with no maturity date as a near-term financing event', () => {
    // Payment, periods, and balloon reconcile per the engine's own residual math.
    const loan: ConfirmedLoan = {
      ...loanOf(fixtureData.cases[0]!),
      paymentFrequency: 'monthly',
      remainingPayments: 12,
      paymentAmountCents: 300_000,
      balloonAmountCents: 31_720_000,
      maturityDate: undefined,
    };
    const current = projectCurrentLoan(loan, AS_OF);
    expect(current.mode).toBe('FULL');
    expect(decideScenario(current, loan, AS_OF)).toBe('MATURITY_OR_BALLOON_SOON');
    const farOut: ConfirmedLoan = { ...loan, remainingPayments: 48, balloonAmountCents: 27_978_739 };
    const farProjection = projectCurrentLoan(farOut, AS_OF);
    expect(farProjection.mode).toBe('FULL');
    expect(decideScenario(farProjection, farOut, AS_OF)).toBe('NO_SCENARIO_TESTED_YET');
  });

  it('uses annual cash-flow relief language and scopes conclusions to tested inputs', () => {
    const loan = loanOf(fixtureData.cases[0]!);
    const result = compareScenario(projectCurrentLoan(loan, AS_OF), loan, {
      candidateAnnualRateBps: 590,
      remainingPeriods: 10,
      paymentFrequency: 'annual',
      feesCents: 0,
      feeTreatment: 'cash',
    }, AS_OF);
    expect(scenarioNarrative(result)).toMatch(/annual cash-flow relief/i);
    expect(scenarioNarrative(result)).toMatch(/tested 5\.90% rate and 10-annual-period term/i);
  });

  it('reports whole months to recover cash fees, and null when the concept does not apply', () => {
    const loan = loanOf(fixtureData.cases[0]!);
    const current = projectCurrentLoan(loan, AS_OF);
    const base = { candidateAnnualRateBps: 685, remainingPeriods: 4, paymentFrequency: 'annual' as const, feeTreatment: 'cash' as const };
    const withFees = compareScenario(current, loan, { ...base, feesCents: 250_000 }, AS_OF);
    // 250,000 / (219,139 / 12) = 13.69 → rounds up to a whole month.
    expect(monthsToRecoverFees(withFees)).toBe(14);
    const noFees = compareScenario(current, loan, { ...base, feesCents: 0 }, AS_OF);
    expect(monthsToRecoverFees(noFees)).toBeNull();
    const noRelief = compareScenario(current, loan, { ...base, candidateAnnualRateBps: 900, feesCents: 250_000 }, AS_OF);
    expect(monthsToRecoverFees(noRelief)).toBeNull();
  });

  it('solves separately named payment and total-cost break-even rates', () => {
    const loan = loanOf(fixtureData.cases[0]!);
    const current = projectCurrentLoan(loan, AS_OF);
    const input = { remainingPeriods: 4, paymentFrequency: 'annual' as const, feesCents: 0, feeTreatment: 'cash' as const };
    expect(calculateBreakEvenRate(current, loan, input, 'payment', AS_OF)).toBeCloseTo(785, 0);
    expect(calculateBreakEvenRate(current, loan, input, 'total_cost', AS_OF)).toBeCloseTo(785, 0);
  });
});
