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
