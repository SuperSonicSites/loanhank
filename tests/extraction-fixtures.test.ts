import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertUploadAllowed, PublicApiError } from '../src/api/security.js';

type EvalFixture = {
  name: string;
  format: string;
  text: string;
  expected: Record<string, unknown>;
  render_blur?: boolean;
  critical_fields_must_be_null?: boolean;
  must_flag_multiple_loans?: boolean;
  must_finish_within_timeout?: boolean;
  expected_rejection?: string;
};
const fixtures = JSON.parse(await readFile(new URL('./fixtures/synthetic-extraction-cases.json', import.meta.url), 'utf8')) as EvalFixture[];

describe('synthetic extraction eval manifest', () => {
  it('covers every required release-readiness case', () => {
    const names = fixtures.map((fixture) => fixture.name);
    expect(names).toEqual(expect.arrayContaining([
      'machine_generated_statement_pdf', 'amortization_schedule_png', 'payoff_quote_jpeg',
      'blurry_image', 'multiple_loans_alternative_wording', 'prompt_injection',
      'slow_model_guard', 'unsupported_gif',
    ]));
    expect(new Set(fixtures.map((fixture) => fixture.format))).toEqual(new Set([
      'application/pdf', 'image/png', 'image/jpeg', 'image/gif',
    ]));
  });

  it('contains only synthetic, bounded expectations', () => {
    for (const fixture of fixtures) {
      expect(fixture.text).toMatch(/SYNTHETIC ONLY/i);
      expect(fixture.text.length).toBeLessThan(1_000);
      expect(Object.keys(fixture.expected)).not.toContain('account_number');
    }
  });

  it('rejects the unsupported-format fixture before model extraction', () => {
    const unsupported = fixtures.find((fixture) => fixture.expected_rejection)!;
    expect(() => assertUploadAllowed(unsupported.format, 100)).toThrowError(PublicApiError);
    try {
      assertUploadAllowed(unsupported.format, 100);
    } catch (error) {
      expect(error).toMatchObject({ code: unsupported.expected_rejection, status: 415 });
    }
  });
});
