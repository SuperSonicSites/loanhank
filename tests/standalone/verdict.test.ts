import { describe, expect, it } from 'vitest';
import { verdictLight, type VerdictTone } from '../../standalone/src/app/verdict.js';
import { decisionHeadline, decisionSupport } from '../../standalone/src/app/format.js';
import { decisionStateSchema, type DecisionState } from '../../src/shared/schema.js';

/**
 * Restated here rather than imported, so the table itself is under test: if
 * someone re-tones a decision state in the module, this file has to agree.
 */
const EXPECTED_TONE: Record<DecisionState, VerdictTone> = {
  NO_SCENARIO_TESTED_YET: 'green',
  CURRENT_LOAN_REASONABLE: 'green',
  MATURITY_OR_BALLOON_SOON: 'amber',
  VARIABLE_RATE_EXPOSURE: 'amber',
  SAME_TERM_RATE_SAVINGS_POSSIBLE: 'amber',
  CASH_FLOW_AND_TOTAL_COST_IMPROVEMENT: 'amber',
  CASH_FLOW_RELIEF_WITH_HIGHER_LIFETIME_COST: 'amber',
  LIMITED_ANALYSIS_MISSING_INPUT: 'none',
  REVOLVING_LINE_LIMITED_ANALYSIS: 'none',
};

describe('verdict light', () => {
  it('covers every decision state the schema defines, and nothing else', () => {
    expect(Object.keys(EXPECTED_TONE).sort()).toEqual([...decisionStateSchema.options].sort());
    for (const state of decisionStateSchema.options) {
      expect(verdictLight(state).tone, state).toBe(EXPECTED_TONE[state]);
    }
  });

  it('has no red tone at all', () => {
    for (const state of decisionStateSchema.options) {
      expect(['green', 'amber', 'none'], state).toContain(verdictLight(state).tone);
    }
  });

  it('treats both neutral outcomes as first-class green', () => {
    expect(verdictLight('CURRENT_LOAN_REASONABLE').tone).toBe('green');
    expect(verdictLight('NO_SCENARIO_TESTED_YET').tone).toBe('green');
  });

  it('shows no verdict for a limited analysis', () => {
    expect(verdictLight('LIMITED_ANALYSIS_MISSING_INPUT').tone).toBe('none');
    expect(verdictLight('REVOLVING_LINE_LIMITED_ANALYSIS').tone).toBe('none');
  });

  it('puts schedule facts and tested tradeoffs on amber', () => {
    for (const state of [
      'MATURITY_OR_BALLOON_SOON',
      'VARIABLE_RATE_EXPOSURE',
      'SAME_TERM_RATE_SAVINGS_POSSIBLE',
      'CASH_FLOW_AND_TOTAL_COST_IMPROVEMENT',
      'CASH_FLOW_RELIEF_WITH_HIGHER_LIFETIME_COST',
    ] as const) {
      expect(verdictLight(state).tone, state).toBe('amber');
    }
  });

  it('invents no sentence of its own — every string comes from format.ts', () => {
    for (const state of decisionStateSchema.options) {
      const light = verdictLight(state);
      expect(light.label, state).toBe(decisionHeadline(state));
      expect(light.support, state).toBe(decisionSupport(state));
      expect(light.label.length, state).toBeGreaterThan(0);
      expect(light.support.length, state).toBeGreaterThan(0);
    }
  });
});
