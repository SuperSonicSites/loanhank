import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PublicApiError } from '../../src/api/security.js';
import { buildLoanXRay, interestByCalendarYear, paymentCalendar } from '../../src/finance/index.js';
import type { SavedLoan } from '../../src/shared/schema.js';
import { applyResponsePolicy } from '../../standalone/src/http.js';
import { FOOTER_DISCLAIMER } from '../../standalone/src/chrome/data.js';
import { buildYearEndReportData, REPORT_EXCLUSION_REASONS } from '../../standalone/src/api/report-data.js';
import { renderYearEndReportPdf, winAnsiSafe } from '../../standalone/src/api/report-pdf.js';
import { handleReportRoute, type ReportLoanSource } from '../../standalone/src/api/report-routes.js';

/** Pinned clock: nothing in the report builder may read the wall clock. */
const AS_OF = '2026-08-14';
const GENERATED_AT = '2026-08-14T12:00:00.000Z';

type LoanOverrides =
  & Partial<Omit<SavedLoan, 'confirmedLoan'>>
  & { confirmedLoan?: Partial<SavedLoan['confirmedLoan']> };

function loan(overrides: LoanOverrides = {}): SavedLoan {
  const { confirmedLoan, xray, ...rest } = overrides;
  const confirmed: SavedLoan['confirmedLoan'] = {
    countryCode: 'US',
    currencyCode: 'USD',
    interestRateConvention: 'nominal_payment_frequency',
    principalBalanceCents: 26_500_000,
    annualInterestRateBps: 650,
    rateType: 'fixed',
    paymentFrequency: 'monthly',
    remainingPayments: 60,
    nextPaymentDate: '2026-09-01',
    interestOnly: false,
    loanType: 'term_loan',
    termsSource: 'document',
    ...confirmedLoan,
  };
  return {
    id: 'loan-base',
    nickname: 'Base note',
    countryCode: confirmed.countryCode ?? 'US',
    currencyCode: confirmed.currencyCode ?? 'USD',
    activeWatchCount: 0,
    savedAt: GENERATED_AT,
    updatedAt: GENERATED_AT,
    ...rest,
    confirmedLoan: confirmed,
    // Built from the same confirmed terms unless a case overrides it, so a
    // fixture can never drift from the schedule the engine would really write.
    xray: xray === undefined ? buildLoanXRay(confirmed, AS_OF) : xray,
  };
}

const usLoan = loan({
  id: 'loan-us',
  nickname: 'Equipment note',
});

const caLoan = loan({
  id: 'loan-ca',
  nickname: 'Quota loan',
  confirmedLoan: {
    countryCode: 'CA',
    currencyCode: 'CAD',
    interestRateConvention: 'nominal_semiannual',
    principalBalanceCents: 32_784_000,
    annualInterestRateBps: 785,
    paymentFrequency: 'annual',
    remainingPayments: 4,
    nextPaymentDate: undefined,
    maturityDate: '2030-03-01',
  },
});

/** Regular frequency and a confirmed date, but nothing that dates a schedule. */
const anchorlessLoan = loan({
  id: 'loan-anchorless',
  nickname: 'Operating note',
  confirmedLoan: { nextPaymentDate: undefined, maturityDate: undefined, remainingPayments: undefined },
});

/** A perfectly dateable loan whose stored analysis never reached FULL. */
const limitedLoan = loan({
  id: 'loan-limited',
  nickname: 'Storage line',
  xray: { asOfDate: AS_OF, current: { mode: 'LIMITED', provenance: 'ESTIMATED', assumptions: [] } },
});

/* ------------------------------------------------------------ PDF reading */

