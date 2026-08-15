import { describe, expect, it } from 'vitest';
import {
  COHORT_MIN_N,
  cohortLadder,
  quoteWithinSanityBounds,
  type CohortRow,
  type CohortSubject,
} from '../src/finance/index.js';

// spec.md 9. The peer ladder is the half of the product that comes alive as
// the pile grows. The stamp never does: it stays anchored to published cards.

const SUBJECT: CohortSubject = {
  country: 'US',
  currency: 'USD',
  quarter: '2026Q3',
  equipCategory: 'tractor',
  newOrUsed: 'used',
  termBand: '49-72',
  priceBand: '50k-100k',
};

const WINDOW = ['2026Q3', '2026Q2', '2026Q1', '2025Q4'];

function rows(count: number, overrides: Partial<CohortRow> = {}, startBps = 100): CohortRow[] {
  return Array.from({ length: count }, (_, index) => ({
    country: 'US' as const,
    currency: 'USD' as const,
    quarter: '2026Q3',
    equipCategory: 'tractor',
    newOrUsed: 'used',
    termBand: '49-72',
    priceBand: '50k-100k',
    realRateAllInBps: startBps + index * 100,
    ...overrides,
  }));
}

describe('cohortLadder', () => {
  it('says so plainly when nothing qualifies yet', () => {
    expect(cohortLadder(rows(19), SUBJECT, WINDOW)).toBeNull();
  });

  it('reports the finest cohort the moment it reaches twenty', () => {
    const result = cohortLadder(rows(20), SUBJECT, WINDOW);
    expect(result).not.toBeNull();
    expect(result?.n).toBe(20);
    expect(result?.droppedDimensions).toEqual([]);
    expect(result?.quartersIncluded).toEqual(['2026Q3']);
    // Rates 100..2000 bps. R-7 interpolation, the same definition Excel and
    // numpy use, so anybody can check our arithmetic against their own tool.
    expect(result?.medianBps).toBe(1050);
    expect(result?.p25Bps).toBe(575);
    expect(result?.p75Bps).toBe(1525);
  });

  it('drops the price band first', () => {
    const thin = rows(10);
    const others = rows(15, { priceBand: '100k-250k' }, 500);
    const result = cohortLadder([...thin, ...others], SUBJECT, WINDOW);
    expect(result?.droppedDimensions).toEqual(['priceBand']);
    expect(result?.n).toBe(25);
  });

  it('drops the term band second, never before the price band', () => {
    const thin = rows(5);
    const otherPrice = rows(5, { priceBand: '100k-250k' });
    const otherTerm = rows(15, { termBand: '0-48', priceBand: '100k-250k' });
    const result = cohortLadder([...thin, ...otherPrice, ...otherTerm], SUBJECT, WINDOW);
    expect(result?.droppedDimensions).toEqual(['priceBand', 'termBand']);
    expect(result?.n).toBe(25);
  });

  it('widens the window only after both bands are gone', () => {
    const thisQuarter = rows(9, { priceBand: '100k-250k', termBand: '0-48' });
    const lastQuarter = rows(12, { quarter: '2026Q2', priceBand: '100k-250k', termBand: '0-48' });
    const result = cohortLadder([...thisQuarter, ...lastQuarter], SUBJECT, WINDOW);
    expect(result?.droppedDimensions).toEqual(['priceBand', 'termBand']);
    expect(result?.quartersIncluded).toEqual(['2026Q3', '2026Q2']);
    expect(result?.n).toBe(21);
  });

  it('never pools a different category or condition, however thin the cohort', () => {
    const mine = rows(5);
    const combines = rows(40, { equipCategory: 'combine' });
    const newOnes = rows(40, { newOrUsed: 'new' });
    expect(cohortLadder([...mine, ...combines, ...newOnes], SUBJECT, WINDOW)).toBeNull();
  });

  it('never pools currencies, which is the whole reason currency is in the key', () => {
    const mine = rows(5);
    // Forty Canadian deals sitting right beside them must not rescue the
    // cohort. CAD and USD are different money and are never compared.
    const canadian = rows(40, { country: 'CA', currency: 'CAD' });
    expect(cohortLadder([...mine, ...canadian], SUBJECT, WINDOW)).toBeNull();
  });

  it('prints the cohort it actually used', () => {
    const result = cohortLadder(rows(20), SUBJECT, WINDOW);
    expect(result?.key).toBe('US|USD|tractor|used|49-72|50k-100k|2026Q3');
    expect(result?.label).toContain('used tractor');
    expect(result?.policyVersion).toBeTruthy();
  });

  it('holds the twenty floor as the published rule, not a tunable', () => {
    expect(COHORT_MIN_N).toBe(20);
  });
});

describe('quoteWithinSanityBounds', () => {
  it('accepts an ordinary deal', () => {
    expect(quoteWithinSanityBounds({
      quotedPriceCents: 8_450_000, termMonths: 60, paymentAmountCents: 140_833,
    }).outOfBounds).toBe(false);
  });

  it('flags a price nobody quotes', () => {
    expect(quoteWithinSanityBounds({
      quotedPriceCents: 50_000, termMonths: 60, paymentAmountCents: 1_000,
    }).reasons).toContain('price_out_of_range');
    expect(quoteWithinSanityBounds({
      quotedPriceCents: 900_000_000, termMonths: 60, paymentAmountCents: 140_833,
    }).reasons).toContain('price_out_of_range');
  });

  it('flags a term nobody writes', () => {
    expect(quoteWithinSanityBounds({
      quotedPriceCents: 8_450_000, termMonths: 240, paymentAmountCents: 140_833,
    }).reasons).toContain('term_out_of_range');
  });

  it('flags a nonpositive payment', () => {
    expect(quoteWithinSanityBounds({
      quotedPriceCents: 8_450_000, termMonths: 60, paymentAmountCents: 0,
    }).reasons).toContain('nonpositive_payment');
  });

  it('flags without refusing, because garbage is still evidence', () => {
    // Out of bounds means excluded from published statistics, not rejected.
    // A farmer who typed a wrong number still gets his arithmetic done.
    const result = quoteWithinSanityBounds({
      quotedPriceCents: 50_000, termMonths: 400, paymentAmountCents: -5,
    });
    expect(result.outOfBounds).toBe(true);
    expect(result.reasons).toHaveLength(3);
  });
});
