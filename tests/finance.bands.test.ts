import { describe, expect, it } from 'vitest';
import { cohortBands } from '../src/finance/index.js';

// spec.md §9. A cohort key made of nulls matches nothing, so the ladder can
// never qualify and the peer row can never render. These are the two fields
// that were never populated, which is why it stayed silent.

describe('cohortBands', () => {
  it('bands the term the way spec names them', () => {
    expect(cohortBands({ amountFinancedCents: 5_000_000, termMonths: 36 }).termBand).toBe('0-48');
    expect(cohortBands({ amountFinancedCents: 5_000_000, termMonths: 48 }).termBand).toBe('0-48');
    expect(cohortBands({ amountFinancedCents: 5_000_000, termMonths: 60 }).termBand).toBe('49-72');
    expect(cohortBands({ amountFinancedCents: 5_000_000, termMonths: 72 }).termBand).toBe('49-72');
    expect(cohortBands({ amountFinancedCents: 5_000_000, termMonths: 84 }).termBand).toBe('73+');
  });

  it('bands the price on the same edges the rate card uses', () => {
    // Deliberately the AgDirect boundaries. A cohort that splits at $100,000
    // while the benchmark splits at $99,999 makes two answers about one deal.
    expect(cohortBands({ amountFinancedCents: 1_000_000, termMonths: 60 }).priceBand).toBe('under-25k');
    expect(cohortBands({ amountFinancedCents: 2_500_000, termMonths: 60 }).priceBand).toBe('25k-100k');
    expect(cohortBands({ amountFinancedCents: 9_999_900, termMonths: 60 }).priceBand).toBe('25k-100k');
    expect(cohortBands({ amountFinancedCents: 10_000_000, termMonths: 60 }).priceBand).toBe('100k-250k');
    expect(cohortBands({ amountFinancedCents: 25_000_000, termMonths: 60 }).priceBand).toBe('250k+');
  });

  it('is deterministic on a boundary, because a cohort key must not drift', () => {
    for (let index = 0; index < 5; index += 1) {
      expect(cohortBands({ amountFinancedCents: 2_500_000, termMonths: 48 }))
        .toEqual({ priceBand: '25k-100k', termBand: '0-48' });
    }
  });
});
