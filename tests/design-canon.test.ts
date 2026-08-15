import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  calculatePaymentCents,
  costAgainstBenchmark,
  decideVerdict,
  formatCurrency,
  formatRate,
  matchBenchmark,
  realRateAllIn,
  reconcileLedger,
  type BenchmarkRow,
} from '../src/finance/index.js';
import { parseMoneyToCents } from '../src/shared/schema.js';

// design.md §2¾ prints two worked deals. Every figure in them is engine
// output, and this test is what makes that true rather than aspirational.
//
// It exists because the canonical amber verdict line was written by hand and
// was wrong for months: it printed the total of payments minus the quoted
// price and called it the cost against the cash price. Canon is copied into
// tickets, ads, emails and PDFs, so one hand-typed number becomes many.
//
// If this fails, the document is wrong or the engine changed. Fix whichever
// one actually moved; never edit the expectation to match a number you like.

const DESIGN_DOC = new URL('../docs/design.md', import.meta.url);

/** The AgDirect bands a $25,000-$99,999 quote can land in, per migration 0001. */
const CARD_ROW = {
  source: 'AgDirect',
  sourceUrl: 'https://www.agdirect.com/rates',
  asOfDate: '2026-08-01',
  amountBand: '$25,000-$99,999',
  amountMinCents: 2_500_000,
  amountMaxCents: 9_999_900,
  rateKind: 'fixed' as const,
  tier: 1,
  country: 'US' as const,
};
const CARD: BenchmarkRow[] = [
  { ...CARD_ROW, id: '2to3y', termBand: '2-3 years', termMinMonths: 24, termMaxMonths: 36, rateBps: 725 },
  { ...CARD_ROW, id: '4y', termBand: '4 years', termMinMonths: 48, termMaxMonths: 48, rateBps: 725 },
  { ...CARD_ROW, id: '5y', termBand: '5 years', termMinMonths: 60, termMaxMonths: 60, rateBps: 725 },
  { ...CARD_ROW, id: '6to7y', termBand: '6-7 years', termMinMonths: 72, termMaxMonths: 84, rateBps: 750 },
];

/** Pull the `- \`key\`: value` lines out of the canon block. */
async function canon(): Promise<Map<string, string>> {
  const text = await readFile(DESIGN_DOC, 'utf8');
  const start = text.indexOf('<!-- canon:start -->');
  const end = text.indexOf('<!-- canon:end -->');
  expect(start, 'design.md has no canon:start marker').toBeGreaterThan(-1);
  expect(end, 'design.md has no canon:end marker').toBeGreaterThan(start);

  const entries = new Map<string, string>();
  for (const match of text.slice(start, end).matchAll(/^- `([a-z0-9._]+)`:\s*(.+?)\s*$/gm)) {
    entries.set(match[1] as string, match[2] as string);
  }
  return entries;
}

function figure(entries: Map<string, string>, key: string): string {
  const value = entries.get(key);
  expect(value, `design.md canon block is missing \`${key}\``).toBeDefined();
  return value as string;
}

