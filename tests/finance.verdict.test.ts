import { describe, expect, it } from 'vitest';
import {
  VERDICT_BUFFER_BPS,
  costAgainstBenchmark,
  decideVerdict,
  matchBenchmark,
  realRateAllIn,
  reconcileLedger,
  type BenchmarkRow,
} from '../src/finance/index.js';

// spec.md sections 3 and 4, as engine code. Expected values here were derived
// independently before the functions existed.

function row(partial: Partial<BenchmarkRow> & { id: string }): BenchmarkRow {
  return {
    source: 'AgDirect',
    sourceUrl: 'https://www.agdirect.com/rates',
    asOfDate: '2026-08-01',
    amountBand: '$25,000-$99,999',
    amountMinCents: 2_500_000,
    amountMaxCents: 9_999_900,
    termBand: '5 years',
    termMinMonths: 60,
    termMaxMonths: 60,
    rateBps: 725,
    rateKind: 'fixed',
    tier: 1,
    ...partial,
  };
}

// The four fixed AgDirect bands a $25,000-$99,999 quote can land in.
const CARD: BenchmarkRow[] = [
  row({ id: 'a', termBand: '2-3 years', termMinMonths: 24, termMaxMonths: 36, rateBps: 725 }),
  row({ id: 'b', termBand: '4 years', termMinMonths: 48, termMaxMonths: 48, rateBps: 725 }),
  row({ id: 'c', termBand: '5 years', termMinMonths: 60, termMaxMonths: 60, rateBps: 725 }),
  row({ id: 'd', termBand: '6-7 years', termMinMonths: 72, termMaxMonths: 84, rateBps: 750 }),
];

describe('matchBenchmark', () => {
  it('matches the band the quote actually falls in', () => {
    const match = matchBenchmark(CARD, { amountCents: 7_850_000, termMonths: 60, rateKind: 'fixed' });
    expect(match?.id).toBe('c');
    expect(match?.rateBps).toBe(725);
  });

  it('will not match a fixed quote to a variable card rate', () => {
    const variable = CARD.map((entry) => ({ ...entry, rateKind: 'variable' as const, rateBps: 599 }));
    expect(matchBenchmark(variable, { amountCents: 7_850_000, termMonths: 60, rateKind: 'fixed' })).toBeNull();
  });

  it('refuses anything below tier 1, whatever else fits', () => {
    const surveys = CARD.map((entry) => ({ ...entry, tier: 2 }));
    expect(matchBenchmark(surveys, { amountCents: 7_850_000, termMonths: 60, rateKind: 'fixed' })).toBeNull();
  });

  it('refuses a quote outside every amount band', () => {
    // $2,000,000 is past the top of this card's bands.
    expect(matchBenchmark(CARD, { amountCents: 200_000_000, termMonths: 60, rateKind: 'fixed' })).toBeNull();
  });

  it('snaps to the nearest supported term inside the card', () => {
    // This first case originally used 54 months and expected the 5 year row.
    // That was wrong arithmetic on my part, not a wrong matcher: 54 is exactly
    // six months from both 48 and 60, so it is a tie, not a near miss. 56 is
    // genuinely nearer the 5 year row.
    expect(matchBenchmark(CARD, { amountCents: 7_850_000, termMonths: 56, rateKind: 'fixed' })?.id).toBe('c');
    // Distance is measured to the nearest edge of a band, not to its middle.
    // 40 months is four past the top of the 2-3 year row (24-36) and eight
    // short of the 4 year row, so it snaps back, not forward. 44 snaps
    // forward. I got both of these backwards first time by eyeballing them.
    expect(matchBenchmark(CARD, { amountCents: 7_850_000, termMonths: 40, rateKind: 'fixed' })?.id).toBe('a');
    expect(matchBenchmark(CARD, { amountCents: 7_850_000, termMonths: 44, rateKind: 'fixed' })?.id).toBe('b');
  });

  it('takes the shorter term when a tie cannot be broken on rate', () => {
    // 54 months is equidistant from the 4 year and 5 year rows and both are
    // published at 7.25%. The result still has to be the same every time.
    expect(matchBenchmark(CARD, { amountCents: 7_850_000, termMonths: 54, rateKind: 'fixed' })?.id).toBe('b');
  });

  it('never flatters the deal when two terms are equally near', () => {
    // 42 months is six months from both the 2-3 year and 4 year rows. When the
    // rates differ, the lower one wins, so a tie can never bless a deal that a
    // stricter reading would question.
    const uneven = CARD.map((entry) => (entry.id === 'b' ? { ...entry, rateBps: 900 } : entry));
    expect(matchBenchmark(uneven, { amountCents: 7_850_000, termMonths: 42, rateKind: 'fixed' })?.id).toBe('a');
  });

  it('abstains past the end of the card rather than stretching the top band', () => {
    // 96 months against a card that stops at 84. spec.md section 3: no matched
    // reference means rate yes, verdict no.
    expect(matchBenchmark(CARD, { amountCents: 7_850_000, termMonths: 96, rateKind: 'fixed' })).toBeNull();
  });
});

describe('reconcileLedger', () => {
  it('reconciles a 0% deal whose payments divide the financed amount', () => {
    const result = reconcileLedger({
      amountFinancedCents: 8_450_000,
      statedRateBps: 0,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
    });
    expect(result.expectedPaymentCents).toBe(140_833);
    expect(result.reconciled).toBe(true);
  });

  it('refuses to reconcile when a fee is hiding in the payment', () => {
    // The same deal with $1,500 of something extra rolled in raises the
    // payment by $25 a month, which is far past dealer rounding.
    const result = reconcileLedger({
      amountFinancedCents: 8_450_000,
      statedRateBps: 0,
      paymentAmountCents: 143_333,
      paymentCount: 60,
      paymentFrequency: 'monthly',
    });
    expect(result.reconciled).toBe(false);
    expect(result.differenceCents).toBe(2_500);
  });

  it('tolerates the dealer rounding the payment to the dollar', () => {
    const result = reconcileLedger({
      amountFinancedCents: 8_450_000,
      statedRateBps: 0,
      paymentAmountCents: 140_800,
      paymentCount: 60,
      paymentFrequency: 'monthly',
    });
    expect(result.reconciled).toBe(true);
  });
});

