import { describe, expect, it } from 'vitest';
import { calculatePaymentCents, formatRate, promoPriceRate } from '../src/finance/index.js';

// The quick path (spec.md 2.3): four fields off the paper plus a frequency
// toggle, and the answer is promo_price_rate, the annual cost of giving up the
// cash discount. Expected values below were computed independently before the
// function existed, not read back out of it.

describe('promoPriceRate', () => {
  it('is zero when the payments add up to exactly the cash price', () => {
    const result = promoPriceRate({
      quotedPriceCents: 1_200_000,
      cashDiscountCents: 0,
      paymentAmountCents: 100_000,
      paymentCount: 12,
      paymentFrequency: 'monthly',
    });
    expect(result.promoPriceRateBps).toBe(0);
    expect(result.totalOfPaymentsCents).toBe(1_200_000);
    expect(result.costVersusCashCents).toBe(0);
  });

  it('recovers a rate the engine itself priced, monthly', () => {
    const payment = calculatePaymentCents(7_850_000, 700, 'monthly', 60);
    const result = promoPriceRate({
      quotedPriceCents: 7_850_000,
      cashDiscountCents: 0,
      paymentAmountCents: payment,
      paymentCount: 60,
      paymentFrequency: 'monthly',
    });
    expect(result.promoPriceRateBps).toBe(700);
  });

  it('recovers a rate the engine itself priced, annual, because ag pays annual', () => {
    const payment = calculatePaymentCents(10_000_000, 650, 'annual', 5);
    expect(payment).toBe(2_406_345);
    const result = promoPriceRate({
      quotedPriceCents: 10_000_000,
      cashDiscountCents: 0,
      paymentAmountCents: payment,
      paymentCount: 5,
      paymentFrequency: 'annual',
    });
    expect(result.promoPriceRateBps).toBe(650);
  });

  // Non-monthly pins for the definition of record (spec.md 2): nominal
  // annualization at the payment frequency. Payments hand-derived with the
  // annuity formula PMT = P*r/(1-(1+r)^-n) before running the engine:
  // r = 0.08/4 = 0.02, n = 12, P = $100,000 gives $9,455.96;
  // r = 0.06/2 = 0.03, n = 10, P = $50,000 gives $5,861.53.
  it('recovers a rate the engine itself priced, quarterly', () => {
    const payment = calculatePaymentCents(10_000_000, 800, 'quarterly', 12);
    expect(payment).toBe(945_596);
    const result = promoPriceRate({
      quotedPriceCents: 10_000_000,
      cashDiscountCents: 0,
      paymentAmountCents: payment,
      paymentCount: 12,
      paymentFrequency: 'quarterly',
    });
    expect(result.promoPriceRateBps).toBe(800);
  });

  it('recovers a rate the engine itself priced, semiannual', () => {
    const payment = calculatePaymentCents(5_000_000, 600, 'semiannual', 10);
    expect(payment).toBe(586_153);
    const result = promoPriceRate({
      quotedPriceCents: 5_000_000,
      cashDiscountCents: 0,
      paymentAmountCents: payment,
      paymentCount: 10,
      paymentFrequency: 'semiannual',
    });
    expect(result.promoPriceRateBps).toBe(600);
  });

  // Balloon deals (spec.md 2.2: balloon is a ledger field, not an exotic).
  // Payment hand-derived first with the balloon annuity formula
  // PMT = (P - B*(1+r)^-n) * r / (1-(1+r)^-n):
  // P = $78,500, B = $20,000, r = 0.07/12, n = 60 gives $1,275.04.
  it('recovers a rate the engine itself priced with a balloon, monthly', () => {
    const payment = calculatePaymentCents(7_850_000, 700, 'monthly', 60, 'nominal_payment_frequency', 2_000_000);
    expect(payment).toBe(127_504);
    const result = promoPriceRate({
      quotedPriceCents: 7_850_000,
      cashDiscountCents: 0,
      paymentAmountCents: payment,
      paymentCount: 60,
      paymentFrequency: 'monthly',
      balloonCents: 2_000_000,
    });
    expect(result.promoPriceRateBps).toBe(700);
  });

  it('prices a zero-rate balloon deal at exactly zero', () => {
    // 60 payments of $1,000 plus a $12,000 balloon total exactly the $72,000
    // cash price, so financing costs nothing and the rate is zero.
    const result = promoPriceRate({
      quotedPriceCents: 7_200_000,
      cashDiscountCents: 0,
      paymentAmountCents: 100_000,
      paymentCount: 60,
      paymentFrequency: 'monthly',
      balloonCents: 1_200_000,
    });
    expect(result.promoPriceRateBps).toBe(0);
    expect(result.costVersusCashCents).toBe(0);
  });

  it('prices the same payments higher when a balloon rides behind them', () => {
    const flat = promoPriceRate({
      quotedPriceCents: 7_850_000,
      cashDiscountCents: 0,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
    });
    const ballooned = promoPriceRate({
      quotedPriceCents: 7_850_000,
      cashDiscountCents: 0,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
      balloonCents: 2_000_000,
    });
    expect(ballooned.promoPriceRateBps).toBeGreaterThan(flat.promoPriceRateBps as number);
    expect(ballooned.costVersusCashCents).toBe(flat.costVersusCashCents + 2_000_000);
  });

  // The product in one case. An $84,500 quote with a $6,000 cash discount,
  // financed at the dealer's "0%" over 60 months on the full sticker.
  it('prices a 0% promo that is not 0%', () => {
    const result = promoPriceRate({
      quotedPriceCents: 8_450_000,
      cashDiscountCents: 600_000,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
    });
    expect(result.cashPriceCents).toBe(7_850_000);
    expect(result.promoPriceRateBps).toBe(294);
    expect(result.totalOfPaymentsCents).toBe(8_449_980);
    expect(result.costVersusCashCents).toBe(599_980);
    expect(result.unavailableReason).toBeNull();
  });

  it('prints the assumptions rather than defaulting them to a silent zero', () => {
    const result = promoPriceRate({
      quotedPriceCents: 8_450_000,
      cashDiscountCents: 600_000,
      paymentAmountCents: 140_833,
      paymentCount: 60,
      paymentFrequency: 'monthly',
    });
    expect(result.assumptions).toContain(
      'Assumes no trade, no down payment, no fees. Confirm the full deal to get the verdict.',
    );
  });

  it('abstains rather than guessing when no rate in range fits', () => {
    const result = promoPriceRate({
      quotedPriceCents: 10_000_000,
      cashDiscountCents: 0,
      paymentAmountCents: 1_000,
      paymentCount: 12,
      paymentFrequency: 'monthly',
    });
    expect(result.promoPriceRateBps).toBeNull();
    expect(result.unavailableReason).toBe('rate_outside_supported_range');
  });

  it('abstains on a nonpositive cash price instead of dividing by nothing', () => {
    const result = promoPriceRate({
      quotedPriceCents: 500_000,
      cashDiscountCents: 500_000,
      paymentAmountCents: 10_000,
      paymentCount: 12,
      paymentFrequency: 'monthly',
    });
    expect(result.promoPriceRateBps).toBeNull();
    expect(result.unavailableReason).toBe('nonpositive_cash_price');
  });

  it('abstains on a zero payment count', () => {
    const result = promoPriceRate({
      quotedPriceCents: 1_000_000,
      cashDiscountCents: 0,
      paymentAmountCents: 10_000,
      paymentCount: 0,
      paymentFrequency: 'monthly',
    });
    expect(result.promoPriceRateBps).toBeNull();
    expect(result.unavailableReason).toBe('nonpositive_payment_count');
  });

  // Longer amortization is never labeled savings (CLAUDE.md).
  //
  // The first version of this test compared 36 payments of $2,347.22 against
  // 60 of $1,408.33 and expected the longer deal to cost more. That premise
  // was wrong: both are the same $84,500 sticker at a true 0%, so both total
  // the sticker and the longer one came out twelve cents cheaper on rounding.
  // The property that actually holds, and the one the rule is about, is that
  // the same payment carried for more periods costs more in total and prices
  // as a higher rate. A smaller payment must never read as a cheaper deal.
  it('costs more, and prices higher, when the same payment runs longer', () => {
    const shorter = promoPriceRate({
      quotedPriceCents: 8_450_000,
      cashDiscountCents: 600_000,
      paymentAmountCents: 234_722,
      paymentCount: 36,
      paymentFrequency: 'monthly',
    });
    const longer = promoPriceRate({
      quotedPriceCents: 8_450_000,
      cashDiscountCents: 600_000,
      paymentAmountCents: 234_722,
      paymentCount: 60,
      paymentFrequency: 'monthly',
    });
    expect(longer.costVersusCashCents).toBeGreaterThan(shorter.costVersusCashCents);
    expect(longer.promoPriceRateBps).toBeGreaterThan(shorter.promoPriceRateBps as number);
  });
});

describe('formatRate', () => {
  it('prints basis points as a percentage so the page never divides', () => {
    expect(formatRate(294)).toBe('2.94%');
    expect(formatRate(0)).toBe('0.00%');
    expect(formatRate(750)).toBe('7.50%');
  });
});
