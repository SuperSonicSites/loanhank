import { describe, expect, it } from 'vitest';
import { calculatePaymentCents, decodeLedger, ledgerTotals, type DealLedger } from '../src/finance/index.js';

// spec.md 2.2. Expected values derived independently before the code existed.

const BASE: DealLedger = {
  quotedPriceCents: 9_200_000,
  cashDiscountCents: 400_000,
  downPaymentCents: 500_000,
  tradeAllowanceCents: 1_800_000,
  tradePayoffCents: 650_000,
  deliverySetupCents: 120_000,
  taxCashCents: 0,
  taxFinanceCents: 0,
  paymentAmountCents: 159_792,
  paymentCount: 48,
  paymentFrequency: 'monthly',
  statedRateBps: 0,
  fees: [],
};

describe('ledgerTotals', () => {
  it('nets the trade against what is still owed on it', () => {
    expect(ledgerTotals(BASE).netTradeCents).toBe(1_150_000);
  });

  it('carries negative equity the right way', () => {
    // Owing more than the trade is worth adds to the deal, it does not subtract.
    const upsideDown = ledgerTotals({ ...BASE, tradeAllowanceCents: 600_000, tradePayoffCents: 900_000 });
    expect(upsideDown.netTradeCents).toBe(-300_000);
    expect(upsideDown.amountFinancedCents).toBeGreaterThan(ledgerTotals(BASE).amountFinancedCents);
  });

  it('takes the discount off the cash side and only the cash side', () => {
    const totals = ledgerTotals(BASE);
    expect(totals.cashOutlayCents).toBe(7_770_000);
    expect(totals.amountFinancedCents).toBe(7_670_000);
    // The gap between them is exactly the discount you gave up by financing.
    expect(totals.amountFinancedCents - (totals.cashOutlayCents - BASE.downPaymentCents)).toBe(400_000);
  });

  it('leaves what financing keeps in your pocket at signing', () => {
    expect(ledgerTotals(BASE).financedBenefitCents).toBe(7_270_000);
  });

  it('taxes each alternative on its own terms', () => {
    // Some states tax the pre-discount price, so the two sides differ.
    const totals = ledgerTotals({ ...BASE, taxCashCents: 466_200, taxFinanceCents: 552_000 });
    expect(totals.cashOutlayCents).toBe(7_770_000 + 466_200);
    expect(totals.amountFinancedCents).toBe(7_670_000 + 552_000);
  });

  it('rolls a rolled fee into the financed amount and not into the pocket', () => {
    const rolled = ledgerTotals({
      ...BASE,
      fees: [{
        name: 'Doc fee', amountCents: 35_000, required: true,
        financeOnly: true, rolledIntoFinance: true, status: 'confirmed',
      }],
    });
    expect(rolled.amountFinancedCents).toBe(7_670_000 + 35_000);
    expect(rolled.financedBenefitCents).toBe(7_270_000);
  });

  it('takes an upfront fee out of the pocket and not out of the financed amount', () => {
    const upfront = ledgerTotals({
      ...BASE,
      fees: [{
        name: 'Doc fee', amountCents: 35_000, required: true,
        financeOnly: true, rolledIntoFinance: false, status: 'confirmed',
      }],
    });
    expect(upfront.amountFinancedCents).toBe(7_670_000);
    expect(upfront.financedBenefitCents).toBe(7_270_000 - 35_000);
  });
});

describe('decodeLedger', () => {
  it('prices a full ledger and reconciles it', () => {
    const decoded = decodeLedger(BASE);
    expect(decoded.totals.amountFinancedCents).toBe(7_670_000);
    // The dealer's 0% on the financed amount.
    expect(decoded.reconciliation.expectedPaymentCents)
      .toBe(calculatePaymentCents(7_670_000, 0, 'monthly', 48));
    expect(decoded.reconciliation.reconciled).toBe(true);
    expect(decoded.realRateAllInBps).toBe(265);
  });

  it('refuses a rate while an amount is unexplained', () => {
    const decoded = decodeLedger({
      ...BASE,
      fees: [{
        name: 'Unexplained amount', amountCents: 90_000, required: true,
        financeOnly: true, rolledIntoFinance: false, status: 'unknown',
      }],
    });
    expect(decoded.realRateAllInBps).toBeNull();
    expect(decoded.totals.hasUnknownFee).toBe(true);
  });

  it('fails to reconcile when the payment does not match the ledger', () => {
    const decoded = decodeLedger({ ...BASE, paymentAmountCents: 172_000 });
    expect(decoded.reconciliation.reconciled).toBe(false);
  });
});
