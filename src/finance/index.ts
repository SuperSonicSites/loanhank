// SHARED PRODUCTION CODE: imported directly by the standalone Worker
// (see AGENTS.md "Shared production code"). A change here ships.
import Decimal from 'decimal.js';
import type { ConfirmedLoan, CountryCode, CurrencyCode, DecisionState, InterestRateConvention, ScenarioRequest } from '../shared/schema.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const FINANCE_ENGINE_VERSION = '0.3.0';
export const periodsPerYear = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
} as const;

export type RegularFrequency = keyof typeof periodsPerYear;
export type ProjectionLabel = 'FIXED_RATE' | 'CURRENT_RATE_HELD_CONSTANT';

export interface SchedulePeriod {
  period: number;
  paymentCents: number;
  principalCents: number;
  interestCents: number;
  balloonCents: number;
}

export interface CalculationDisclosure {
  principalCents: number;
  annualPercentageRateBps: number;
  periodsPerYear: number;
  periodicRateDecimal: string;
  interestRateConvention: InterestRateConvention;
  remainingPeriods: number;
  formulaDescription: string;
  assumptions: string[];
  asOfDate: string;
}

export interface Projection {
  mode: 'FULL' | 'LIMITED';
  provenance: 'ESTIMATED';
  projectionLabel?: ProjectionLabel;
  periodicPaymentCents?: number;
  annualizedDebtServiceCents?: number;
  projectedInterestCents?: number;
  projectedPaymentsCents?: number;
  totalCashOutflowCents?: number;
  annualizedInterestAtCurrentBalanceCents?: number;
  finalYearCashOutflowCents?: number;
  balloonCents?: number;
  schedule?: SchedulePeriod[];
  assumptions: string[];
  calculationDisclosure?: CalculationDisclosure;
  limitedReason?: string;
  requiredFields?: string[];
}

export interface ScenarioResult {
  periodicPaymentCents: number;
  annualizedDebtServiceCents: number;
  projectedInterestCents: number;
  projectedPaymentsCents: number;
  totalCashOutflowCents: number;
  feesCents: number;
  annualCashflowChangeCents: number;
  projectedInterestChangeCents: number;
  totalOutflowChangeCents: number;
  feeTreatment: 'cash' | 'financed';
  remainingPeriods: number;
  paymentFrequency: RegularFrequency;
  candidateAnnualRateBps: number;
  calculationDisclosure: CalculationDisclosure;
}

export interface LoanXRay {
  asOfDate: string;
  decisionState: DecisionState;
  current: Projection;
  known: {
    principalBalanceCents: number;
    annualInterestRateBps: number;
    paymentAmountCents?: number;
    paymentFrequency: ConfirmedLoan['paymentFrequency'];
    maturityDate?: string;
    balloonAmountCents?: number;
    countryCode: ConfirmedLoan['countryCode'];
    currencyCode: ConfirmedLoan['currencyCode'];
    interestRateConvention: ConfirmedLoan['interestRateConvention'];
  };
  hero: { amountCents?: number; title: string; detail: string };
}

export class ProjectionUnavailableError extends Error {
  constructor(
    message: string,
    public readonly requiredFields: string[] = [],
  ) {
    super(message);
    this.name = 'ProjectionUnavailableError';
  }
}

const cents = (dollars: Decimal) => dollars.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
const dollars = (valueCents: number) => new Decimal(valueCents).div(100);
const regularFrequency = (value: ConfirmedLoan['paymentFrequency']): value is RegularFrequency =>
  value in periodsPerYear;

