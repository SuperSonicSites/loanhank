import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const NEWLINE = String.fromCharCode(10);
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

describe('the never-capture list is enforced by shape', () => {
  // spec.md 9.5. A model cannot return what there is nowhere to put. This test
  // reads the schema source, because the point is that the field does not
  // exist, and you cannot assert the absence of a field from a type.
  it('gives the extraction schema nowhere to store an identity', async () => {
    const source = await readFile(new URL('../src/shared/schema.ts', import.meta.url), 'utf8');
    const block = source.slice(
      source.indexOf('export const quoteExtractionSchema'),
      source.indexOf('export type QuoteExtraction'),
    );
    expect(block.length).toBeGreaterThan(0);
    for (const forbidden of [
      'dealer', 'dealership', 'salesperson', 'seller_name', 'customer',
      'serial', 'vin', 'stock_no', 'stock_number', 'account_number',
      'phone', 'email', 'address',
    ]) {
      expect(block.toLowerCase(), `quoteExtractionSchema has a field for ${forbidden}`)
        .not.toContain(forbidden);
    }
  });

  // spec.md 8.2. This covers the material of underwriting, which a lender may
  // one day ask us to gather on its behalf. The answer is the same as for the
  // dealer's paper: there is nowhere to put it, so it cannot be collected by
  // anybody's good intentions or anybody's deadline.
  it('has nowhere to store the material of underwriting, in any table', async () => {
    const sources = await Promise.all([
      readFile(new URL('../src/shared/schema.ts', import.meta.url), 'utf8'),
      readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'),
      readFile(new URL('../migrations/0002_fix_benchmark_amount_bands.sql', import.meta.url), 'utf8'),
      readFile(new URL('../migrations/0003_capture_the_paper.sql', import.meta.url), 'utf8'),
      readFile(new URL('../migrations/0004_expiry_reminder.sql', import.meta.url), 'utf8'),
    ]);
    // Column and field names only: the prose in a migration comment is allowed
    // to name what it is forbidding.
    const identifiers = sources
      .join(NEWLINE)
      .split(NEWLINE)
      .filter((line) => !line.trim().startsWith('--') && !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      // One deliberate exclusion. The ancestor's loan-document schema carries
      // `sensitive_identifiers_detected`, an enum of CATEGORY NAMES recording
      // that an identifier was seen and thrown away. It cannot hold an SSN; it
      // is the receipt proving one was discarded, which is the opposite of the
      // thing this test forbids. Nothing in the quote path uses it.
      .filter((line) => !line.includes('sensitive_identifiers_detected'))
      .join(NEWLINE)
      .toLowerCase();

    for (const forbidden of [
      'ssn', 'social_security', 'ein', 'tax_id', 'taxid', 'tin',
      'bank_statement', 'routing_number', 'account_number',
      'credit_application', 'tax_document', 'tax_return',
    ]) {
      // Whole identifiers, not substrings. A plain includes() flagged
      // Number.isSafeInteger for containing "ein", which is the sort of false
      // alarm that gets a good test deleted rather than fixed.
      const asIdentifier = new RegExp(`(?<![a-z0-9])${forbidden}(?![a-z0-9])`);
      expect(asIdentifier.test(identifiers), `something in the schema can hold ${forbidden}`).toBe(false);
    }
  });

  it('tells the model the same thing in words', async () => {
    const source = await readFile(new URL('../src/api/extractor.ts', import.meta.url), 'utf8');
    expect(source).toContain('Never return the dealership name');
    expect(source).toContain('The schema has no place for them.');
  });
});
