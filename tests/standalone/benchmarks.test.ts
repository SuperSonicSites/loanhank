import { describe, expect, it } from 'vitest';
import {
  benchmarkDelta,
  benchmarkKindLabel,
  deltaSentence,
  POSTED_RATE_NOTE,
  relevantBenchmarks,
  type LoanType,
} from '../../standalone/src/app/benchmarks.js';
import type { RateBenchmark } from '../../standalone/src/app/api.js';
import { KILLED_COPY_PATTERNS } from '../../standalone/src/copy-doctrine.js';
import { confirmedLoanSchema } from '../../src/shared/schema.js';

/**
 * Restated rather than imported, so the mapping itself is under test: the
 * module's own table is total over `LoanType`, and this one has to agree with
 * both it and the schema enum.
 */
const EXPECTED_CATEGORIES: Record<LoanType, ReadonlyArray<RateBenchmark['loanType']>> = {
  term_loan: ['equipment', 'any'],
  line_of_credit: ['operating', 'any'],
};

function benchmark(overrides: Partial<RateBenchmark> = {}): RateBenchmark {
  return {
    series: 'KC_FED_OPERATING_FIXED',
    label: 'Farm operating loans, fixed — Tenth District average',
    loanType: 'operating',
    countryCode: 'US',
    region: 'Tenth Federal Reserve District',
    kind: 'official_survey',
    valueBps: 751,
    asOf: '2026-06-30',
    asOfLabel: 'Q2 2026',
    sourceName: 'KC Fed Ag Credit Survey',
    sourceUrl: 'https://www.kansascityfed.org/agriculture/ag-credit-survey/',
    retrievedAt: '2026-08-14',
    ...overrides,
  };
}

const CATALOGUE: RateBenchmark[] = [
  benchmark({ series: 'EQUIPMENT', loanType: 'equipment', valueBps: 731 }),
  benchmark({ series: 'OPERATING', loanType: 'operating', valueBps: 751 }),
  benchmark({ series: 'REAL_ESTATE', loanType: 'real_estate', valueBps: 697 }),
  benchmark({ series: 'ANY', loanType: 'any', valueBps: 464, countryCode: 'CA' }),
];

describe('benchmark relevance', () => {
  it('maps every loan type the schema defines, and nothing else', () => {
    const schemaOptions = confirmedLoanSchema.shape.loanType.unwrap().options;
    expect(Object.keys(EXPECTED_CATEGORIES).sort()).toEqual([...schemaOptions].sort());
  });

  it('shows only the categories comparable to the loan in hand', () => {
    for (const loanType of Object.keys(EXPECTED_CATEGORIES) as LoanType[]) {
      const shown = relevantBenchmarks(CATALOGUE, loanType).map((item) => item.loanType);
      expect(shown.sort(), loanType).toEqual([...EXPECTED_CATEGORIES[loanType]].sort());
    }
  });

  it('pairs a revolving line with operating credit and a term note with equipment', () => {
    expect(relevantBenchmarks(CATALOGUE, 'line_of_credit').map((item) => item.series)).toEqual(['OPERATING', 'ANY']);
    expect(relevantBenchmarks(CATALOGUE, 'term_loan').map((item) => item.series)).toEqual(['EQUIPMENT', 'ANY']);
  });

  it('keeps the service order rather than ranking one source above another', () => {
    expect(relevantBenchmarks(CATALOGUE, 'term_loan').map((item) => item.series))
      .toEqual(CATALOGUE.filter((item) => item.loanType !== 'operating' && item.loanType !== 'real_estate')
        .map((item) => item.series));
  });

  it('drops a benchmark whose value could not be read instead of rendering a blank comparison', () => {
    const unread = [benchmark({ series: 'UNREAD', loanType: 'any', valueBps: null })];
    expect(relevantBenchmarks(unread, 'term_loan')).toEqual([]);
    expect(relevantBenchmarks([], 'term_loan')).toEqual([]);
  });
});

