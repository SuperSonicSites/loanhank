import { describe, expect, it } from 'vitest';
import { parseMoneyToCents, quickPathFormSchema } from '../src/shared/schema.js';

describe('parseMoneyToCents', () => {
  it('reads the shapes a farmer actually types', () => {
    expect(parseMoneyToCents('84500')).toBe(8_450_000);
    expect(parseMoneyToCents('84,500')).toBe(8_450_000);
    expect(parseMoneyToCents('$84,500')).toBe(8_450_000);
    expect(parseMoneyToCents('84500.00')).toBe(8_450_000);
    expect(parseMoneyToCents(' 84,500.50 ')).toBe(8_450_050);
    expect(parseMoneyToCents('0.05')).toBe(5);
  });

  it('pads a single decimal place rather than reading it as cents', () => {
    // "1408.3" is $1,408.30, not $1,408.03. Getting this backwards is a
    // twenty-seven cent error per payment and a wrong rate.
    expect(parseMoneyToCents('1408.3')).toBe(140_830);
  });

  it('refuses anything it cannot read exactly', () => {
    for (const bad of ['', 'about 84500', '84.500,00', '84500.123', '-500', '8e4', '1,00,0']) {
      expect(parseMoneyToCents(bad)).toBeNull();
    }
  });
});

describe('quickPathFormSchema', () => {
  it('accepts a filled form and hands back cents', () => {
    const parsed = quickPathFormSchema.parse({
      quotedPrice: '84,500',
      cashDiscount: '6,000',
      paymentCount: '60',
      payment: '1408.33',
      paymentFrequency: 'monthly',
    });
    expect(parsed).toEqual({
      quotedPrice: 8_450_000,
      cashDiscount: 600_000,
      paymentCount: 60,
      payment: 140_833,
      paymentFrequency: 'monthly',
    });
  });

  it('treats an empty cash discount as none offered', () => {
    const parsed = quickPathFormSchema.parse({
      quotedPrice: '84500', cashDiscount: '', paymentCount: '60',
      payment: '1408.33', paymentFrequency: 'monthly',
    });
    expect(parsed.cashDiscount).toBe(0);
  });

  it('rejects a blank price instead of treating it as zero', () => {
    const result = quickPathFormSchema.safeParse({
      quotedPrice: '', cashDiscount: '', paymentCount: '60',
      payment: '1408.33', paymentFrequency: 'monthly',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payment frequency it does not support', () => {
    const result = quickPathFormSchema.safeParse({
      quotedPrice: '84500', cashDiscount: '', paymentCount: '60',
      payment: '1408.33', paymentFrequency: 'weekly',
    });
    expect(result.success).toBe(false);
  });
});
