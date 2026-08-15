import { describe, expect, it } from 'vitest';
import { deriveFindings, type Finding } from '../../standalone/src/app/findings.js';
import type { AlertRule, SavedLoan, SavedScenario } from '../../src/shared/schema.js';

/** Pinned clock: nothing in this module may read the wall clock. */
const NOW = '2026-08-14T12:00:00.000Z';
const YESTERDAY = '2026-08-14T02:00:00.000Z';
const LAST_YEAR = '2025-08-14T02:00:00.000Z';

type LoanOverrides =
  & Partial<Omit<SavedLoan, 'confirmedLoan'>>
  & { confirmedLoan?: Partial<SavedLoan['confirmedLoan']> };

function loan(overrides: LoanOverrides = {}): SavedLoan {
  const { confirmedLoan, ...rest } = overrides;
  return {
    id: 'loan-base',
    nickname: 'Base note',
    countryCode: 'US',
    currencyCode: 'USD',
    xray: null,
    activeWatchCount: 0,
    savedAt: LAST_YEAR,
    updatedAt: LAST_YEAR,
    ...rest,
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
      ...confirmedLoan,
    },
  };
}

type ScenarioOverrides =
  & Partial<Omit<SavedScenario, 'input'>>
  & { input?: Partial<SavedScenario['input']> };

function scenario(overrides: ScenarioOverrides = {}): SavedScenario {
  const { input, ...rest } = overrides;
  return {
    id: 'scenario-base',
    loanId: 'loan-base',
    name: 'Same term at a lower rate',
    createdAt: LAST_YEAR,
    // Signs as `compareScenario` writes them: current − candidate, so both
    // positive means the payment AND the projected interest come down.
    result: 'result' in overrides
      ? overrides.result
      : { annualCashflowChangeCents: 1_234_500, projectedInterestChangeCents: 987_600 },
    ...rest,
    input: {
      candidateAnnualRateBps: 685,
      remainingPeriods: 48,
      paymentFrequency: 'monthly',
      feesCents: 0,
      feeTreatment: 'cash',
      ...input,
    },
  };
}

function alert(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'alert-base',
    loanId: 'loan-base',
    kind: 'maturity',
    emailEnabled: true,
    pushEnabled: false,
    active: true,
    nextDueAt: null,
    lastNotifiedAt: null,
    createdAt: LAST_YEAR,
    updatedAt: LAST_YEAR,
    ...overrides,
  };
}

const kinds = (findings: readonly Finding[]) => findings.map((finding) => finding.kind);