describe('benchmark delta', () => {
  it('measures the distance in integer basis points, with the sign in the direction', () => {
    expect(benchmarkDelta(807, 751)).toEqual({ direction: 'above', bps: 56 });
    expect(benchmarkDelta(695, 751)).toEqual({ direction: 'below', bps: 56 });
  });

  it('treats five basis points or less either way as in line', () => {
    expect(benchmarkDelta(756, 751)).toEqual({ direction: 'in_line', bps: 5 });
    expect(benchmarkDelta(746, 751)).toEqual({ direction: 'in_line', bps: 5 });
    expect(benchmarkDelta(751, 751)).toEqual({ direction: 'in_line', bps: 0 });
    // One basis point past the boundary is a difference again.
    expect(benchmarkDelta(757, 751)).toEqual({ direction: 'above', bps: 6 });
    expect(benchmarkDelta(745, 751)).toEqual({ direction: 'below', bps: 6 });
  });

  it('stays in integers — no binary float ever touches a rate', () => {
    for (const confirmed of [0, 1, 675, 731, 10_000]) {
      const delta = benchmarkDelta(confirmed, 751);
      expect(Number.isInteger(delta.bps), String(confirmed)).toBe(true);
    }
  });
});

describe('delta sentence', () => {
  it('states the difference as a fact about the reference and stops there', () => {
    expect(deltaSentence(benchmarkDelta(807, 751))).toBe('0.56% above this reference');
    expect(deltaSentence(benchmarkDelta(695, 751))).toBe('0.56% below this reference');
    expect(deltaSentence(benchmarkDelta(753, 751))).toBe('In line with this reference');
  });

  it('always shows two decimals so a column of deltas lines up', () => {
    expect(deltaSentence(benchmarkDelta(851, 751))).toBe('1.00% above this reference');
    expect(deltaSentence(benchmarkDelta(741, 751))).toBe('0.10% below this reference');
    expect(deltaSentence(benchmarkDelta(2_000, 675))).toBe('13.25% above this reference');
  });

  it('carries no verdict, no imperative, and no adjective', () => {
    for (const confirmed of [400, 700, 751, 756, 900]) {
      const sentence = deltaSentence(benchmarkDelta(confirmed, 751));
      expect(sentence).toMatch(/^(?:\d+\.\d{2}% (?:above|below) this reference|In line with this reference)$/);
    }
  });
});

describe('posted-rate note', () => {
  it('is the exact disclosure a sticker rate has to carry', () => {
    expect(POSTED_RATE_NOTE).toBe('A posted sticker rate, subject to credit approval — not an offer.');
  });

  it('names the two benchmark kinds without promoting either', () => {
    expect(benchmarkKindLabel('posted_rate')).toBe('Posted rate');
    expect(benchmarkKindLabel('official_survey')).toBe('Official survey');
  });
});

describe('copy doctrine', () => {
  /** Every string this module can put on screen, in one place to sweep. */
  const EVERY_EXPORTED_STRING = [
    POSTED_RATE_NOTE,
    benchmarkKindLabel('posted_rate'),
    benchmarkKindLabel('official_survey'),
    deltaSentence({ direction: 'above', bps: 56 }),
    deltaSentence({ direction: 'below', bps: 56 }),
    deltaSentence({ direction: 'in_line', bps: 0 }),
  ];

  it('never uses the banned copy', () => {
    for (const text of EVERY_EXPORTED_STRING) {
      for (const pattern of KILLED_COPY_PATTERNS) {
        expect(pattern.test(text), `"${text}" matched ${pattern}`).toBe(false);
      }
    }
  });

  it('never presents a reference as a rate the borrower receives or qualifies for', () => {
    const claims = [
      /you qualify/i,
      /\boverpay(?:ing|s|ment)?\b/i,
      /switch lenders?/i,
      /\bgood deal\b/i,
      /guaranteed savings/i,
      /refinance now/i,
      /\bact now\b/i,
      /\block in\b/i,
      /rates are (?:falling|dropping|rising|headed|expected)/i,
      /your rate should/i,
      /you (?:should|could) (?:get|receive|pay)/i,
    ];
    for (const text of EVERY_EXPORTED_STRING) {
      for (const pattern of claims) {
        expect(pattern.test(text), `"${text}" matched ${pattern}`).toBe(false);
      }
    }
  });
});
