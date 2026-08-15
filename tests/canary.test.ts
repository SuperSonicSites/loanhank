import { describe, expect, it } from 'vitest';
import {
  decideVerdict,
  decodeLedger,
  matchBenchmark,
  type BenchmarkRow,
  type DealLedger,
} from '../src/finance/index.js';
import { seededBenchmarks } from './helpers/seeded-benchmarks.js';

// CANARIES — spec.md testing rules.
//
// Every abstention path in this product is safe by design: no match, no
// verdict; unreconciled, no verdict; unknown amount, no verdict. That safety
// is also a hiding place. Migration 0001 shipped every benchmark amount bound
// a thousand times too large, so no quote could fall inside any band and every
// deal on earth would have abstained. Nothing failed. It read as caution.
//
// So the positive path gets its own proof. These deals run against the REAL
// seeded benchmark table, not a convenient copy of it, and they must come back
// with a stamp. A canary that abstains fails the build.

const GOLDEN_CHECKS_OUT: DealLedger = {
  quotedPriceCents: 8_450_000,
  cashDiscountCents: 600_000,
  downPaymentCents: 0,
  tradeAllowanceCents: 0,
  tradePayoffCents: 0,
  deliverySetupCents: 0,
  taxCashCents: 0,
  taxFinanceCents: 0,
  paymentAmountCents: 140_833,
  paymentCount: 60,
  paymentFrequency: 'monthly',
  statedRateBps: 0,
  fees: [],
};

const GOLDEN_LOOK_CLOSER: DealLedger = {
  quotedPriceCents: 6_200_000,
  cashDiscountCents: 0,
  downPaymentCents: 0,
  tradeAllowanceCents: 0,
  tradePayoffCents: 0,
  deliverySetupCents: 0,
  taxCashCents: 0,
  taxFinanceCents: 0,
  paymentAmountCents: 156_950,
  paymentCount: 48,
  paymentFrequency: 'monthly',
  statedRateBps: 990,
  fees: [],
};

async function stampFor(ledger: DealLedger, termMonths: number) {
  const benchmarks = await seededBenchmarks();
  const decoded = decodeLedger(ledger);
  const benchmark = matchBenchmark(benchmarks, {
    amountCents: decoded.totals.amountFinancedCents,
    termMonths,
    rateKind: 'fixed',
    country: 'US',
  });
  const verdict = decideVerdict({
    realRateAllInBps: decoded.realRateAllInBps,
    reconciled: decoded.reconciliation.reconciled,
    benchmark,
    hasUnknownFee: decoded.totals.hasUnknownFee,
  });
  return { decoded, benchmark, verdict };
}

describe('canary: the positive path is reachable', () => {
  it('seeds a table a real quote can actually match', async () => {
    const benchmarks = await seededBenchmarks();
    expect(benchmarks.length).toBeGreaterThan(0);
    // The bug that started this rule: every bound a thousand times too large,
    // so nothing matched and nothing complained.
    const matched = matchBenchmark(benchmarks, {
      amountCents: 8_450_000,
      termMonths: 60,
      rateKind: 'fixed',
      country: 'US',
    });
    expect(matched, 'no seeded band contains an $84,500 quote').not.toBeNull();
  });

  it('produces a CHECKS OUT stamp from the shipped benchmark table', async () => {
    const { decoded, benchmark, verdict } = await stampFor(GOLDEN_CHECKS_OUT, 60);
    expect(decoded.reconciliation.reconciled).toBe(true);
    expect(decoded.realRateAllInBps).toBe(294);
    expect(benchmark, 'the canary found no reference and abstained').not.toBeNull();
    expect((benchmark as BenchmarkRow).rateBps).toBe(725);
    // The whole point. An abstention here is a failure, not caution.
    expect(verdict.verdict).toBe('checks_out');
    expect(verdict.noVerdictReason).toBeNull();
  });

  it('produces a LOOK CLOSER stamp from the shipped benchmark table', async () => {
    const { benchmark, verdict } = await stampFor(GOLDEN_LOOK_CLOSER, 48);
    expect(benchmark, 'the canary found no reference and abstained').not.toBeNull();
    expect(verdict.verdict).toBe('look_closer');
    expect(verdict.noVerdictReason).toBeNull();
  });

  it('reaches every amount band with a stamp, not just the one we look at', async () => {
    // A band can rot on its own. Each one gets a deal sized into it.
    const benchmarks = await seededBenchmarks();
    const bands = [...new Map(benchmarks
      .filter((row) => row.rateKind === 'fixed')
      .map((row) => [row.amountBand, row])).values()];
    expect(bands.length).toBe(4);

    for (const band of bands) {
      const inside = band.amountMinCents + 100_000;
      const matched = matchBenchmark(benchmarks, {
        amountCents: inside,
        termMonths: 60,
        rateKind: 'fixed',
        country: 'US',
      });
      expect(matched, `nothing matches inside ${band.amountBand}`).not.toBeNull();
      expect((matched as BenchmarkRow).amountBand).toBe(band.amountBand);
    }
  });

  it('still abstains where it should, so the canary is not just permissive', async () => {
    // The canary proves a stamp is reachable. It must not prove that
    // everything gets one.
    const { verdict } = await stampFor({ ...GOLDEN_CHECKS_OUT, paymentAmountCents: 175_000 }, 60);
    expect(verdict.verdict).toBe('none');
    expect(verdict.noVerdictReason).toBe('unreconciled_ledger');
  });
});