function assertAsOfDate(asOfDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new ProjectionUnavailableError('asOfDate must be an explicit UTC calendar date in YYYY-MM-DD format.');
  }
  const parsed = new Date(`${asOfDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== asOfDate) {
    throw new ProjectionUnavailableError('asOfDate must be a valid UTC calendar date.');
  }
}

export function periodicRateFor(
  annualRateBps: number,
  frequency: RegularFrequency,
  convention: InterestRateConvention = 'nominal_payment_frequency',
): Decimal {
  const annualRate = new Decimal(annualRateBps).div(10_000);
  const payments = periodsPerYear[frequency];
  if (convention === 'nominal_payment_frequency') return annualRate.div(payments);
  if (convention === 'nominal_semiannual') {
    return new Decimal(1).plus(annualRate.div(2)).pow(new Decimal(2).div(payments)).minus(1);
  }
  if (convention === 'effective_annual') {
    return new Decimal(1).plus(annualRate).pow(new Decimal(1).div(payments)).minus(1);
  }
  throw new ProjectionUnavailableError(
    'The interest compounding convention must be confirmed before a full projection can be calculated.',
    ['interestRateConvention'],
  );
}

function paymentDollars(
  principal: Decimal,
  annualRateBps: number,
  frequency: RegularFrequency,
  periods: number,
  convention: InterestRateConvention = 'nominal_payment_frequency',
): Decimal {
  if (periods <= 0) throw new ProjectionUnavailableError('Remaining payments must be greater than zero.');
  const periodicRate = periodicRateFor(annualRateBps, frequency, convention);
  return periodicRate.isZero()
    ? principal.div(periods)
    : principal.mul(periodicRate).div(new Decimal(1).minus(new Decimal(1).plus(periodicRate).pow(-periods)));
}

export function calculatePaymentCents(
  principalCents: number,
  annualRateBps: number,
  frequency: RegularFrequency,
  periods: number,
  convention: InterestRateConvention = 'nominal_payment_frequency',
): number {
  return cents(paymentDollars(dollars(principalCents), annualRateBps, frequency, periods, convention));
}

function disclosure(
  principalCents: number,
  annualRateBps: number,
  frequency: RegularFrequency,
  remainingPeriods: number,
  formulaDescription: string,
  assumptions: string[],
  asOfDate: string,
  convention: InterestRateConvention,
): CalculationDisclosure {
  const periodicRate = periodicRateFor(annualRateBps, frequency, convention);
  return {
    principalCents,
    annualPercentageRateBps: annualRateBps,
    periodsPerYear: periodsPerYear[frequency],
    periodicRateDecimal: periodicRate
      .toFixed(16)
      .replace(/0+$/, '')
      .replace(/\.$/, ''),
    remainingPeriods,
    formulaDescription,
    assumptions,
    asOfDate,
    interestRateConvention: convention,
  };
}

function roundedSchedule(
  exact: Array<{ payment: Decimal; principal: Decimal; interest: Decimal }>,
  principalCents: number,
  balloonCents: number,
): SchedulePeriod[] {
  const scheduledPrincipalTarget = principalCents - balloonCents;
  let priorPrincipal = 0;
  return exact.map((period, index) => {
    const interestCents = cents(period.interest);
    const isLast = index === exact.length - 1;
    const principalPeriodCents = isLast
      ? scheduledPrincipalTarget - priorPrincipal
      : cents(period.principal);
    if (principalPeriodCents < 0) {
      throw new ProjectionUnavailableError('The rounded schedule cannot be reconciled to the documented principal.');
    }
    priorPrincipal += principalPeriodCents;
    return {
      period: index + 1,
      paymentCents: interestCents + principalPeriodCents,
      principalCents: principalPeriodCents,
      interestCents,
      balloonCents: isLast ? balloonCents : 0,
    };
  });
}

function sumSchedule(schedule: SchedulePeriod[]) {
  return schedule.reduce((total, row) => ({
    principalCents: total.principalCents + row.principalCents,
    interestCents: total.interestCents + row.interestCents,
    paymentCents: total.paymentCents + row.paymentCents,
  }), { principalCents: 0, interestCents: 0, paymentCents: 0 });
}

function amortize(
  principalCents: number,
  annualRateBps: number,
  frequency: RegularFrequency,
  periods: number,
  asOfDate: string,
  configuredPaymentCents?: number,
  balloonCents = 0,
  convention: InterestRateConvention = 'nominal_payment_frequency',
): Projection {
  assertAsOfDate(asOfDate);
  if (balloonCents > 0 && configuredPaymentCents === undefined) {
    throw new ProjectionUnavailableError(
      'A documented scheduled payment is required to reconcile an amortizing loan with a balloon.',
      ['paymentAmountCents'],
    );
  }
  const k = periodsPerYear[frequency];
  const periodicRate = periodicRateFor(annualRateBps, frequency, convention);
  const principal = dollars(principalCents);
  const scheduledPayment = configuredPaymentCents === undefined
    ? paymentDollars(principal, annualRateBps, frequency, periods, convention)
    : dollars(configuredPaymentCents);
  let balance = principal;
  const exact: Array<{ payment: Decimal; principal: Decimal; interest: Decimal }> = [];

  for (let index = 1; index <= periods; index += 1) {
    const interest = balance.mul(periodicRate);
    let payment = scheduledPayment;
    let principalPaid = payment.minus(interest);
    if (principalPaid.lessThan(0)) {
      throw new ProjectionUnavailableError('The documented scheduled payment does not cover periodic interest.', [
        'paymentAmountCents',
        'annualInterestRateBps',
      ]);
    }
    if (balloonCents === 0 && index === periods) {
      principalPaid = balance;
      payment = balance.plus(interest);
    } else if (principalPaid.greaterThan(balance)) {
      throw new ProjectionUnavailableError(
        balloonCents > 0
          ? 'The documented scheduled payment retires the balance before the stated balloon is due.'
          : 'The documented loan mechanics cannot be projected through the stated remaining periods.',
        ['paymentAmountCents', 'remainingPayments', 'balloonAmountCents'],
      );
    }
    balance = balance.minus(principalPaid);
    exact.push({ payment, principal: principalPaid, interest });
  }

  if (balloonCents > 0) {
    const documentedBalloon = dollars(balloonCents);
    const tolerance = Decimal.max(new Decimal(5), principal.mul('0.005'));
    if (balance.minus(documentedBalloon).abs().greaterThan(tolerance)) {
      throw new ProjectionUnavailableError(
        'The documented payment, remaining periods, and balloon do not reconcile within the allowed tolerance.',
        ['paymentAmountCents', 'remainingPayments', 'balloonAmountCents'],
      );
    }
  }

  const schedule = roundedSchedule(exact, principalCents, balloonCents);
  const totals = sumSchedule(schedule);
  if (totals.principalCents + balloonCents !== principalCents) {
    throw new ProjectionUnavailableError('The rounded schedule did not reconcile to principal.');
  }
  const assumptions = [
    convention === 'nominal_semiannual'
      ? `The nominal annual rate is compounded semiannually and converted to ${k} effective payment period${k === 1 ? '' : 's'} per year.`
      : convention === 'effective_annual'
        ? `The effective annual rate is converted to ${k} payment period${k === 1 ? '' : 's'} per year.`
        : `Nominal APR is divided into ${k} payment period${k === 1 ? '' : 's'} per year.`,
    balloonCents > 0
      ? 'The documented payment is applied for every remaining period; the documented balloon is then due in addition.'
      : 'The final scheduled payment is adjusted to retire the remaining balance exactly.',
    'Period values are rounded to cents and the final scheduled payment is adjusted for cent reconciliation.',
  ];
  const finalYearPeriods = Math.min(k, schedule.length);
  const finalYearPayments = schedule.slice(-finalYearPeriods)
    .reduce((total, row) => total + row.paymentCents, 0);
  return {
    mode: 'FULL',
    provenance: 'ESTIMATED',
    periodicPaymentCents: configuredPaymentCents ?? cents(scheduledPayment),
    annualizedDebtServiceCents: (configuredPaymentCents ?? cents(scheduledPayment)) * k,
    projectedInterestCents: totals.interestCents,
    projectedPaymentsCents: totals.paymentCents,
    totalCashOutflowCents: totals.paymentCents + balloonCents,
    finalYearCashOutflowCents: finalYearPayments + balloonCents,
    balloonCents: balloonCents || undefined,
    schedule,
    assumptions,
    calculationDisclosure: disclosure(
      principalCents,
      annualRateBps,
      frequency,
      periods,
      configuredPaymentCents === undefined
        ? 'Level-payment amortization: P × r ÷ (1 − (1 + r)^−n).'
        : 'Documented scheduled payment is applied each period; interest is balance × periodic rate and the remainder reduces principal.',
      assumptions,
      asOfDate,
      convention,
    ),
  };
}

function interestOnlyProjection(
  loan: ConfirmedLoan,
  frequency: RegularFrequency,
  periods: number,
  asOfDate: string,
): Projection {
  assertAsOfDate(asOfDate);
  const k = periodsPerYear[frequency];
  const periodicInterest = dollars(loan.principalBalanceCents)
    .mul(periodicRateFor(loan.annualInterestRateBps, frequency, loan.interestRateConvention ?? 'nominal_payment_frequency'));
  const periodicInterestCents = cents(periodicInterest);
  const balloonCents = loan.balloonAmountCents ?? loan.principalBalanceCents;
  const schedule = Array.from({ length: periods }, (_, index) => ({
    period: index + 1,
    paymentCents: periodicInterestCents,
    principalCents: 0,
    interestCents: periodicInterestCents,
    balloonCents: index + 1 === periods ? balloonCents : 0,
  }));
  const totalInterestCents = periodicInterestCents * periods;
  const finalYearInterestCents = periodicInterestCents * Math.min(periods, k);
  const assumptions = [
    'Interest-only payments are principal × periodic rate; principal is due as the final balloon.',
    'The stated current rate is held constant for every remaining period.',
  ];
  return {
    mode: 'FULL',
    provenance: 'ESTIMATED',
    periodicPaymentCents: periodicInterestCents,
    annualizedDebtServiceCents: periodicInterestCents * k,
    projectedInterestCents: totalInterestCents,
    projectedPaymentsCents: totalInterestCents,
    totalCashOutflowCents: totalInterestCents + balloonCents,
    finalYearCashOutflowCents: finalYearInterestCents + balloonCents,
    balloonCents,
    schedule,
    assumptions,
    calculationDisclosure: disclosure(
      loan.principalBalanceCents,
      loan.annualInterestRateBps,
      frequency,
      periods,
      'Interest-only payment: principal × the periodic rate derived from the documented convention; the balloon is added after the last regular payment.',
      assumptions,
      asOfDate,
      loan.interestRateConvention ?? 'nominal_payment_frequency',
    ),
  };
}

function limitedProjection(
  loan: ConfirmedLoan,
  asOfDate: string,
  reason: string,
  requiredFields: string[] = [],
): Projection {
  return {
    mode: 'LIMITED',
    provenance: 'ESTIMATED',
    annualizedInterestAtCurrentBalanceCents: cents(
      dollars(loan.principalBalanceCents).mul(loan.annualInterestRateBps).div(10_000),
    ),
    assumptions: [
      'No trustworthy fixed payoff schedule is available, so projected lifetime interest is not shown.',
      `Analysis date: ${asOfDate}.`,
    ],
    limitedReason: reason,
    requiredFields,
  };
}

export function projectCurrentLoan(loan: ConfirmedLoan, asOfDate: string): Projection {
  assertAsOfDate(asOfDate);
  if (loan.interestRateConvention === 'unknown') {
    return limitedProjection(loan, asOfDate, 'The interest compounding convention was not confirmed.', ['interestRateConvention']);
  }
  if (loan.loanType === 'line_of_credit' || loan.paymentFrequency === 'irregular' || loan.paymentFrequency === 'unknown') {
    return limitedProjection(loan, asOfDate, 'A regular contractual payoff schedule was not confirmed.', [
      'paymentFrequency',
      'remainingPayments',
    ]);
  }
  if (!regularFrequency(loan.paymentFrequency)) {
    return limitedProjection(loan, asOfDate, 'A regular payment frequency is required.', ['paymentFrequency']);
  }
  if (!loan.remainingPayments) {
    return limitedProjection(loan, asOfDate, 'Remaining payment count is required for a full projection.', [
      'remainingPayments',
    ]);
  }
  try {
    const convention = loan.interestRateConvention ?? 'nominal_payment_frequency';
    const projection = loan.interestOnly
      ? interestOnlyProjection(loan, loan.paymentFrequency, loan.remainingPayments, asOfDate)
      : amortize(
        loan.principalBalanceCents,
        loan.annualInterestRateBps,
        loan.paymentFrequency,
        loan.remainingPayments,
        asOfDate,
        loan.balloonAmountCents ? loan.paymentAmountCents : undefined,
        loan.balloonAmountCents,
        convention,
      );
    if (loan.rateType === 'variable') {
      projection.projectionLabel = 'CURRENT_RATE_HELD_CONSTANT';
      projection.assumptions.unshift('Variable-rate projection holds the documented current rate constant; future resets are unknown.');
    } else {
      projection.projectionLabel = 'FIXED_RATE';
    }
    return projection;
  } catch (error) {
    if (error instanceof ProjectionUnavailableError) {
      return limitedProjection(loan, asOfDate, error.message, error.requiredFields);
    }
    throw error;
  }
}

export function compareScenario(
  current: Projection,
  loan: ConfirmedLoan,
  request: ScenarioRequest,
  asOfDate: string,
): ScenarioResult {
  assertAsOfDate(asOfDate);
  if (
    current.mode !== 'FULL'
    || current.annualizedDebtServiceCents === undefined
    || current.projectedInterestCents === undefined
    || current.totalCashOutflowCents === undefined
  ) {
    throw new ProjectionUnavailableError('A full current-loan projection is required before comparing a scenario.');
  }
  const periods = request.remainingPeriods ?? Math.max(1, new Decimal(request.termYears!)
    .mul(periodsPerYear[request.paymentFrequency])
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber());
  const financedPrincipal = loan.principalBalanceCents + (request.feeTreatment === 'financed' ? request.feesCents : 0);
  const candidate = amortize(
    financedPrincipal,
    request.candidateAnnualRateBps,
    request.paymentFrequency,
    periods,
    asOfDate,
    undefined,
    0,
    loan.interestRateConvention ?? 'nominal_payment_frequency',
  );
  const cashFees = request.feeTreatment === 'cash' ? request.feesCents : 0;
  const totalCashOutflowCents = candidate.totalCashOutflowCents! + cashFees;
  return {
    periodicPaymentCents: candidate.periodicPaymentCents!,
    annualizedDebtServiceCents: candidate.annualizedDebtServiceCents!,
    projectedInterestCents: candidate.projectedInterestCents!,
    projectedPaymentsCents: candidate.projectedPaymentsCents!,
    totalCashOutflowCents,
    feesCents: request.feesCents,
    annualCashflowChangeCents: current.annualizedDebtServiceCents - candidate.annualizedDebtServiceCents!,
    projectedInterestChangeCents: current.projectedInterestCents - candidate.projectedInterestCents!,
    totalOutflowChangeCents: current.totalCashOutflowCents - totalCashOutflowCents,
    feeTreatment: request.feeTreatment,
    remainingPeriods: periods,
    paymentFrequency: request.paymentFrequency,
    candidateAnnualRateBps: request.candidateAnnualRateBps,
    calculationDisclosure: candidate.calculationDisclosure!,
  };
}

export function decideScenario(
  current: Projection,
  loan: ConfirmedLoan,
  asOfDate: string,
  scenario?: ScenarioResult,
): DecisionState {
  assertAsOfDate(asOfDate);
  if (loan.loanType === 'line_of_credit') return 'REVOLVING_LINE_LIMITED_ANALYSIS';
  if (current.mode === 'LIMITED') return 'LIMITED_ANALYSIS_MISSING_INPUT';
  if (loan.maturityDate && monthsUntil(loan.maturityDate, asOfDate) <= 18) return 'MATURITY_OR_BALLOON_SOON';
  // A stated balloon lands with the final scheduled payment even when the
  // document carries no explicit maturity date.
  if (
    loan.balloonAmountCents
    && !loan.maturityDate
    && loan.remainingPayments
    && regularFrequency(loan.paymentFrequency)
    && loan.remainingPayments * (12 / periodsPerYear[loan.paymentFrequency]) <= 18
  ) return 'MATURITY_OR_BALLOON_SOON';
  // Variable-rate exposure is a fact about the current loan; it does not
  // disappear because a hypothetical was tested.
  if (loan.rateType === 'variable') return 'VARIABLE_RATE_EXPOSURE';
  if (!scenario) return 'NO_SCENARIO_TESTED_YET';
  const material = Math.max(25_000, new Decimal(loan.principalBalanceCents)
    .mul('0.0025')
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber());
  if (scenario.annualCashflowChangeCents > material && scenario.projectedInterestChangeCents < -material) {
    return 'CASH_FLOW_RELIEF_WITH_HIGHER_LIFETIME_COST';
  }
  if (scenario.annualCashflowChangeCents > material && scenario.totalOutflowChangeCents > material) {
    const sameTerm = scenario.remainingPeriods === loan.remainingPayments
      && scenario.paymentFrequency === loan.paymentFrequency;
    return sameTerm ? 'SAME_TERM_RATE_SAVINGS_POSSIBLE' : 'CASH_FLOW_AND_TOTAL_COST_IMPROVEMENT';
  }
  return 'CURRENT_LOAN_REASONABLE';
}

export function buildLoanXRay(loan: ConfirmedLoan, asOfDate: string): LoanXRay {
  assertAsOfDate(asOfDate);
  const current = projectCurrentLoan(loan, asOfDate);
  const decisionState = decideScenario(current, loan, asOfDate);
  const hero = current.mode === 'LIMITED'
    ? {
      amountCents: current.annualizedInterestAtCurrentBalanceCents,
      title: 'Current-balance interest context',
      detail: current.limitedReason ?? 'A projected lifetime cost is not available until the contractual terms are confirmed.',
    }
    : {
      amountCents: current.annualizedDebtServiceCents,
      title: 'Scheduled debt service over the next 12 months',
      detail: loan.rateType === 'variable'
        ? 'Estimate using the documented current rate held constant; future resets are not known.'
        : 'Estimate under the documented payment frequency and remaining term.',
    };
  return {
    asOfDate,
    decisionState,
    current,
    known: {
      principalBalanceCents: loan.principalBalanceCents,
      annualInterestRateBps: loan.annualInterestRateBps,
      paymentAmountCents: loan.paymentAmountCents,
      paymentFrequency: loan.paymentFrequency,
      maturityDate: loan.maturityDate,
      balloonAmountCents: loan.balloonAmountCents,
      countryCode: loan.countryCode ?? 'US',
      currencyCode: loan.currencyCode ?? 'USD',
      interestRateConvention: loan.interestRateConvention ?? 'nominal_payment_frequency',
    },
    hero,
  };
}

/** One saved loan reduced to the fields a portfolio roll-up is allowed to read. */
export interface PortfolioLoanInput {
  currencyCode: CurrencyCode;
  countryCode: CountryCode;
  confirmedLoan: {
    principalBalanceCents: number;
    annualInterestRateBps: number;
    maturityDate?: string;
  };
  /** `SavedLoan.xray` is persisted as `z.unknown()`; it is narrowed structurally here. */
  xray: unknown;
}

/** Every saved loan denominated in one currency, rolled up. */
export interface PortfolioCurrencySummary {
  currencyCode: CurrencyCode;
  countryCode: CountryCode;
  loanCount: number;
  totalBalanceCents: number;
  /** Balance-weighted average rate; `null` when the group carries no balance. */
  blendedRateBps: number | null;
  /** Earliest confirmed maturity on or after `asOfDate`; `null` when none is dated. */
  nextMaturityDate: string | null;
  annualizedDebtServiceCents: number | null;
  projectedInterestCents: number | null;
  averageMonthlyServiceCents: number | null;
  /** Loans whose stored X-Ray carried a FULL projection, so their figures are summed. */
  projectionLoanCount: number;
  /** Loans whose X-Ray was LIMITED or unreadable — flagged, never summed as zero. */
  excludedLoanCount: number;
}

interface PortfolioAccumulator {
  currencyCode: CurrencyCode;
  countryCode: CountryCode;
  loanCount: number;
  totalBalanceCents: number;
  weightedRateNumerator: Decimal;
  nextMaturityDate: string | null;
  annualizedDebtServiceCents: number;
  projectedInterestCents: number;
  projectionLoanCount: number;
  excludedLoanCount: number;
}

/**
 * Structural narrowing of a stored X-Ray payload down to the two projected
 * figures a roll-up may sum. It mirrors exactly what `buildLoanXRay` writes:
 * anything short of a FULL projection carrying both finite figures returns
 * `null`, so a LIMITED or malformed payload is counted as excluded rather than
 * quietly contributing zero.
 */
function fullProjectionFigures(
  xray: unknown,
): { annualizedDebtServiceCents: number; projectedInterestCents: number } | null {
  if (typeof xray !== 'object' || xray === null) return null;
  const current = (xray as { current?: unknown }).current;
  if (typeof current !== 'object' || current === null) return null;
  const projection = current as {
    mode?: unknown;
    annualizedDebtServiceCents?: unknown;
    projectedInterestCents?: unknown;
  };
  if (projection.mode !== 'FULL') return null;
  const service = projection.annualizedDebtServiceCents;
  const interest = projection.projectedInterestCents;
  if (typeof service !== 'number' || !Number.isFinite(service)) return null;
  if (typeof interest !== 'number' || !Number.isFinite(interest)) return null;
  return { annualizedDebtServiceCents: service, projectedInterestCents: interest };
}

/**
 * Rolls saved loans up, one group per currency present. USD and CAD are never
 * blended or converted, so a figure is only ever comparable inside its own
 * group; the country travels with the group because the two correspond 1:1
 * (`confirmedLoanSchema` rejects any other pairing at the boundary).
 *
 * Balance, rate, and maturity come from the confirmed loan, which is always
 * present, so every saved loan contributes them. The projected figures are
 * summed only over loans whose stored X-Ray narrows to a FULL projection, and
 * are `null` when no loan in the group does — a partial roll-up must never be
 * readable as a complete one.
 */
export function summariseSavedLoans(
  loans: readonly PortfolioLoanInput[],
  asOfDate: string,
): PortfolioCurrencySummary[] {
  assertAsOfDate(asOfDate);
  const groups = new Map<CurrencyCode, PortfolioAccumulator>();
  for (const loan of loans) {
    let group = groups.get(loan.currencyCode);
    if (group === undefined) {
      group = {
        currencyCode: loan.currencyCode,
        countryCode: loan.countryCode,
        loanCount: 0,
        totalBalanceCents: 0,
        weightedRateNumerator: new Decimal(0),
        nextMaturityDate: null,
        annualizedDebtServiceCents: 0,
        projectedInterestCents: 0,
        projectionLoanCount: 0,
        excludedLoanCount: 0,
      };
      groups.set(loan.currencyCode, group);
    }
    const { principalBalanceCents, annualInterestRateBps, maturityDate } = loan.confirmedLoan;
    group.loanCount += 1;
    group.totalBalanceCents += principalBalanceCents;
    group.weightedRateNumerator = group.weightedRateNumerator.plus(
      new Decimal(principalBalanceCents).mul(annualInterestRateBps),
    );
    if (
      maturityDate !== undefined
      && /^\d{4}-\d{2}-\d{2}$/.test(maturityDate)
      && maturityDate >= asOfDate
      && (group.nextMaturityDate === null || maturityDate < group.nextMaturityDate)
    ) {
      group.nextMaturityDate = maturityDate;
    }
    const figures = fullProjectionFigures(loan.xray);
    if (figures === null) {
      group.excludedLoanCount += 1;
    } else {
      group.projectionLoanCount += 1;
      group.annualizedDebtServiceCents += figures.annualizedDebtServiceCents;
      group.projectedInterestCents += figures.projectedInterestCents;
    }
  }
  return [...groups.values()]
    // Plain code-unit ordering, not a locale collation: the group order must
    // not vary with the machine that runs it.
    .sort((left, right) => (left.currencyCode < right.currencyCode ? -1 : left.currencyCode > right.currencyCode ? 1 : 0))
    .map((group) => {
      const projected = group.projectionLoanCount > 0;
      const annualizedDebtServiceCents = projected ? group.annualizedDebtServiceCents : null;
      return {
        currencyCode: group.currencyCode,
        countryCode: group.countryCode,
        loanCount: group.loanCount,
        totalBalanceCents: group.totalBalanceCents,
        blendedRateBps: group.totalBalanceCents === 0
          ? null
          : group.weightedRateNumerator
            .div(group.totalBalanceCents)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toNumber(),
        nextMaturityDate: group.nextMaturityDate,
        annualizedDebtServiceCents,
        projectedInterestCents: projected ? group.projectedInterestCents : null,
        averageMonthlyServiceCents: annualizedDebtServiceCents === null
          ? null
          : new Decimal(annualizedDebtServiceCents).div(12).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
        projectionLoanCount: group.projectionLoanCount,
        excludedLoanCount: group.excludedLoanCount,
      };
    });
}

/* ------------------------------------------------------ dates and anchors */

/**
 * Whether a value is an explicit UTC calendar date in `YYYY-MM-DD`, verified
 * by round-tripping it through `Date` so `2027-02-30` is rejected instead of
 * being silently rolled forward. This is the non-throwing form of the check
 * `assertAsOfDate` makes, and it exists because the *optional* confirmed
 * fields a calendar is anchored on must be allowed to be absent or unusable
 * without costing the loan its whole projection.
 */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Length of a UTC month by proleptic Gregorian arithmetic. Deliberately not
 * `new Date(Date.UTC(year, month + 1, 0))`: that constructor remaps years
 * 0–99 into the 1900s, which would silently mis-clamp a mistyped year.
 */
function daysInUtcMonth(year: number, monthIndex: number): number {
  if (monthIndex === 1) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return monthIndex === 3 || monthIndex === 5 || monthIndex === 8 || monthIndex === 10 ? 30 : 31;
}

/**
 * Adds whole calendar months to a date-only UTC string; a negative `months`
 * subtracts. The day is clamped to the length of the target month.
 *
 * The clamp is measured from the *original* anchor day on every call and is
 * never iterated, so each period's date is derived independently and a short
 * month cannot poison the rest of a schedule: `2028-01-31` plus two months is
 * `2028-03-31`, not `2028-02-29` carried forward to `2028-03-29`.
 *
 * PARALLEL, NOT DUPLICATE — this must not be merged with the private
 * `subtractUtcMonths` in `standalone/src/alert-schedule.ts`. That helper works
 * on `Date` objects pinned at `T12:00:00Z`, because an alert is an instant
 * that has to survive a timezone shift; this one works on date-only strings at
 * `T00:00:00Z`, because a payment date is a calendar fact with no time of day.
 * Collapsing them would force one of the two domains to carry a time it does
 * not have.
 */
export function addUtcMonths(date: string, months: number): string {
  if (!isCalendarDate(date)) {
    throw new ProjectionUnavailableError('A payment-calendar date must be a valid UTC calendar date in YYYY-MM-DD format.');
  }
  if (!Number.isInteger(months)) {
    throw new ProjectionUnavailableError('A calendar offset must be a whole number of months.');
  }
  const shifted = Number(date.slice(5, 7)) - 1 + months;
  const targetYear = Number(date.slice(0, 4)) + Math.floor(shifted / 12);
  const targetMonth = ((shifted % 12) + 12) % 12;
  const day = Math.min(Number(date.slice(8, 10)), daysInUtcMonth(targetYear, targetMonth));
  return [
    String(targetYear).padStart(4, '0'),
    String(targetMonth + 1).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

/** Why a loan carries no dateable payment schedule. */
export type PaymentAnchorReason = 'no_regular_frequency' | 'no_dated_anchor';

/**
 * Where a schedule's calendar dates come from, plus the month step between
 * consecutive payments. `none` is a first-class outcome, not a failure: a loan
 * with no regular frequency, or with no confirmed date to hang the schedule
 * on, is reported and excluded rather than given invented dates.
 */
export type PaymentAnchor =
  | { kind: 'next_payment_date'; firstPaymentDate: string; stepMonths: 1 | 3 | 6 | 12 }
  | { kind: 'maturity_backcount'; firstPaymentDate: string; stepMonths: 1 | 3 | 6 | 12 }
  | { kind: 'none'; reason: PaymentAnchorReason };

/**
 * Resolves the first dated payment of the remaining schedule.
 *
 * A confirmed `nextPaymentDate` wins outright — it is a date read off the
 * statement. Failing that, the schedule is back-counted from maturity, which
 * needs both a valid `maturityDate` and a remaining-payment count of at least
 * one, and places the FINAL payment exactly on the maturity date. Nothing else
 * is accepted; in particular an anchor is never derived from the analysis date,
 * which would be a guess about the loan rather than a fact from the document.
 *
 * The date checks here are non-throwing on purpose: an unparseable optional
 * `nextPaymentDate` falls through to the back-count instead of aborting, and a
 * loan with neither usable date simply reports `no_dated_anchor`.
 */
export function paymentAnchor(
  loan: Pick<ConfirmedLoan, 'paymentFrequency' | 'nextPaymentDate' | 'maturityDate' | 'remainingPayments'>,
): PaymentAnchor {
  const frequency = loan.paymentFrequency;
  if (!regularFrequency(frequency)) return { kind: 'none', reason: 'no_regular_frequency' };
  const stepMonths = (12 / periodsPerYear[frequency]) as 1 | 3 | 6 | 12;
  if (isCalendarDate(loan.nextPaymentDate)) {
    return { kind: 'next_payment_date', firstPaymentDate: loan.nextPaymentDate, stepMonths };
  }
  const remaining = loan.remainingPayments;
  if (
    isCalendarDate(loan.maturityDate)
    && typeof remaining === 'number'
    && Number.isInteger(remaining)
    && remaining >= 1
  ) {
    return {
      kind: 'maturity_backcount',
      firstPaymentDate: addUtcMonths(loan.maturityDate, -(remaining - 1) * stepMonths),
      stepMonths,
    };
  }
  return { kind: 'none', reason: 'no_dated_anchor' };
}

/** One dated row of a stored schedule; every cent is copied, none is derived. */
export interface PaymentCalendarEntry {
  date: string;
  period: number;
  paymentCents: number;
  principalCents: number;
  interestCents: number;
  balloonCents: number;
  balanceAfterCents: number;
}

export interface PaymentCalendar {
  anchor: PaymentAnchor;
  entries: PaymentCalendarEntry[];
}

/**
 * Structural narrowing of a stored X-Ray payload down to the schedule rows a
 * calendar may date, mirroring `fullProjectionFigures`. Anything short of a
 * FULL projection carrying a well-formed `SchedulePeriod[]` returns `null`, so
 * a LIMITED or malformed payload yields no dated payments rather than a
 * half-read schedule.
 */
function fullSchedule(xray: unknown): SchedulePeriod[] | null {
  if (typeof xray !== 'object' || xray === null) return null;
  const current = (xray as { current?: unknown }).current;
  if (typeof current !== 'object' || current === null) return null;
  const projection = current as { mode?: unknown; schedule?: unknown };
  if (projection.mode !== 'FULL') return null;
  if (!Array.isArray(projection.schedule)) return null;
  const rows: SchedulePeriod[] = [];
  for (const row of projection.schedule as unknown[]) {
    if (typeof row !== 'object' || row === null) return null;
    const { period, paymentCents, principalCents, interestCents, balloonCents } = row as Record<string, unknown>;
    if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) return null;
    if (typeof paymentCents !== 'number' || !Number.isFinite(paymentCents)) return null;
    if (typeof principalCents !== 'number' || !Number.isFinite(principalCents)) return null;
    if (typeof interestCents !== 'number' || !Number.isFinite(interestCents)) return null;
    if (typeof balloonCents !== 'number' || !Number.isFinite(balloonCents)) return null;
    rows.push({ period, paymentCents, principalCents, interestCents, balloonCents });
  }
  return rows;
}

/**
 * Dates the stored amortization schedule without recomputing a cent of it.
 *
 * Every amount is copied verbatim from the schedule `buildLoanXRay` already
 * wrote, so the calendar and the X-Ray can never disagree. The only figures
 * added here are a date per period and the running balance implied by the
 * schedule's own principal column (the balloon reduces principal on its row
 * too). `balanceAfterCents` therefore reaches exactly zero on the final row —
 * guaranteed by the engine's final-period reconciliation plug, not by any
 * rounding performed here.
 *
 * With no anchor, or with an X-Ray that does not narrow to a FULL projection,
 * the entry list is empty and the anchor is still reported so a caller can say
 * why rather than showing a schedule it invented.
 *
 * `horizonMonths`, when given, keeps only the payments falling strictly after
 * `asOfDate` and on or before that many months later: a payment already due is
 * history, not something still ahead of the borrower.
 */
export function paymentCalendar(
  loan: ConfirmedLoan,
  xray: unknown,
  options: { asOfDate: string; horizonMonths?: number },
): PaymentCalendar {
  assertAsOfDate(options.asOfDate);
  const anchor = paymentAnchor(loan);
  const schedule = fullSchedule(xray);
  if (anchor.kind === 'none' || schedule === null) return { anchor, entries: [] };
  let balanceAfterCents = loan.principalBalanceCents;
  const entries = schedule.map((row) => {
    balanceAfterCents -= row.principalCents + row.balloonCents;
    return {
      date: addUtcMonths(anchor.firstPaymentDate, (row.period - 1) * anchor.stepMonths),
      period: row.period,
      paymentCents: row.paymentCents,
      principalCents: row.principalCents,
      interestCents: row.interestCents,
      balloonCents: row.balloonCents,
      balanceAfterCents,
    };
  });
  if (options.horizonMonths === undefined) return { anchor, entries };
  const horizonEnd = addUtcMonths(options.asOfDate, options.horizonMonths);
  return {
    anchor,
    entries: entries.filter((entry) => entry.date > options.asOfDate && entry.date <= horizonEnd),
  };
}

/** A confirmed balance rolled forward over the payments already dated past. */
export interface BalanceAsOf {
  balanceCents: number;
  periodsElapsed: number;
  /** `false` means nothing was rolled forward: the confirmed balance is returned as-is. */
  anchored: boolean;
}

/**
 * The balance implied by the stored schedule on `asOfDate`.
 *
 * A loan that cannot be dated — no anchor, or no FULL schedule — is not
 * guessed at: the confirmed principal is returned unchanged with
 * `anchored: false`, so a caller can show it as the documented figure rather
 * than as a current one. Otherwise the schedule's own principal column is
 * subtracted for every payment dated on or before `asOfDate`, which lands on
 * exactly zero once the whole schedule has elapsed.
 */
export function balanceAsOf(loan: ConfirmedLoan, xray: unknown, asOfDate: string): BalanceAsOf {
  assertAsOfDate(asOfDate);
  const { anchor, entries } = paymentCalendar(loan, xray, { asOfDate });
  if (anchor.kind === 'none' || entries.length === 0) {
    return { balanceCents: loan.principalBalanceCents, periodsElapsed: 0, anchored: false };
  }
  const elapsed = entries.filter((entry) => entry.date <= asOfDate);
  const last = elapsed[elapsed.length - 1];
  return {
    balanceCents: last === undefined ? loan.principalBalanceCents : last.balanceAfterCents,
    periodsElapsed: elapsed.length,
    anchored: true,
  };
}

/** One saved loan reduced to what a ticked-balance roll-up is allowed to read. */
export interface TickedBalanceInput {
  currencyCode: CurrencyCode;
  countryCode: CountryCode;
  confirmedLoan: ConfirmedLoan;
  /** `SavedLoan.xray` is persisted as `z.unknown()`; it is narrowed structurally here. */
  xray: unknown;
}

/** Every saved loan in one currency, rolled forward to the analysis date. */
export interface TickedBalanceSummary {
  currencyCode: CurrencyCode;
  countryCode: CountryCode;
  loanCount: number;
  /** Loans whose schedule could be dated, and whose balance therefore moved. */
  tickedLoanCount: number;
  totalBalanceCents: number;
}

/**
 * Rolls saved balances forward to `asOfDate`, one group per currency present.
 * USD and CAD are never blended or converted, exactly as in
 * `summariseSavedLoans`, and the group order is plain code-unit order so it
 * cannot vary with the machine that runs it.
 *
 * A loan that could not be dated still counts toward `loanCount` and still
 * contributes its confirmed balance — dropping it would understate the group,
 * and rolling it forward would invent payments. `tickedLoanCount` says how
 * many of the totals actually moved.
 *
 * The sums are plain integer cents: every input is already a reconciled cent
 * figure from the engine, so there is nothing here to round.
 */
export function summariseTickedBalances(
  loans: readonly TickedBalanceInput[],
  asOfDate: string,
): TickedBalanceSummary[] {
  assertAsOfDate(asOfDate);
  const groups = new Map<CurrencyCode, TickedBalanceSummary>();
  for (const loan of loans) {
    let group = groups.get(loan.currencyCode);
    if (group === undefined) {
      group = {
        currencyCode: loan.currencyCode,
        countryCode: loan.countryCode,
        loanCount: 0,
        tickedLoanCount: 0,
        totalBalanceCents: 0,
      };
      groups.set(loan.currencyCode, group);
    }
    // `balanceAsOf` already returns the confirmed principal untouched when the
    // loan is unanchored, so one branch covers both cases honestly.
    const ticked = balanceAsOf(loan.confirmedLoan, loan.xray, asOfDate);
    group.loanCount += 1;
    if (ticked.anchored) group.tickedLoanCount += 1;
    group.totalBalanceCents += ticked.balanceCents;
  }
  return [...groups.values()]
    .sort((left, right) => (left.currencyCode < right.currencyCode ? -1 : left.currencyCode > right.currencyCode ? 1 : 0));
}

/** One calendar year of an already-dated schedule, sliced for a year-end summary. */
export interface CalendarYearSlice {
  year: number;
  paymentsInYear: number;
  interestCents: number;
  paymentCents: number;
  closingBalanceCents: number;
}

/**
 * Sums one calendar year out of a calendar `paymentCalendar` already produced.
 *
 * Not a second amortization: every cent is read off the entries, so a year-end
 * summary and the schedule it came from cannot disagree. The slice is therefore
 * ESTIMATED for the same reason the schedule is — it is a forecast of the
 * payments the confirmed terms schedule, never a record of payments made.
 *
 * A balloon is money that leaves the farm, not a financing cost, so
 * `balloonCents` is added to `paymentCents` and is deliberately kept out of
 * `interestCents`: an accountant reading the interest column must see interest
 * and nothing else.
 *
 * Membership is decided by plain code-unit comparison of the `YYYY-MM-DD`
 * strings, which is chronological for this format and carries no timezone. A
 * December payment therefore stays in December and a January one in January,
 * whatever the reader's clock says. `closingBalanceCents` is the balance after
 * the last payment dated on or before December 31 — which is
 * `openingBalanceCents` when the year precedes the anchor, and zero once the
 * schedule has run out, so a year with no payments still reports an honest
 * balance rather than a gap.
 */
export function interestByCalendarYear(
  entries: readonly PaymentCalendarEntry[],
  openingBalanceCents: number,
  year: number,
): CalendarYearSlice {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new ProjectionUnavailableError('A report year must be a whole four-digit calendar year.');
  }
  const yearText = String(year).padStart(4, '0');
  const firstDay = `${yearText}-01-01`;
  const lastDay = `${yearText}-12-31`;
  let paymentsInYear = 0;
  let interestCents = 0;
  let paymentCents = 0;
  let closingBalanceCents = openingBalanceCents;
  // Tracked explicitly rather than assuming the array is sorted, so a caller
  // holding a filtered or reordered calendar still gets the right closing row.
  let closingDate: string | null = null;
  for (const entry of entries) {
    if (entry.date >= firstDay && entry.date <= lastDay) {
      paymentsInYear += 1;
      interestCents += entry.interestCents;
      paymentCents += entry.paymentCents + entry.balloonCents;
    }
    if (entry.date <= lastDay && (closingDate === null || entry.date >= closingDate)) {
      closingDate = entry.date;
      closingBalanceCents = entry.balanceAfterCents;
    }
  }
  return { year, paymentsInYear, interestCents, paymentCents, closingBalanceCents };
}

export function calculateBreakEvenRate(
  current: Projection,
  loan: ConfirmedLoan,
  request: Omit<ScenarioRequest, 'candidateAnnualRateBps'>,
  type: 'payment' | 'total_cost',
  asOfDate: string,
): number | null {
  if (current.mode !== 'FULL') return null;
  const target = type === 'payment' ? current.periodicPaymentCents : current.totalCashOutflowCents;
  if (target === undefined) return null;
  const at = (bps: number) => {
    const result = compareScenario(current, loan, { ...request, candidateAnnualRateBps: bps }, asOfDate);
    return type === 'payment' ? result.periodicPaymentCents : result.totalCashOutflowCents;
  };
  let low = 0;
  let high = 3_000;
  const lowDifference = at(low) - target;
  const highDifference = at(high) - target;
  if ((lowDifference > 0 && highDifference > 0) || (lowDifference < 0 && highDifference < 0)) return null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const difference = at(middle) - target;
    if (difference === 0) return middle;
    if (difference > 0) high = middle - 1;
    else low = middle + 1;
  }
  const lower = Math.max(0, high);
  const upper = Math.min(3_000, low);
  return Math.abs(at(lower) - target) <= Math.abs(at(upper) - target) ? lower : upper;
}

export function monthsToRecoverFees(result: ScenarioResult): number | null {
  if (result.feesCents <= 0 || result.annualCashflowChangeCents <= 0) return null;
  return new Decimal(result.feesCents)
    .div(new Decimal(result.annualCashflowChangeCents).div(12))
    .toDecimalPlaces(0, Decimal.ROUND_UP)
    .toNumber();
}

export function scenarioNarrative(result: ScenarioResult, currency: CurrencyCode = 'USD'): string {
  const cash = formatCurrency(Math.abs(result.annualCashflowChangeCents), currency);
  const interest = formatCurrency(Math.abs(result.projectedInterestChangeCents), currency);
  const scope = `This conclusion applies only to the tested ${formatRate(result.candidateAnnualRateBps)} rate and ${result.remainingPeriods}-${result.paymentFrequency}-period term.`;
  if (result.annualCashflowChangeCents > 0 && result.projectedInterestChangeCents < 0) {
    return `This scenario provides ${cash}/year of annual cash-flow relief but adds ${interest} of projected lifetime interest. ${scope}`;
  }
  if (result.annualCashflowChangeCents > 0 && result.projectedInterestChangeCents >= 0) {
    return `This scenario lowers annual debt service by ${cash} and lowers projected interest by ${interest}. ${scope}`;
  }
  return `Compare both annual debt service and projected total cost. ${scope}`;
}

/**
 * Whole-dollar display formatting. Both supported currencies (USD, CAD)
 * render with a plain `$` and comma grouping — the parameter exists so the
 * keying is explicit at every call site instead of silently assuming USD,
 * and so a future currency cannot ship half-formatted.
 */
export function formatCurrency(valueCents: number, currency: CurrencyCode = 'USD'): string {
  void currency;
  const centsValue = BigInt(valueCents);
  const sign = centsValue < 0n ? '−' : '';
  const roundedDollars = ((centsValue < 0n ? -centsValue : centsValue) + 50n) / 100n;
  return `${sign}$${roundedDollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Basis points as a percentage string. Exported because dividing by 100 is
 * arithmetic, and the UI does none. */
export function formatRate(bps: number): string {
  return `${new Decimal(bps).div(100).toFixed(2)}%`;
}

function monthsUntil(date: string, asOfDate: string): number {
  const target = new Date(`${date}T00:00:00.000Z`);
  const asOf = new Date(`${asOfDate}T00:00:00.000Z`);
  return (target.getUTCFullYear() - asOf.getUTCFullYear()) * 12
    + target.getUTCMonth()
    - asOf.getUTCMonth();
}

// ---------------------------------------------------------------------------
// QUICK PATH — spec.md 2.3
//
// Four fields off the dealer's paper plus a frequency toggle, and one number
// back: promo_price_rate, the annual cost of giving up the cash discount. No
// fees, no trade, no down payment, because the farmer has not been asked for
// them yet. Those absences are returned as printed assumptions, never as
// silent zeroes, and this path never earns a stamp.
//
// The rate is the IRR of the difference between the two cash flows: paying
// (quoted price - cash discount) today, against paying the quoted payment for
// the quoted number of periods. Annualized nominally at the payment frequency,
// which is the US convention and the engine default. A Canadian quote needs
// its compounding convention confirmed and therefore belongs on the verdict
// path, not here.
// ---------------------------------------------------------------------------

/** Widest annual rate the solver will report, in bps. Outside it, abstain. */
const PROMO_RATE_MIN_BPS = -5_000;
const PROMO_RATE_MAX_BPS = 30_000;

export const QUICK_PATH_ASSUMPTION =
  'Assumes no trade, no down payment, no fees. Confirm the full deal to get the verdict.';

export interface QuickPathQuote {
  quotedPriceCents: number;
  cashDiscountCents: number;
  paymentAmountCents: number;
  paymentCount: number;
  paymentFrequency: RegularFrequency;
}

export type PromoPriceRateUnavailableReason =
  | 'nonpositive_cash_price'
  | 'nonpositive_payment'
  | 'nonpositive_payment_count'
  | 'rate_outside_supported_range';

export interface PromoPriceRate {
  /** Null means we could not solve it. Null is an answer; a guess is not. */
  promoPriceRateBps: number | null;
  cashPriceCents: number;
  totalOfPaymentsCents: number;
  /** What financing costs over paying cash. Negative means financing is cheaper. */
  costVersusCashCents: number;
  assumptions: string[];
  unavailableReason: PromoPriceRateUnavailableReason | null;
}

/** Present value of a level annuity of `payment` for `periods` at periodic `rate`. */
function annuityPresentValue(payment: Decimal, rate: Decimal, periods: number): Decimal {
  if (rate.isZero()) return payment.mul(periods);
  return payment.mul(new Decimal(1).minus(new Decimal(1).plus(rate).pow(-periods))).div(rate);
}

export function promoPriceRate(quote: QuickPathQuote): PromoPriceRate {
  const cashPriceCents = quote.quotedPriceCents - quote.cashDiscountCents;
  const totalOfPaymentsCents = quote.paymentAmountCents * quote.paymentCount;
  const base = {
    cashPriceCents,
    totalOfPaymentsCents,
    costVersusCashCents: totalOfPaymentsCents - cashPriceCents,
    assumptions: [QUICK_PATH_ASSUMPTION],
  };

  if (quote.paymentCount <= 0) {
    return { ...base, promoPriceRateBps: null, unavailableReason: 'nonpositive_payment_count' };
  }
  if (quote.paymentAmountCents <= 0) {
    return { ...base, promoPriceRateBps: null, unavailableReason: 'nonpositive_payment' };
  }
  if (cashPriceCents <= 0) {
    return { ...base, promoPriceRateBps: null, unavailableReason: 'nonpositive_cash_price' };
  }

  const periods = quote.paymentCount;
  const payment = new Decimal(quote.paymentAmountCents);
  const target = new Decimal(cashPriceCents);
  const perYear = periodsPerYear[quote.paymentFrequency];
  const periodicAt = (annualBps: number) => new Decimal(annualBps).div(10_000).div(perYear);

  // Present value falls as the rate rises, so the bracket is monotonic and a
  // bisection is exact enough. If the answer is not inside the bracket the
  // quote is not something we can price, and we say so.
  const pvAtMin = annuityPresentValue(payment, periodicAt(PROMO_RATE_MIN_BPS), periods);
  const pvAtMax = annuityPresentValue(payment, periodicAt(PROMO_RATE_MAX_BPS), periods);
  if (target.greaterThan(pvAtMin) || target.lessThan(pvAtMax)) {
    return { ...base, promoPriceRateBps: null, unavailableReason: 'rate_outside_supported_range' };
  }

  let low = new Decimal(PROMO_RATE_MIN_BPS);
  let high = new Decimal(PROMO_RATE_MAX_BPS);
  for (let step = 0; step < 200; step += 1) {
    const middle = low.plus(high).div(2);
    if (annuityPresentValue(payment, periodicAt(middle.toNumber()), periods).greaterThan(target)) {
      low = middle;
    } else {
      high = middle;
    }
  }

  // Normalize negative zero. A payment stream that lands exactly on the cash
  // price converges from below, and "-0%" is not a rate anybody should read.
  const solvedBps = low.plus(high).div(2).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return {
    ...base,
    promoPriceRateBps: solvedBps === 0 ? 0 : solvedBps,
    unavailableReason: null,
  };
}

// ---------------------------------------------------------------------------
// VERDICT PATH — spec.md sections 2.1, 2.2, 3 and 4.
//
// A stamp is a judgment and this is where it is earned. Three separate things
// must all hold before one is issued: the ledger reconciles, every amount on
// it is confirmed, and a tier-1 published rate actually matches the deal. Any
// one of them missing is an abstention, which renders as plain words and no
// stamp. The database refuses an unearned verdict too; this is the other half.
// ---------------------------------------------------------------------------

export interface BenchmarkRow {
  id: string;
  source: string;
  sourceUrl: string;
  asOfDate: string;
  amountBand: string;
  amountMinCents: number;
  amountMaxCents: number | null;
  termBand: string;
  termMinMonths: number;
  termMaxMonths: number;
  rateBps: number;
  rateKind: 'fixed' | 'variable';
  tier: number;
}

export interface BenchmarkCriteria {
  amountCents: number;
  termMonths: number;
  rateKind: 'fixed' | 'variable';
}

/**
 * The matched published rate for a deal, or null.
 *
 * Only tier 1 may back a verdict (spec.md section 4): a survey average and a
 * posted equipment rate answer different questions, and mixing them is how the
 * receipt test dies. A fixed quote never matches a variable card rate.
 *
 * The term snaps to the nearest supported band, but only inside the card. Past
 * the end of it we abstain rather than stretch the top band over a longer
 * deal. On a tie the lower published rate wins, so a coin-flip can never be
 * the reason a deal got blessed.
 */
export function matchBenchmark(rows: BenchmarkRow[], criteria: BenchmarkCriteria): BenchmarkRow | null {
  const candidates = rows.filter((candidate) =>
    candidate.tier === 1
    && candidate.rateKind === criteria.rateKind
    && criteria.amountCents >= candidate.amountMinCents
    && (candidate.amountMaxCents === null || criteria.amountCents <= candidate.amountMaxCents));
  if (candidates.length === 0) return null;

  const shortest = Math.min(...candidates.map((candidate) => candidate.termMinMonths));
  const longest = Math.max(...candidates.map((candidate) => candidate.termMaxMonths));
  if (criteria.termMonths < shortest || criteria.termMonths > longest) return null;

  const distance = (candidate: BenchmarkRow) => {
    if (criteria.termMonths < candidate.termMinMonths) return candidate.termMinMonths - criteria.termMonths;
    if (criteria.termMonths > candidate.termMaxMonths) return criteria.termMonths - candidate.termMaxMonths;
    return 0;
  };
  return candidates.reduce((best, candidate) => {
    const difference = distance(candidate) - distance(best);
    if (difference < 0) return candidate;
    if (difference > 0) return best;
    return candidate.rateBps < best.rateBps ? candidate : best;
  });
}

/**
 * Dealer rounding we forgive on the payment. A fee small enough to hide inside
 * a dollar a payment is below this product's resolution, and saying so out
 * loud is better than implying a precision the arithmetic does not have.
 */
export const RECONCILE_TOLERANCE_CENTS = 100;

export interface LedgerReconciliation {
  reconciled: boolean;
  expectedPaymentCents: number;
  differenceCents: number;
}

/**
 * Does the quoted payment match what the quoted ledger and rate produce?
 *
 * When it does not, something is missing from the ledger: a trade, a down
 * payment, a tax, a fee, an add-on. We never name it a junk fee. We say the
 * numbers do not meet and ask the farmer to confirm what is missing.
 */
export function reconcileLedger(input: {
  amountFinancedCents: number;
  statedRateBps: number;
  paymentAmountCents: number;
  paymentCount: number;
  paymentFrequency: RegularFrequency;
}): LedgerReconciliation {
  const expectedPaymentCents = calculatePaymentCents(
    input.amountFinancedCents,
    input.statedRateBps,
    input.paymentFrequency,
    input.paymentCount,
  );
  const differenceCents = Math.abs(input.paymentAmountCents - expectedPaymentCents);
  return {
    expectedPaymentCents,
    differenceCents,
    reconciled: differenceCents <= RECONCILE_TOLERANCE_CENTS,
  };
}

/** One line of `fees_json` (spec.md section 2.1). */
export interface LedgerFee {
  name: string;
  amountCents: number;
  required: boolean;
  financeOnly: boolean;
  rolledIntoFinance: boolean;
  status: 'confirmed' | 'unknown';
}

export interface RealRateAllIn extends PromoPriceRate {
  realRateAllInBps: number | null;
  /** Mandatory finance-only money due at signing, priced into the rate. */
  upfrontFinanceOnlyFeesCents: number;
  hasUnknownFee: boolean;
}

/**
 * The headline number (spec.md section 2). Same difference-of-cash-flows as
 * the promo price rate, with every mandatory finance-only cost included.
 *
 * A fee charged either way is not the cost of financing and is excluded from
 * the rate; it belongs on the receipt as its own line. An optional add-on is
 * excluded by default and the farmer can toggle it in. A fee rolled into the
 * payments is already inside the payment stream, so it needs no adjustment
 * here and raises the rate on its own.
 *
 * Any unconfirmed amount abstains outright rather than pricing a guess.
 */
export function realRateAllIn(input: QuickPathQuote & { fees: LedgerFee[] }): RealRateAllIn {
  const promo = promoPriceRate(input);
  const hasUnknownFee = input.fees.some((fee) => fee.status === 'unknown');

  const upfrontFinanceOnlyFeesCents = input.fees
    .filter((fee) => fee.status === 'confirmed' && fee.required && fee.financeOnly && !fee.rolledIntoFinance)
    .reduce((total, fee) => total + fee.amountCents, 0);

  if (hasUnknownFee) {
    return {
      ...promo,
      realRateAllInBps: null,
      upfrontFinanceOnlyFeesCents,
      hasUnknownFee: true,
    };
  }

  // Paying a finance-only fee at signing leaves less of the cash price in the
  // farmer's pocket, so the same payment stream is being bought with less.
  const withFees = promoPriceRate({
    ...input,
    quotedPriceCents: input.quotedPriceCents - upfrontFinanceOnlyFeesCents,
  });

  return {
    ...promo,
    realRateAllInBps: withFees.promoPriceRateBps,
    upfrontFinanceOnlyFeesCents,
    hasUnknownFee: false,
  };
}

/** The buffer is policy, not discovered truth (spec.md section 3). Versioned. */
export const VERDICT_BUFFER_BPS = 100;
export const VERDICT_BUFFER_VERSION = 'v1 (2026-08-15)';

export type Verdict = 'checks_out' | 'look_closer' | 'none';
export type NoVerdictReason =
  | 'no_rate'
  | 'unreconciled_ledger'
  | 'unknown_fee'
  | 'no_matched_benchmark';

export interface VerdictResult {
  verdict: Verdict;
  bufferBps: number;
  bufferVersion: string;
  deltaBps: number | null;
  benchmark: BenchmarkRow | null;
  noVerdictReason: NoVerdictReason | null;
}

export function decideVerdict(input: {
  realRateAllInBps: number | null;
  reconciled: boolean;
  benchmark: BenchmarkRow | null;
  hasUnknownFee: boolean;
}): VerdictResult {
  const base = {
    bufferBps: VERDICT_BUFFER_BPS,
    bufferVersion: VERDICT_BUFFER_VERSION,
    benchmark: input.benchmark,
  };
  const abstain = (noVerdictReason: NoVerdictReason): VerdictResult => ({
    ...base, verdict: 'none', deltaBps: null, noVerdictReason,
  });

  if (input.realRateAllInBps === null) return abstain('no_rate');
  if (input.hasUnknownFee) return abstain('unknown_fee');
  if (!input.reconciled) return abstain('unreconciled_ledger');
  if (input.benchmark === null) return abstain('no_matched_benchmark');

  return {
    ...base,
    verdict: input.realRateAllInBps <= input.benchmark.rateBps + VERDICT_BUFFER_BPS
      ? 'checks_out'
      : 'look_closer',
    deltaBps: input.realRateAllInBps - input.benchmark.rateBps,
    noVerdictReason: null,
  };
}

export interface BenchmarkCostComparison {
  benchmarkPaymentCents: number;
  benchmarkTotalCents: number;
  dealTotalCents: number;
  /** What the deal costs over the published rate across the whole term. */
  differenceCents: number;
}

/**
 * The same money, the same term, at the published rate instead. This is the
 * dollar figure beside a LOOK CLOSER, and it is what makes the verdict
 * checkable rather than an opinion.
 */
export function costAgainstBenchmark(input: {
  amountFinancedCents: number;
  paymentAmountCents: number;
  paymentCount: number;
  paymentFrequency: RegularFrequency;
  benchmarkRateBps: number;
}): BenchmarkCostComparison {
  const benchmarkPaymentCents = calculatePaymentCents(
    input.amountFinancedCents,
    input.benchmarkRateBps,
    input.paymentFrequency,
    input.paymentCount,
  );
  const benchmarkTotalCents = benchmarkPaymentCents * input.paymentCount;
  const dealTotalCents = input.paymentAmountCents * input.paymentCount;
  return {
    benchmarkPaymentCents,
    benchmarkTotalCents,
    dealTotalCents,
    differenceCents: dealTotalCents - benchmarkTotalCents,
  };
}

// ---------------------------------------------------------------------------
// THE DEAL LEDGER — spec.md section 2.2
//
// The quick path asks for four fields and prints its assumptions. This is the
// other half: the whole deal, so the answer can carry a stamp. Everything the
// route needs to know about how the pieces combine is decided here, because
// the route does no arithmetic.
// ---------------------------------------------------------------------------

export interface DealLedger {
  /** The price you pay if you take the financing, before any cash discount. */
  quotedPriceCents: number;
  cashDiscountCents: number;
  downPaymentCents: number;
  tradeAllowanceCents: number;
  /** What is still owed on the trade. Larger than the allowance is negative equity. */
  tradePayoffCents: number;
  deliverySetupCents: number;
  /** Tax can differ between the two alternatives, so it is entered per alternative. */
  taxCashCents: number;
  taxFinanceCents: number;
  paymentAmountCents: number;
  paymentCount: number;
  paymentFrequency: RegularFrequency;
  statedRateBps: number;
  fees: LedgerFee[];
}

export interface LedgerTotals {
  /** Trade allowance less what is still owed on it. Can be negative. */
  netTradeCents: number;
  /** What paying cash today actually costs, all in. */
  cashOutlayCents: number;
  /** What gets financed if the deal is taken. */
  amountFinancedCents: number;
  /**
   * What you keep in your pocket at signing by financing instead of paying
   * cash. This is the t0 leg of the rate, and it is the cash outlay less
   * anything you hand over at signing anyway.
   */
  financedBenefitCents: number;
  rolledFinanceOnlyFeesCents: number;
  upfrontFinanceOnlyFeesCents: number;
  hasUnknownFee: boolean;
}

function feeTotal(fees: LedgerFee[], rolled: boolean): number {
  return fees
    .filter((fee) => fee.status === 'confirmed' && fee.required && fee.financeOnly && fee.rolledIntoFinance === rolled)
    .reduce((total, fee) => total + fee.amountCents, 0);
}

export function ledgerTotals(ledger: DealLedger): LedgerTotals {
  const netTradeCents = ledger.tradeAllowanceCents - ledger.tradePayoffCents;
  const rolledFinanceOnlyFeesCents = feeTotal(ledger.fees, true);
  const upfrontFinanceOnlyFeesCents = feeTotal(ledger.fees, false);

  // Paying cash forfeits the discount that financing would have cost you, so
  // the discount comes off here and nowhere else.
  const cashOutlayCents = ledger.quotedPriceCents
    - ledger.cashDiscountCents
    + ledger.deliverySetupCents
    + ledger.taxCashCents
    - netTradeCents;

  const amountFinancedCents = ledger.quotedPriceCents
    + ledger.deliverySetupCents
    + ledger.taxFinanceCents
    - netTradeCents
    - ledger.downPaymentCents
    + rolledFinanceOnlyFeesCents;

  return {
    netTradeCents,
    cashOutlayCents,
    amountFinancedCents,
    financedBenefitCents: cashOutlayCents - ledger.downPaymentCents - upfrontFinanceOnlyFeesCents,
    rolledFinanceOnlyFeesCents,
    upfrontFinanceOnlyFeesCents,
    hasUnknownFee: ledger.fees.some((fee) => fee.status === 'unknown'),
  };
}

export interface LedgerDecode {
  totals: LedgerTotals;
  reconciliation: LedgerReconciliation;
  realRateAllInBps: number | null;
  totalOfPaymentsCents: number;
  costVersusCashCents: number;
  unavailableReason: PromoPriceRateUnavailableReason | null;
}

/**
 * The whole verdict-path calculation, from a complete ledger to the headline
 * rate. It does not decide the verdict; that needs a matched benchmark and
 * lives in decideVerdict.
 */
export function decodeLedger(ledger: DealLedger): LedgerDecode {
  const totals = ledgerTotals(ledger);
  const reconciliation = reconcileLedger({
    amountFinancedCents: totals.amountFinancedCents,
    statedRateBps: ledger.statedRateBps,
    paymentAmountCents: ledger.paymentAmountCents,
    paymentCount: ledger.paymentCount,
    paymentFrequency: ledger.paymentFrequency,
  });

  // The rate is the IRR of what financing keeps in your pocket at signing
  // against what it takes back in payments.
  const rate = promoPriceRate({
    quotedPriceCents: totals.financedBenefitCents,
    cashDiscountCents: 0,
    paymentAmountCents: ledger.paymentAmountCents,
    paymentCount: ledger.paymentCount,
    paymentFrequency: ledger.paymentFrequency,
  });

  const totalOfPaymentsCents = ledger.paymentAmountCents * ledger.paymentCount;
  return {
    totals,
    reconciliation,
    realRateAllInBps: totals.hasUnknownFee ? null : rate.promoPriceRateBps,
    totalOfPaymentsCents,
    costVersusCashCents:
      totalOfPaymentsCents + ledger.downPaymentCents + totals.upfrontFinanceOnlyFeesCents - totals.cashOutlayCents,
    unavailableReason: rate.unavailableReason,
  };
}