describe('clipboard findings', () => {
  it('surfaces a saved scenario where both figures improve', () => {
    const findings = deriveFindings([loan({
      id: 'loan-a',
      nickname: 'North quarter note',
      latestScenario: scenario({ id: 'scenario-a', loanId: 'loan-a' }),
    })], [], NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      kind: 'saved_scenario_improvement',
      loanId: 'loan-a',
      title: 'A lower rate is worth testing on North quarter note',
      detail: 'Your saved 6.85% scenario frees $12,345 a year and cuts projected interest $9,876',
      provenance: 'SCENARIO',
      source: {
        kind: 'saved_scenario',
        scenarioId: 'scenario-a',
        scenarioName: 'Same term at a lower rate',
        candidateAnnualRateBps: 685,
        annualCashflowChangeCents: 1_234_500,
        projectedInterestChangeCents: 987_600,
      },
    });
    // Relief is never called savings.
    expect(findings[0]!.detail).not.toMatch(/savings/i);
  });

  it('says nothing about a scenario that buys relief with more lifetime interest', () => {
    const tradeoff = deriveFindings([loan({
      id: 'loan-a',
      latestScenario: scenario({
        loanId: 'loan-a',
        result: { annualCashflowChangeCents: 1_234_500, projectedInterestChangeCents: -4_000_000 },
      }),
    })], [], NOW);
    expect(tradeoff).toEqual([]);

    const dearer = deriveFindings([loan({
      id: 'loan-a',
      latestScenario: scenario({
        loanId: 'loan-a',
        result: { annualCashflowChangeCents: -100, projectedInterestChangeCents: 987_600 },
      }),
    })], [], NOW);
    expect(dearer).toEqual([]);
  });

  it('names the earliest unwatched maturity, and only when no watch covers it', () => {
    const loans = [
      loan({ id: 'loan-late', nickname: 'Bin site note', confirmedLoan: { maturityDate: '2029-04-01' } }),
      loan({ id: 'loan-early', nickname: 'Pasture note', confirmedLoan: { maturityDate: '2027-03-01' } }),
      loan({ id: 'loan-past', nickname: 'Retired note', confirmedLoan: { maturityDate: '2020-01-01' } }),
    ];

    const unwatched = deriveFindings(loans, [], NOW);
    expect(unwatched).toHaveLength(1);
    expect(unwatched[0]).toEqual({
      kind: 'maturity_unwatched',
      loanId: 'loan-early',
      title: 'Pasture note matures Mar 2027 — no alert set',
      detail: 'The earliest financing event on the clipboard',
      provenance: 'KNOWN',
      source: { kind: 'maturity', maturityDate: '2027-03-01' },
    });

    // An active maturity watch on the earliest loan hands the row to the next one.
    const watched = deriveFindings(loans, [alert({ loanId: 'loan-early' })], NOW);
    expect(watched.map((finding) => finding.loanId)).toEqual(['loan-late']);

    // A watch of another kind, an inactive one, or one on another loan do not count.
    for (const rule of [
      alert({ loanId: 'loan-early', kind: 'annual_recheck' }),
      alert({ loanId: 'loan-early', active: false }),
      alert({ loanId: 'loan-late' }),
    ]) {
      expect(deriveFindings(loans, [rule], NOW).map((finding) => finding.loanId)).toEqual(['loan-early']);
    }

    // Every maturity watched: no row at all.
    expect(deriveFindings(loans, [alert({ loanId: 'loan-early' }), alert({ id: 'alert-2', loanId: 'loan-late' })], NOW))
      .toEqual([]);
  });

  it('counts the as-of day itself as still ahead', () => {
    const today = deriveFindings([loan({ id: 'loan-a', nickname: 'Today note', confirmedLoan: { maturityDate: '2026-08-14' } })], [], NOW);
    expect(today.map((finding) => finding.title)).toEqual(['Today note matures Aug 2026 — no alert set']);

    const yesterday = deriveFindings([loan({ id: 'loan-a', confirmedLoan: { maturityDate: '2026-08-13' } })], [], NOW);
    expect(yesterday).toEqual([]);
  });

  it('phrases a fresh save on the verdict tone, not on wishful copy', () => {
    const green = deriveFindings([loan({
      id: 'loan-a',
      nickname: 'Equipment note',
      savedAt: YESTERDAY,
      xray: { decisionState: 'CURRENT_LOAN_REASONABLE' },
    })], [], NOW);
    expect(green[0]).toEqual({
      kind: 'freshly_saved',
      loanId: 'loan-a',
      title: 'Equipment note — no red flags',
      detail: 'Test a rate or term scenario any time',
      provenance: 'ESTIMATED',
      source: { kind: 'fresh_save', savedAt: YESTERDAY, decisionState: 'CURRENT_LOAN_REASONABLE' },
    });

    for (const decisionState of ['VARIABLE_RATE_EXPOSURE', 'LIMITED_ANALYSIS_MISSING_INPUT'] as const) {
      const neutral = deriveFindings([loan({
        id: 'loan-a',
        nickname: 'Equipment note',
        savedAt: YESTERDAY,
        xray: { decisionState },
      })], [], NOW);
      expect(neutral[0]?.title, decisionState).toBe('Equipment note — freshly X-Rayed');
      expect(neutral[0]?.provenance, decisionState).toBe('KNOWN');
      expect(neutral[0]?.source).toEqual({ kind: 'fresh_save', savedAt: YESTERDAY, decisionState });
    }

    // An unreadable X-Ray still earns the honest row, with no state claimed.
    const unreadable = deriveFindings([loan({ id: 'loan-a', nickname: 'Equipment note', savedAt: YESTERDAY, xray: 'nope' })], [], NOW);
    expect(unreadable[0]?.title).toBe('Equipment note — freshly X-Rayed');
    expect(unreadable[0]?.source).toEqual({ kind: 'fresh_save', savedAt: YESTERDAY, decisionState: null });

    // Older than a day: not a finding.
    expect(deriveFindings([loan({ id: 'loan-a', savedAt: '2026-08-13T11:59:00.000Z' })], [], NOW)).toEqual([]);
  });

  it('gives a loan at most one row, taken by the first rule that matches', () => {
    const findings = deriveFindings([loan({
      id: 'loan-a',
      nickname: 'North quarter note',
      savedAt: YESTERDAY,
      xray: { decisionState: 'CURRENT_LOAN_REASONABLE' },
      confirmedLoan: { maturityDate: '2027-03-01' },
      latestScenario: scenario({ loanId: 'loan-a' }),
    })], [], NOW);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('saved_scenario_improvement');
  });

  it('orders by rule, then by the size of the relief, then by nickname', () => {
    const loans = [
      loan({ id: 'loan-fresh', nickname: 'Zebra note', savedAt: YESTERDAY }),
      loan({ id: 'loan-small', nickname: 'Alpha note', latestScenario: scenario({ loanId: 'loan-small', result: { annualCashflowChangeCents: 100_000, projectedInterestChangeCents: 1 } }) }),
      loan({ id: 'loan-big', nickname: 'Yankee note', latestScenario: scenario({ loanId: 'loan-big', result: { annualCashflowChangeCents: 900_000, projectedInterestChangeCents: 1 } }) }),
      loan({ id: 'loan-maturity', nickname: 'Bravo note', confirmedLoan: { maturityDate: '2028-05-01' } }),
    ];

    const findings = deriveFindings(loans, [], NOW);
    expect(findings.map((finding) => finding.loanId)).toEqual(['loan-big', 'loan-small', 'loan-maturity', 'loan-fresh']);
    expect(kinds(findings)).toEqual([
      'saved_scenario_improvement',
      'saved_scenario_improvement',
      'maturity_unwatched',
      'freshly_saved',
    ]);

    // Same relief: nickname decides, and the input order does not.
    const tied = [
      loan({ id: 'loan-y', nickname: 'Yankee note', latestScenario: scenario({ loanId: 'loan-y' }) }),
      loan({ id: 'loan-a', nickname: 'Alpha note', latestScenario: scenario({ loanId: 'loan-a' }) }),
    ];
    expect(deriveFindings(tied, [], NOW).map((finding) => finding.loanId)).toEqual(['loan-a', 'loan-y']);
    expect(deriveFindings([...tied].reverse(), [], NOW)).toEqual(deriveFindings(tied, [], NOW));

    // Fresh saves sort by nickname too.
    const freshOnly = [
      loan({ id: 'loan-2', nickname: 'Second note', savedAt: YESTERDAY }),
      loan({ id: 'loan-1', nickname: 'First note', savedAt: YESTERDAY }),
    ];
    expect(deriveFindings(freshOnly, [], NOW).map((finding) => finding.loanId)).toEqual(['loan-1', 'loan-2']);
  });

  it('never returns more than four rows', () => {
    const loans = Array.from({ length: 6 }, (_, index) => loan({
      id: `loan-${index}`,
      nickname: `Note ${index}`,
      savedAt: YESTERDAY,
    }));
    const findings = deriveFindings(loans, [], NOW);
    expect(findings).toHaveLength(4);
    expect(findings.map((finding) => finding.loanId)).toEqual(['loan-0', 'loan-1', 'loan-2', 'loan-3']);
  });

  it('skips malformed stored payloads without throwing or emitting a NaN', () => {
    const malformed: SavedLoan[] = [
      loan({ id: 'loan-1', nickname: 'One', latestScenario: scenario({ loanId: 'loan-1', result: null }) }),
      loan({ id: 'loan-2', nickname: 'Two', latestScenario: scenario({ loanId: 'loan-2', result: 'nope' }) }),
      loan({ id: 'loan-3', nickname: 'Three', latestScenario: scenario({ loanId: 'loan-3', result: { annualCashflowChangeCents: '12', projectedInterestChangeCents: 9 } }) }),
      loan({ id: 'loan-4', nickname: 'Four', latestScenario: scenario({ loanId: 'loan-4', result: { annualCashflowChangeCents: Number.NaN, projectedInterestChangeCents: 9 } }) }),
      loan({
        id: 'loan-5',
        nickname: 'Five',
        latestScenario: { ...scenario({ loanId: 'loan-5' }), input: null } as unknown as SavedScenario,
      }),
      loan({ id: 'loan-6', nickname: 'Six', xray: 42, confirmedLoan: { maturityDate: 'not-a-date' } }),
      loan({ id: 'loan-7', nickname: 'Seven', savedAt: 'not-a-timestamp' }),
    ];

    expect(() => deriveFindings(malformed, [], NOW)).not.toThrow();
    expect(deriveFindings(malformed, [], NOW)).toEqual([]);
    expect(deriveFindings(malformed, [], 'not-a-clock')).toEqual([]);
    expect(deriveFindings([], [], NOW)).toEqual([]);
  });

  it('formats Canadian figures without borrowing a US default', () => {
    const findings = deriveFindings([loan({
      id: 'loan-ca',
      nickname: 'Prairie note',
      countryCode: 'CA',
      currencyCode: 'CAD',
      confirmedLoan: { countryCode: 'CA', currencyCode: 'CAD' },
      latestScenario: scenario({ loanId: 'loan-ca' }),
    })], [], NOW);
    expect(findings[0]?.detail).toBe('Your saved 6.85% scenario frees $12,345 a year and cuts projected interest $9,876');
  });
});
