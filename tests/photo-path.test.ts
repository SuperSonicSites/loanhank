import { describe, expect, it, vi } from 'vitest';
import { OpenAIQuoteExtractor } from '../src/api/extractor.js';
import { assertUploadAllowed, MAX_FILE_SIZE_BYTES, PublicApiError } from '../src/api/security.js';
import type { AppConfig } from '../src/api/env.js';

// The photo path's own guards.
//
// openai-privacy.test.ts covers store:false on the ANCESTOR's loan-document
// extractor, which no route in this product calls. The live photo path uses
// OpenAIQuoteExtractor, and until now nothing asserted that it sets store:false
// at all. A comment claimed the coverage; the coverage was for a different
// class.

const config: AppConfig = {
  OPENAI_API_KEY: 'test',
  OPENAI_DATA_CONTROLS_VERIFIED: false,
  EXTRACTION_TIMEOUT_MS: 75_000,
  PRIMARY_EXTRACTION_MODEL: 'test-primary',
  FALLBACK_EXTRACTION_MODEL: 'test-fallback',
  RAW_FILE_TTL_SECONDS: 3_600,
  TURNSTILE_SITE_KEY: '',
  TURNSTILE_SECRET_KEY: '',
  RATE_LIMIT_SALT: 'test-rate-limit-salt-1234',
};

function extraction() {
  const money = (value: number | null) => ({ value_cents: value, confidence: value === null ? 0 : 0.99 });
  const plain = <T>(value: T | null) => ({ value, confidence: value === null ? 0 : 0.99 });
  return {
    document_type: 'equipment_quote' as const,
    quoted_price: money(8_450_000),
    cash_discount: money(600_000),
    payment_amount: money(140_833),
    payment_frequency: plain<'monthly'>('monthly'),
    payment_count: plain(60),
    stated_rate_bps: plain(0),
    down_payment: money(0),
    trade_allowance: money(0),
    trade_payoff: money(null),
    balloon: money(null),
    delivery_setup: money(0),
    quote_date: plain('2026-08-11'),
    quote_expiry_date: plain('2026-08-31'),
    brand: plain('John Deere'),
    model_year: plain(2021),
    hours: plain(1_240),
    list_price: money(9_120_000),
    new_or_used: plain<'used'>('used'),
    warnings: [],
  };
}

describe('the live photo path never lets the provider retain a quote', () => {
  it('sets store:false on the quote extractor a farmer actually reaches', async () => {
    const calls: unknown[] = [];
    const client = {
      responses: {
        parse: vi.fn(async (body: unknown) => {
          calls.push(body);
          return { output_parsed: extraction() };
        }),
      },
    };
    await new OpenAIQuoteExtractor(config, client as never)
      .extractQuote([{ dataUrl: 'data:image/jpeg;base64,AAAA', contentType: 'image/jpeg' }]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'test-primary', store: false });
  });

  it('sends the photo and the instructions, and nothing else', async () => {
    let sent: Record<string, unknown> = {};
    const client = {
      responses: {
        parse: vi.fn(async (body: Record<string, unknown>) => {
          sent = body;
          return { output_parsed: extraction() };
        }),
      },
    };
    await new OpenAIQuoteExtractor(config, client as never)
      .extractQuote([{ dataUrl: 'data:image/jpeg;base64,AAAA', contentType: 'image/jpeg' }]);

    const serialized = JSON.stringify(sent);
    // The farmer's own identifiers cannot be in the request because nothing
    // upstream of here has any, but the instruction that forbids returning
    // them must be.
    expect(serialized).toContain('Never return the dealership name');
    expect(serialized).not.toContain('"store":true');
  });

  it('merges every page into ONE call, read as one paper', async () => {
    // Many photos, one decode. The reconciliation and multi-option laws apply
    // across the pages as one deal, so the pages must arrive together: one
    // call per image would hand the reader a paper it can never reconcile.
    const calls: Array<{ input: Array<{ content: Array<{ type: string }> }> }> = [];
    const client = {
      responses: {
        parse: vi.fn(async (body: never) => {
          calls.push(body);
          return { output_parsed: extraction() };
        }),
      },
    };
    await new OpenAIQuoteExtractor(config, client as never).extractQuote([
      { dataUrl: 'data:image/jpeg;base64,AAAA', contentType: 'image/jpeg' },
      { dataUrl: 'data:image/png;base64,BBBB', contentType: 'image/png' },
      { dataUrl: 'data:application/pdf;base64,CCCC', contentType: 'application/pdf' },
    ]);

    expect(calls).toHaveLength(1);
    const content = calls[0]?.input[0]?.content ?? [];
    expect(content.filter((part) => part.type === 'input_image')).toHaveLength(2);
    expect(content.filter((part) => part.type === 'input_file')).toHaveLength(1);
    // The instruction that binds the pages into one paper travels with them.
    expect(JSON.stringify(calls[0])).toContain('one paper');
  });
});

describe('the upload guard refuses what it should', () => {
  it('accepts an ordinary phone photo', () => {
    expect(() => assertUploadAllowed('image/jpeg', 2_000_000)).not.toThrow();
  });

  it('refuses a file over the size cap with 413', () => {
    // Each decode costs real model money, so the cap is a bill control as much
    // as a correctness one.
    try {
      assertUploadAllowed('image/jpeg', MAX_FILE_SIZE_BYTES + 1);
      throw new Error('the guard let an oversized upload through');
    } catch (error) {
      expect(error).toBeInstanceOf(PublicApiError);
      expect((error as PublicApiError).status).toBe(413);
    }
  });

  it('refuses an empty file rather than paying to read nothing', () => {
    try {
      assertUploadAllowed('image/jpeg', 0);
      throw new Error('the guard let a zero-byte upload through');
    } catch (error) {
      expect((error as PublicApiError).status).toBe(413);
    }
  });

  it('refuses a type the reader cannot open with 415', () => {
    try {
      assertUploadAllowed('application/zip', 1_000);
      throw new Error('the guard let a zip through');
    } catch (error) {
      expect((error as PublicApiError).status).toBe(415);
    }
  });
});