/**
 * The text a PDF actually draws.
 *
 * pdf-lib Flate-compresses the content streams it writes and encodes drawn
 * text as WinAnsi hex, so scanning the file for a literal sentence would pass
 * just as happily on a blank page. This inflates every stream and decodes the
 * hex operands, which is what makes "the disclaimer is on the page" a real
 * assertion rather than a coincidence of the metadata.
 *
 * Decoded as latin1, so the CP1252 0x80-0x9F block (curly quotes, en and em
 * dashes) comes back as control characters and a long line arrives split at
 * its wrap point. Assertions below therefore quote plain ASCII fragments that
 * fit on one line.
 */
function drawnText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const latin1 = raw.toString('latin1');
  const lines: string[] = [];
  for (const match of latin1.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end < 0) continue;
    let content: string;
    try {
      content = inflateSync(raw.subarray(start, end)).toString('latin1');
    } catch {
      continue;
    }
    for (const operand of content.matchAll(/<([0-9A-Fa-f]+)>/g)) {
      lines.push(Buffer.from(operand[1]!, 'hex').toString('latin1'));
    }
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ tests */

describe('year-end report data', () => {
  it('keeps USD and CAD in separate sections and never blends the totals', () => {
    const data = buildYearEndReportData([usLoan, caLoan], 2027, GENERATED_AT);

    // Code-unit order on the currency: CAD before USD, on every machine.
    expect(data.sections.map((section) => section.currencyCode)).toEqual(['CAD', 'USD']);
    expect(data.year).toBe(2027);
    expect(data.generatedAtIso).toBe(GENERATED_AT);
    expect(data.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);

    const [canada, unitedStates] = data.sections;
    expect(canada).toMatchObject({ countryCode: 'CA', currencyCode: 'CAD' });
    expect(unitedStates).toMatchObject({ countryCode: 'US', currencyCode: 'USD' });
    expect(canada!.rows.map((row) => row.nickname)).toEqual(['Quota loan']);
    expect(unitedStates!.rows.map((row) => row.nickname)).toEqual(['Equipment note']);

    // Each total is its own section's sum and nothing else's.
    expect(canada!.totalInterestCents).toBe(canada!.rows[0]!.interestInYearCents);
    expect(unitedStates!.totalInterestCents).toBe(unitedStates!.rows[0]!.interestInYearCents);
    expect(canada!.totalClosingBalanceCents).toBe(canada!.rows[0]!.closingBalanceCents);
    expect(canada!.totalInterestCents).not.toBe(unitedStates!.totalInterestCents);
  });

  it('carries the confirmed terms through untouched as the Known column', () => {
    const [section] = buildYearEndReportData([caLoan], 2027, GENERATED_AT).sections;
    expect(section!.rows[0]).toMatchObject({
      nickname: 'Quota loan',
      principalBalanceCents: 32_784_000,
      annualInterestRateBps: 785,
      paymentFrequency: 'annual',
      maturityDate: '2030-03-01',
    });
  });

  it('excludes an undateable loan with the reason, never as a zero', () => {
    const data = buildYearEndReportData([usLoan, anchorlessLoan], 2027, GENERATED_AT);
    const [section] = data.sections;

    expect(section!.rows.map((row) => row.nickname)).toEqual(['Equipment note']);
    expect(section!.excluded).toEqual([{
      nickname: 'Operating note',
      reason: 'No payment date on the confirmed terms — nothing anchors this schedule to a calendar. '
        + 'Confirm a next payment or maturity date to include it.',
    }]);
    expect(section!.excluded[0]!.reason).toBe(REPORT_EXCLUSION_REASONS.no_anchor);
    // The total is the included loan's figure — the excluded one adds no zero.
    expect(section!.totalInterestCents).toBe(section!.rows[0]!.interestInYearCents);
  });

  it('excludes a loan whose saved analysis has no full schedule', () => {
    const [section] = buildYearEndReportData([limitedLoan], 2027, GENERATED_AT).sections;

    expect(section!.rows).toEqual([]);
    expect(section!.excluded).toEqual([
      { nickname: 'Storage line', reason: 'The saved analysis has no full payment schedule.' },
    ]);
    expect(section!.excluded[0]!.reason).toBe(REPORT_EXCLUSION_REASONS.no_schedule);
    // A section that adds up to nothing still reports itself, with the reason.
    expect(section!.totalInterestCents).toBe(0);
    expect(section!.totalClosingBalanceCents).toBe(0);
  });

  it('matches the engine slice for a year that straddles the schedule start', () => {
    // Sixty monthly payments from September 2026: four land in 2026.
    const { entries } = paymentCalendar(usLoan.confirmedLoan, usLoan.xray, { asOfDate: '2026-08-01' });
    const expected = interestByCalendarYear(entries, usLoan.confirmedLoan.principalBalanceCents, 2026);
    expect(expected.paymentsInYear).toBe(4);

    const [section] = buildYearEndReportData([usLoan], 2026, GENERATED_AT).sections;
    expect(section!.rows[0]).toMatchObject({
      paymentsInYear: expected.paymentsInYear,
      interestInYearCents: expected.interestCents,
      closingBalanceCents: expected.closingBalanceCents,
    });
    // Not a repeat of the whole schedule: only the four dated 2026 payments.
    expect(section!.rows[0]!.interestInYearCents)
      .toBeLessThan(entries.reduce((total, entry) => total + entry.interestCents, 0));
  });

  it('reports an empty year without inventing rows', () => {
    expect(buildYearEndReportData([], 2027, GENERATED_AT).sections).toEqual([]);
  });
});