describe('realRateAllIn', () => {
  it('equals the promo price rate when there are no fees', () => {
    const result = realRateAllIn({
      quotedPriceCents: 8_450_000,
      cashDiscountCents: 600_000,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
      fees: [],
    });
    expect(result.realRateAllInBps).toBe(294);
  });

  it('prices an upfront finance-only fee into the rate', () => {
    const result = realRateAllIn({
      quotedPriceCents: 8_450_000,
      cashDiscountCents: 600_000,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
      fees: [{
        name: 'Doc fee', amountCents: 45_000, required: true,
        financeOnly: true, rolledIntoFinance: false, status: 'confirmed',
      }],
    });
    // Paying $450 at signing to take the financing leaves less of the cash
    // price in your pocket, so the same payment stream costs more.
    expect(result.realRateAllInBps).toBeGreaterThan(294);
  });

  it('ignores a fee charged either way, because it is not the cost of financing', () => {
    const result = realRateAllIn({
      quotedPriceCents: 8_450_000,
      cashDiscountCents: 600_000,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
      fees: [{
        name: 'Delivery', amountCents: 45_000, required: true,
        financeOnly: false, rolledIntoFinance: false, status: 'confirmed',
      }],
    });
    expect(result.realRateAllInBps).toBe(294);
  });

  it('ignores an optional add-on by default', () => {
    const result = realRateAllIn({
      quotedPriceCents: 8_450_000,
      cashDiscountCents: 600_000,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
      fees: [{
        name: 'Service plan', amountCents: 120_000, required: false,
        financeOnly: true, rolledIntoFinance: false, status: 'confirmed',
      }],
    });
    expect(result.realRateAllInBps).toBe(294);
  });

  it('abstains entirely on an unconfirmed amount', () => {
    const result = realRateAllIn({
      quotedPriceCents: 8_450_000,
      cashDiscountCents: 600_000,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
      fees: [{
        name: 'Unexplained amount', amountCents: 90_000, required: true,
        financeOnly: true, rolledIntoFinance: false, status: 'unknown',
      }],
    });
    expect(result.realRateAllInBps).toBeNull();
    expect(result.hasUnknownFee).toBe(true);
  });
});

describe('decideVerdict', () => {
  const benchmark = row({ id: 'c' });

  it('blesses a deal at or under the reference plus the buffer', () => {
    const result = decideVerdict({
      realRateAllInBps: 294, reconciled: true, benchmark, hasUnknownFee: false,
    });
    expect(result.verdict).toBe('checks_out');
    expect(result.deltaBps).toBe(294 - 725);
  });

  it('holds the buffer exactly at the edge', () => {
    expect(decideVerdict({
      realRateAllInBps: 725 + VERDICT_BUFFER_BPS, reconciled: true, benchmark, hasUnknownFee: false,
    }).verdict).toBe('checks_out');
    expect(decideVerdict({
      realRateAllInBps: 725 + VERDICT_BUFFER_BPS + 1, reconciled: true, benchmark, hasUnknownFee: false,
    }).verdict).toBe('look_closer');
  });

  it('questions a deal above the reference plus the buffer', () => {
    const result = decideVerdict({
      realRateAllInBps: 990, reconciled: true, benchmark, hasUnknownFee: false,
    });
    expect(result.verdict).toBe('look_closer');
    expect(result.deltaBps).toBe(265);
  });

  it('abstains on an unreconciled ledger however good the rate looks', () => {
    const result = decideVerdict({
      realRateAllInBps: 294, reconciled: false, benchmark, hasUnknownFee: false,
    });
    expect(result.verdict).toBe('none');
    expect(result.noVerdictReason).toBe('unreconciled_ledger');
  });

  it('abstains with no matched reference', () => {
    const result = decideVerdict({
      realRateAllInBps: 294, reconciled: true, benchmark: null, hasUnknownFee: false,
    });
    expect(result.verdict).toBe('none');
    expect(result.noVerdictReason).toBe('no_matched_benchmark');
  });

  it('abstains while any amount is unconfirmed', () => {
    const result = decideVerdict({
      realRateAllInBps: 294, reconciled: true, benchmark, hasUnknownFee: true,
    });
    expect(result.verdict).toBe('none');
    expect(result.noVerdictReason).toBe('unknown_fee');
  });

  it('abstains when there is no rate to judge', () => {
    const result = decideVerdict({
      realRateAllInBps: null, reconciled: true, benchmark, hasUnknownFee: false,
    });
    expect(result.verdict).toBe('none');
    expect(result.noVerdictReason).toBe('no_rate');
  });
});

describe('costAgainstBenchmark', () => {
  it('prices the difference over the term', () => {
    const result = costAgainstBenchmark({
      amountFinancedCents: 6_200_000,
      paymentAmountCents: 156_950,
      paymentCount: 48,
      paymentFrequency: 'monthly',
      benchmarkRateBps: 725,
    });
    expect(result.benchmarkPaymentCents).toBe(149_187);
    expect(result.dealTotalCents).toBe(7_533_600);
    expect(result.benchmarkTotalCents).toBe(7_160_976);
    expect(result.differenceCents).toBe(372_624);
  });
});
