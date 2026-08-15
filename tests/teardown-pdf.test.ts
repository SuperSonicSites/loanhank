import { describe, expect, it } from 'vitest';
import { renderTeardownPdf } from '../src/api/teardown-pdf.js';

describe('teardown PDF', () => {
  const base = {
    rate: '2.94%',
    rateLabel: 'Your real rate',
    verdictLine: "This deal checks out. We'd take it.",
    lines: [
      { label: 'Quoted price', amount: '$84,500' },
      { label: 'Cash discount', amount: '- $6,000' },
      { label: 'Cash price today', amount: '$78,500' },
      { label: 'Total of payments', amount: '$84,500' },
      { label: 'What financing costs', amount: '$6,000' },
    ],
    reference: 'Comparable published equipment rate: 7.25%, subject to approval.',
    assumption: null,
    missing: [],
    footnote: 'This is not the legal APR.',
    postalAddress: 'PO Box 1, Somewhere NE 68901',
    generatedOn: '2026-08-15',
  };

  it('renders a real PDF with a stamp', async () => {
    const bytes = await renderTeardownPdf({ ...base, verdict: 'checks_out' });
    // %PDF- magic, so this is a file a mail client will actually open.
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });

  it('renders the abstention without a stamp', async () => {
    const bytes = await renderTeardownPdf({
      ...base,
      verdict: 'none',
      verdictLine: 'We can show you the rate. We are not rating this deal yet.',
      missing: ['A trade-in, and whatever is still owed on it'],
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('carries no author metadata about the farmer', async () => {
    const bytes = await renderTeardownPdf({ ...base, verdict: 'look_closer' });
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain('/Author');
  });
});