describe('year-end report PDF', () => {
  it('renders a readable PDF carrying the year, the labels, and the disclaimer', async () => {
    const data = buildYearEndReportData([usLoan, caLoan, anchorlessLoan, limitedLoan], 2027, GENERATED_AT);
    const bytes = await renderYearEndReportPdf(data);

    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');

    const drawn = drawnText(bytes);
    expect(drawn).toContain('2027');
    expect(drawn).toContain('Estimated');
    expect(drawn).toContain('Known');
    // The provenance sentence is load-bearing copy, not decoration.
    expect(drawn).toContain('not a record of payments made');
    expect(drawn).toContain(FOOTER_DISCLAIMER.slice(0, 40));
    expect(drawn).toContain('United States (USD)');
    expect(drawn).toContain('Canada (CAD)');
    expect(drawn).toContain('Total (USD)');
    expect(drawn).toContain('Total (CAD)');
    // Every page is stamped, and an excluded loan states why on the page.
    expect(drawn).toContain('Page 1 of 1');
    expect(drawn).toContain('No payment date on the confirmed terms');
    expect(drawn).toContain('The saved analysis has no full payment schedule.');

    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(reloaded.getTitle()).toBe('LoanHank year-end loan summary 2027');
  });

  it('spills onto further pages and repeats the column headings', async () => {
    const many = Array.from({ length: 26 }, (_, index) => loan({
      id: `loan-${index}`,
      nickname: `Field note ${index + 1}`,
    }));
    const bytes = await renderYearEndReportPdf(buildYearEndReportData(many, 2027, GENERATED_AT));
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThan(1);

    const drawn = drawnText(bytes);
    expect(drawn).toContain(`Page ${reloaded.getPageCount()} of ${reloaded.getPageCount()}`);
    // No page of figures is left without its column headings.
    expect(drawn.split('Loan').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('survives a nickname a standard font cannot encode', async () => {
    const hostile = loan({ id: 'loan-hostile', nickname: 'Barn −5 🚜 Léger Ферма' });
    const bytes = await renderYearEndReportPdf(buildYearEndReportData([hostile], 2027, GENERATED_AT));

    const drawn = drawnText(bytes);
    // The minus sign becomes a hyphen, the accented name survives intact, and
    // everything WinAnsi cannot hold degrades to a visible placeholder.
    expect(drawn).toContain('Barn -5 ? L');
    expect(drawn).toContain('Léger');
  });

  it('replaces exactly what WinAnsi cannot encode and nothing else', () => {
    // formatCurrency renders a negative with U+2212, which would throw raw.
    expect(winAnsiSafe('−$1,200')).toBe('-$1,200');
    expect(winAnsiSafe('Ferme Léger — note “A”')).toBe('Ferme Léger — note “A”');
    expect(winAnsiSafe('é')).toBe('é');
    expect(winAnsiSafe('🚜')).toBe('?');
    expect(winAnsiSafe('Ферма')).toBe('?????');
    expect(winAnsiSafe('a b­c\td')).toBe('a bc d');
  });

  it('admits only characters a standard font can actually draw', async () => {
    // Proves the allowlist against pdf-lib rather than against the CP1252 chart:
    // a character `winAnsiSafe` lets through and Helvetica then rejects would
    // throw at render time and lose the whole report.
    const every = [
      ...Array.from({ length: 0x7f - 0x20 }, (_, index) => 0x20 + index),
      // 0xAD, the soft hyphen, is deliberately dropped instead: it is invisible.
      ...Array.from({ length: 0x100 - 0xa1 }, (_, index) => 0xa1 + index).filter((code) => code !== 0x00ad),
      0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
      0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
      0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
    ].map((code) => String.fromCodePoint(code)).join('');
    // Nothing in that set is substituted or placeheld: it is all encodable.
    expect(winAnsiSafe(every).replace(/\s/g, '')).toBe(every.replace(/\s/g, ''));

    const nicknamed = loan({ id: 'loan-charset', nickname: every.slice(0, 80) });
    await expect(renderYearEndReportPdf(buildYearEndReportData([nicknamed], 2027, GENERATED_AT)))
      .resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('year-end report route', () => {
  const source = (loans: SavedLoan[]): ReportLoanSource => ({ listLoans: async () => loans });

  it('falls through on a suffix or method it does not own', async () => {
    expect(await handleReportRoute(source([]), 'loans', 'GET')).toBeNull();
    expect(await handleReportRoute(source([]), 'reports', 'GET')).toBeNull();
    expect(await handleReportRoute(source([]), 'reports/20xx', 'GET')).toBeNull();
    expect(await handleReportRoute(source([]), 'reports/2027/pdf', 'GET')).toBeNull();
    expect(await handleReportRoute(source([]), 'reports/2027', 'POST')).toBeNull();
    expect(await handleReportRoute(source([]), 'reports/2027', 'DELETE')).toBeNull();
  });

  it('refuses a year the report could not honestly cover', async () => {
    for (const year of [1999, 2019, new Date().getUTCFullYear() + 2]) {
      const attempt = handleReportRoute(source([]), `reports/${year}`, 'GET');
      await expect(attempt).rejects.toThrow(PublicApiError);
      await expect(attempt).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Choose a year the report can cover.',
      });
    }
  });

  it('returns the PDF as a named download', async () => {
    const response = await handleReportRoute(source([usLoan, caLoan]), 'reports/2027', 'GET');
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toBe('application/pdf');
    expect(response!.headers.get('content-disposition'))
      .toBe('attachment; filename="loanhank-year-end-2027.pdf"');

    const bytes = new Uint8Array(await response!.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(response!.headers.get('content-length')).toBe(String(bytes.byteLength));
  });

  it('keeps its download headers through the worker response policy', async () => {
    const response = await handleReportRoute(source([usLoan]), 'reports/2027', 'GET');
    // The worker wraps every account route this way; the download must survive.
    const wrapped = applyResponsePolicy(response!, 'private');

    expect(wrapped.headers.get('content-type')).toBe('application/pdf');
    expect(wrapped.headers.get('content-disposition'))
      .toBe('attachment; filename="loanhank-year-end-2027.pdf"');
    expect(wrapped.headers.get('content-length')).not.toBeNull();
    expect(wrapped.headers.get('cache-control')).toBe('private, no-store');
    expect(wrapped.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});