describe('design.md canonical example A, CHECKS OUT', () => {
  it('prints exactly what the engine computes', async () => {
    const entries = await canon();

    // Inputs are read back through the real parser, so a typo in the document
    // fails here rather than becoming a different deal than the one described.
    const quotedPriceCents = parseMoneyToCents(figure(entries, 'a.quoted_price'));
    const cashDiscountCents = parseMoneyToCents(figure(entries, 'a.cash_discount'));
    const paymentAmountCents = parseMoneyToCents(figure(entries, 'a.payment'));
    expect(quotedPriceCents).toBe(8_450_000);
    expect(cashDiscountCents).toBe(600_000);
    expect(paymentAmountCents).toBe(140_833);
    expect(figure(entries, 'a.payment_count')).toBe('60');
    expect(figure(entries, 'a.payment_frequency')).toBe('monthly');

    const rate = realRateAllIn({
      quotedPriceCents: quotedPriceCents as number,
      cashDiscountCents: cashDiscountCents as number,
      paymentAmountCents: paymentAmountCents as number,
      paymentCount: 60,
      paymentFrequency: 'monthly',
      fees: [],
    });
    const reconciliation = reconcileLedger({
      amountFinancedCents: quotedPriceCents as number,
      statedRateBps: 0,
      paymentAmountCents: paymentAmountCents as number,
      paymentCount: 60,
      paymentFrequency: 'monthly',
    });
    const benchmark = matchBenchmark(CARD, {
      amountCents: quotedPriceCents as number,
      termMonths: 60,
      rateKind: 'fixed',
      country: 'US',
    });
    const verdict = decideVerdict({
      realRateAllInBps: rate.realRateAllInBps,
      reconciled: reconciliation.reconciled,
      benchmark,
      hasUnknownFee: rate.hasUnknownFee,
    });

    expect(figure(entries, 'a.cash_price')).toBe(formatCurrency(rate.cashPriceCents));
    expect(figure(entries, 'a.total_of_payments')).toBe(formatCurrency(rate.totalOfPaymentsCents));
    expect(figure(entries, 'a.cost_versus_cash')).toBe(formatCurrency(rate.costVersusCashCents));
    expect(figure(entries, 'a.real_rate')).toBe(formatRate(rate.realRateAllInBps as number));
    expect(figure(entries, 'a.published_rate')).toBe(formatRate((benchmark as BenchmarkRow).rateBps));
    expect(figure(entries, 'a.published_band')).toBe((benchmark as BenchmarkRow).termBand);
    expect(figure(entries, 'a.published_source')).toBe((benchmark as BenchmarkRow).source);
    expect(figure(entries, 'a.published_as_of')).toBe((benchmark as BenchmarkRow).asOfDate);
    expect(figure(entries, 'a.published_amount_band')).toBe((benchmark as BenchmarkRow).amountBand);
    expect(figure(entries, 'a.verdict')).toBe('CHECKS OUT');
    expect(verdict.verdict).toBe('checks_out');

    // The reference line the product prints, assembled from the matched row.
    // The band bounds are part of it: the matching discipline has to be
    // checkable by the reader, not just correct in the matcher.
    const reference = `Comparable published equipment rate: ${formatRate((benchmark as BenchmarkRow).rateBps)}, `
      + `subject to approval. ${(benchmark as BenchmarkRow).source}, `
      + `${(benchmark as BenchmarkRow).amountBand}, ${(benchmark as BenchmarkRow).termBand}, fixed, `
      + `as of ${(benchmark as BenchmarkRow).asOfDate}.`;
    expect(figure(entries, 'a.reference')).toBe(reference);
  });

  it('still blesses the dealer, which is the whole point of keeping it', async () => {
    const entries = await canon();
    // If this example ever stops saying CHECKS OUT, the neutrality proof has
    // quietly left the document and somebody has to notice.
    expect(figure(entries, 'a.verdict')).toBe('CHECKS OUT');
    expect(figure(entries, 'a.line')).toBe("This deal checks out. We'd take it.");
  });

  it('matches the good-verdict microcopy in the table above it', async () => {
    const text = await readFile(DESIGN_DOC, 'utf8');
    const entries = await canon();
    expect(text).toContain(`| good verdict | \`${figure(entries, 'a.line')}\` |`);
  });
});

describe('design.md canonical example B, LOOK CLOSER', () => {
  it('prints exactly what the engine computes', async () => {
    const entries = await canon();

    const amountFinancedCents = parseMoneyToCents(figure(entries, 'b.amount_financed'));
    const paymentAmountCents = parseMoneyToCents(figure(entries, 'b.payment'));
    expect(amountFinancedCents).toBe(6_200_000);
    expect(figure(entries, 'b.payment_count')).toBe('48');
    expect(figure(entries, 'b.payment_frequency')).toBe('monthly');

    // The payment is what the stated rate actually produces, not a number
    // chosen to make the example come out.
    const statedRateBps = 990;
    expect(figure(entries, 'b.stated_rate')).toBe(formatRate(statedRateBps));
    expect(paymentAmountCents).toBe(
      calculatePaymentCents(amountFinancedCents as number, statedRateBps, 'monthly', 48),
    );

    const rate = realRateAllIn({
      quotedPriceCents: amountFinancedCents as number,
      cashDiscountCents: 0,
      paymentAmountCents: paymentAmountCents as number,
      paymentCount: 48,
      paymentFrequency: 'monthly',
      fees: [],
    });
    const reconciliation = reconcileLedger({
      amountFinancedCents: amountFinancedCents as number,
      statedRateBps,
      paymentAmountCents: paymentAmountCents as number,
      paymentCount: 48,
      paymentFrequency: 'monthly',
    });
    const benchmark = matchBenchmark(CARD, {
      amountCents: amountFinancedCents as number,
      termMonths: 48,
      rateKind: 'fixed',
      country: 'US',
    });
    const verdict = decideVerdict({
      realRateAllInBps: rate.realRateAllInBps,
      reconciled: reconciliation.reconciled,
      benchmark,
      hasUnknownFee: rate.hasUnknownFee,
    });
    const comparison = costAgainstBenchmark({
      amountFinancedCents: amountFinancedCents as number,
      paymentAmountCents: paymentAmountCents as number,
      paymentCount: 48,
      paymentFrequency: 'monthly',
      benchmarkRateBps: (benchmark as BenchmarkRow).rateBps,
    });

    expect(figure(entries, 'b.real_rate')).toBe(formatRate(rate.realRateAllInBps as number));
    expect(figure(entries, 'b.total_of_payments')).toBe(formatCurrency(comparison.dealTotalCents));
    expect(figure(entries, 'b.published_rate')).toBe(formatRate((benchmark as BenchmarkRow).rateBps));
    expect(figure(entries, 'b.published_band')).toBe((benchmark as BenchmarkRow).termBand);
    expect(figure(entries, 'b.published_total')).toBe(formatCurrency(comparison.benchmarkTotalCents));
    expect(figure(entries, 'b.difference')).toBe(formatCurrency(comparison.differenceCents));
    expect(figure(entries, 'b.published_amount_band')).toBe((benchmark as BenchmarkRow).amountBand);
    expect(figure(entries, 'b.verdict')).toBe('LOOK CLOSER');
    expect(verdict.verdict).toBe('look_closer');
  });

  it('fills the amber verdict template with its own figures', async () => {
    const entries = await canon();
    const expected = `Look closer. This deal prices at ${figure(entries, 'b.real_rate')}. `
      + `The comparable published rate is ${figure(entries, 'b.published_rate')}. `
      + `The difference costs you ${figure(entries, 'b.difference')} over the term.`;
    expect(figure(entries, 'b.line')).toBe(expected);
  });
});

describe('design.md', () => {
  it('no longer carries the arithmetic that started all this', async () => {
    const text = await readFile(DESIGN_DOC, 'utf8');
    // The old line claimed a $2,347 cost against the cash price. The figure is
    // still fine as a Kennedy specificity illustration in §2½, but it must
    // never reappear as a verdict figure.
    expect(text).not.toContain('The 0% costs you $2,347 more than the cash price');
    expect(text).not.toContain('Total of payments     $86,847');
  });
});

describe('the design bundle carries no arithmetic of its own', () => {
  // design/ is the visual system: tokens, type, colour, spacing, component
  // anatomy. It has no copy authority and no arithmetic authority.
  //
  // The first bundle shipped carrying figures canon had already retired, and
  // a reader of those cards would have reintroduced every one of them. So the
  // retired figures are named here and the build fails if any comes back.
  //
  // Two files are exempt because naming the figures is their job:
  // _sweep-from-canon.mjs has to name them in order to replace them, and
  // README.md has to name them to explain why this gate exists at all.
  const RETIRED = [
    '$2,347',      // cost against the quoted price, sold as the cost against cash
    '$86,847',     // total of payments from the same broken example
    '7.9%',        // the rate that went with them
    '6.5%',        // the $250,000+ band rate, quoted for an $84,500 deal
    '$75,000 to $100,000', // a band that is not on the AgDirect card
    'stop at 72 months',   // the card runs to 84
    'n=143',       // a peer count from a pile that does not exist
    '7.4%',        // the median that went with it
  ];

  it('contains none of the retired figures', async () => {
    const root = new URL('../design/', import.meta.url);
    const offenders: string[] = [];

    async function walk(directory: URL, prefix = ''): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = `${prefix}${entry.name}`;
        if (entry.name === '_sweep-from-canon.mjs' || entry.name === 'README.md') continue;
        if (entry.isDirectory()) {
          await walk(new URL(`${entry.name}/`, directory), `${name}/`);
          continue;
        }
        if (!/\.(html|css|md|json|js|mjs)$/.test(entry.name)) continue;
        const text = await readFile(new URL(entry.name, directory), 'utf8');
        for (const figure of RETIRED) {
          if (text.includes(figure)) offenders.push(`${name}: ${figure}`);
        }
      }
    }

    await walk(root);
    expect(offenders, `retired figures are back in the design bundle:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('keeps the worked cards agreeing with canon', async () => {
    const entries = await canon();
    const verdict = await readFile(new URL('../design/guidelines/Verdict.html', import.meta.url), 'utf8');
    const receipt = await readFile(new URL('../design/guidelines/Receipt.html', import.meta.url), 'utf8');

    expect(verdict).toContain(figure(entries, 'a.line'));
    expect(verdict).toContain(figure(entries, 'b.line'));
    expect(receipt).toContain(figure(entries, 'a.real_rate'));
    expect(receipt).toContain(figure(entries, 'a.cash_price'));
    expect(receipt).toContain(figure(entries, 'a.published_amount_band'));
  });

  it('does not keep a second copy of design.md', async () => {
    // A stale duplicate of the law is worse than no copy: somebody reads the
    // wrong one and is not wrong to have trusted it.
    const names: string[] = [];
    async function walk(directory: URL, prefix = ''): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          await walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
        } else if (entry.name === 'design.md') {
          names.push(`${prefix}${entry.name}`);
        }
      }
    }
    await walk(new URL('../design/', import.meta.url));
    expect(names).toEqual([]);
  });
});
