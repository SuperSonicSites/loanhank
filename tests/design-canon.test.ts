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
import { renderForm } from '../src/web/page.js';
import { renderManifest } from '../src/web/pages.js';

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

/**
 * A row from the design.md §2 canonical microcopy table, by moment label.
 *
 * The words live between the first pair of backticks; anything after them in
 * the cell is a law note, not copy. Split rather than regex: the cell is
 * delimited by pipes and backticks, and building that pattern inside a
 * template literal is how the first version of this helper silently matched
 * nothing.
 */
async function canonMicrocopy(label: string): Promise<string> {
  const design = await readFile(DESIGN_DOC, 'utf8');
  const line = design.split(String.fromCharCode(10))
    .find((row) => row.startsWith(`| ${label} |`));
  expect(line, `design.md has no canon row for "${label}"`).toBeDefined();
  const cell = (line as string).split('|')[2] ?? '';
  const words = /`([^`]*)`/.exec(cell);
  expect(words, `the canon row for "${label}" carries no backticked words`).not.toBeNull();
  return (words as RegExpExecArray)[1] as string;
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

describe('the interest question is spec wording, verbatim', () => {
  // spec.md §8 Phase A. This is the sentence a lawyer will read first, and
  // paraphrasing it is how a demand test quietly becomes a consent flow.
  it('asks exactly what spec says to ask', async () => {
    const spec = await readFile(new URL('../docs/spec.md', import.meta.url), 'utf8');
    const page = await readFile(new URL('../src/web/page.ts', import.meta.url), 'utf8');
    const question = 'If an independent equipment lender could quote this deal, '
      + 'would you want to hear from one?';
    expect(spec).toContain(question);
    expect(page).toContain(question);
  });

  it('keeps consent language away from it entirely', async () => {
    const page = await readFile(new URL('../src/web/page.ts', import.meta.url), 'utf8');
    const block = page.slice(page.indexOf('function interestBlock'), page.indexOf('export interface VerdictTicketView'));
    expect(block.length).toBeGreaterThan(0);
    // The word appears once, in a comment explaining why it must not appear in
    // the copy. It must never reach a farmer's screen from here.
    const rendered = block.slice(block.indexOf('return `'));
    for (const forbidden of ['consent', 'agree', 'authorise', 'authorize', 'permission to']) {
      expect(rendered.toLowerCase(), `the interest block says "${forbidden}"`).not.toContain(forbidden);
    }
  });
});


describe('rendered microcopy matches the canon table', () => {
  // design.md §2 holds the canonical microcopy table and CLAUDE.md says it is
  // the source of truth. Until now nothing checked that the product said what
  // the table said, which is how a "Read my quote" button that appears in no
  // table shipped, and how the footer line drifted from it.

  it('prints the canonical footer trust line, verbatim', async () => {
    const canonical = await canonMicrocopy('footer trust line');
    const page = await readFile(new URL('../src/web/page.ts', import.meta.url), 'utf8');
    expect(page).toContain(canonical);
  });

  it('says the canonical wait line while the model reads, and not before', async () => {
    const canonical = await canonMicrocopy('extraction wait');
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    expect(html).toContain(canonical);
    // design.md section 9 makes the no-JS form the requirement and the wait
    // state the enhancement, so both elements ship hidden. A farmer without
    // JavaScript never meets a bar that cannot move.
    expect(html).toMatch(/<div class="progress" hidden/);
    expect(html).toMatch(/<p class="note wait"[^>]*hidden>/);
    // design.md section 6: one thin denim line, and it is the only animation
    // in the product. Reduced motion still gets a line, it just stops moving.
    const bar = /\.progress::after \{[^}]*\}/.exec(html)?.[0] ?? '';
    expect(bar, 'the progress rule moved and this test can no longer see it').not.toBe('');
    expect(bar).toContain('background: var(--denim)');
    expect(bar).toContain('animation: crawl');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    // The typed path is arithmetic and answers instantly. A crawling bar on it
    // would be motion for its own sake, which design.md section 3 forbids.
    expect(renderForm()).not.toContain('class="progress"');
  });

  it('holds the second tap, without eating a named button value', () => {
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    // Every second tap on the photo path is a second vision call and a second
    // bill, so the button dies on submit. It dies a tick late on purpose: a
    // submit button disabled inside its own handler drops its name and value
    // from the body the browser is still assembling, and the consent screen
    // posts answer=yes on exactly that.
    expect(html).toContain('if(b)setTimeout(function(){b.disabled=true;},0);');
    // The back button lands on a bfcache-restored page with the DOM exactly as
    // it left: button dead, line crawling, form unusable until this fires.
    expect(html).toContain("addEventListener('pageshow'");
  });

  it('uses the canonical primary button label on both submit paths', async () => {
    const canonical = await canonMicrocopy('primary button');
    const page = await readFile(new URL('../src/web/page.ts', import.meta.url), 'utf8');
    const buttons = page.match(/<button type="submit"[^>]*>([^<]+)<\/button>/g) ?? [];
    const labels = buttons.map((b) => (/>([^<]+)<\/button>/.exec(b) as RegExpExecArray)[1]);
    // The typed form and the photo form both submit a quote, so both carry the
    // one canonical label. "Read my quote" was invented and is gone.
    expect(labels.filter((l) => l === canonical).length).toBeGreaterThanOrEqual(2);
    expect(page).not.toContain('Read my quote');
  });

  it('uses the canonical photo button label where the photo path is offered', async () => {
    const canonical = await canonMicrocopy('photo button');
    const page = await readFile(new URL('../src/web/page.ts', import.meta.url), 'utf8');
    expect(page).toContain(canonical);
  });

  it('renders the homepage redesign moments from the canon table, verbatim', async () => {
    // The camera hero, the manual disclosure, the add-another line and the
    // retake all entered the table in the same commit that shipped them. This
    // pins the render to the table. The whose-side sentence left the table and
    // the page together on 2026-08-18; the how-we-make-money link stayed.
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    for (const label of [
      'h1', 'subhead', 'photo button', 'add another page', 'retake button',
      'manual disclosure',
    ]) {
      expect(html, `the homepage does not render the canon "${label}" words`)
        .toContain(await canonMicrocopy(label));
    }
  });

  it('carries the H1 the spec and the ad bank both name', async () => {
    // Three documents have to agree or the scent breaks between the ad, the
    // spec and the page: spec.md's site headline, the ads.md hook bank, and
    // the rendered H1.
    const h1 = await canonMicrocopy('h1');
    const spec = await readFile(new URL('../docs/spec.md', import.meta.url), 'utf8');
    const ads = await readFile(new URL('../ops/ads.md', import.meta.url), 'utf8');
    expect(spec, 'spec.md names a different site headline').toContain(h1);
    expect(ads, 'the live H1 is not a hook in the ads.md bank').toContain(h1);
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    expect(html).toContain(`<h1>${h1}</h1>`);
  });

  it('keeps the failure copy and the straight answer on canon too', async () => {
    const worker = await readFile(new URL('../src/api/worker.ts', import.meta.url), 'utf8');
    expect(worker).toContain(await canonMicrocopy('blurry photo'));
    expect(worker).toContain(await canonMicrocopy('too many photos'));
    const pages = await readFile(new URL('../src/web/pages.ts', import.meta.url), 'utf8');
    expect(pages).toContain(await canonMicrocopy('straight answer, whose side'));
  });
});


describe('the homepage keeps the ruled shape', () => {
  const html = () => renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });

  // Owner ruling 2026-08-17: no worked ticket on the front door (it lives on
  // /how-we-figure-it), the snap box is the big camera-glyph hero, the
  // disclosure sits directly under it, and Turnstile renders beneath the
  // Run the numbers button.
  it('keeps the DOM order: hero, disclosure, money link, footer', () => {
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    // Measured from the h1, so the class names in the stylesheet up in the
    // head cannot shadow the body order being asserted.
    const body = html.slice(html.indexOf('<h1>'));
    const positions = [
      body.indexOf('<h1>'),
      body.indexOf('hero-camera'),
      body.indexOf('hero-manual'),
      body.indexOf('/how-we-make-money'),
      body.indexOf('<footer'),
    ];
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The desktop change is a media query, never a second layout.
    expect(html).toContain('@media (min-width: 700px)');
  });

  it('puts Turnstile beneath the Run the numbers button', () => {
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    const body = html.slice(html.indexOf('<h1>'));
    const run = body.indexOf('class="camera-run"');
    const turnstile = body.indexOf('cf-turnstile');
    expect(run).toBeGreaterThan(-1);
    expect(turnstile).toBeGreaterThan(run);
  });

  it('carries the camera glyph on the snap box, the one icon in the product', () => {
    // Anchored to the label element itself. Slicing to the first "Snap the
    // quote" broke the moment the H1 started with those words too.
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    const label = /<label class="camera-btn"[^>]*>([\s\S]*?)<\/label>/.exec(html)?.[1] ?? '';
    expect(label, 'the snap box label moved and this test can no longer see it').not.toBe('');
    expect(label).toContain('<svg');
    expect(label).toContain('Snap the quote');
  });

  it('draws the snap box as an outline, so one filled button stays the action', () => {
    // Two solid ink blocks stacked read as two competing buttons. The box is
    // a target to put a photo into; Run the numbers is the action.
    //
    // Every .camera-btn rule, not the first one: the first is the flex
    // ordering rule, and matching only that passed while asserting nothing.
    const rules = [...html().matchAll(/\.camera-btn \{[^}]*\}/g)].map((match) => match[0]).join('');
    expect(rules, 'the .camera-btn rules moved and this test can no longer see them').not.toBe('');
    expect(rules).toContain('background: transparent');
    expect(rules).toContain('border: 2px solid var(--ink)');
    // And the one filled ink block is still the submit button.
    expect(html()).toContain('<button type="submit" class="camera-run">');
  });

  // design.md §9: the page must work at 200% zoom and on an iPhone SE, which
  // means it may never scroll sideways. Two real defects caused exactly that
  // and both are invariants of the stylesheet rather than of any figure, so
  // they are pinned here. There is no layout engine in this suite; a browser
  // measured the fix (0px overflow from 320px to 1440px) and these keep the
  // two causes from coming back unnoticed.
  it('hides the file input with a rule that outranks input[type="file"]', () => {
    // The bug: `.camera-input` is one class (0,1,0) and `input[type="file"]`
    // is a type plus an attribute (0,1,1), so the type rule won and the
    // hidden input kept width:100%. Absolutely positioned with no positioned
    // ancestor, that resolved against the viewport and pushed the page 649px
    // wide. The selector has to name the type as well as the class.
    expect(html()).toContain('input[type="file"].camera-input {');
    const rule = /input\[type="file"\]\.camera-input \{[^}]*\}/.exec(html())?.[0] ?? '';
    expect(rule).toContain('width: 1px');
    // Every box property the type rule would otherwise supply is zeroed, or
    // the 1px box grows back through padding, border or min-height.
    for (const zeroed of ['min-height: 0', 'padding: 0', 'border: 0']) {
      expect(rule, `the hidden input can regrow through ${zeroed}`).toContain(zeroed);
    }
  });

  it('shows one submit at a time when the typing disclosure is open', () => {
    // Both forms carry the canonical "Run the numbers" label, so with the
    // disclosure open they render as two identical buttons on one screen. The
    // photo path's submit, challenge and note step aside while it is open.
    const sheet = html();
    expect(sheet).toContain('.hero:has(.hero-manual[open]) .camera-run');
    expect(sheet).toContain('.hero:has(.hero-manual[open]) .cf-turnstile');
    expect(sheet).toContain('.hero:has(.hero-manual[open]) .camera-note');
    // Both buttons still exist in the markup and both still say the canonical
    // words: this is a display rule, never a relabelling of one of them.
    const labels = [...sheet.matchAll(/<button type="submit"[^>]*>([^<]+)<\/button>/g)]
      .map((match) => match[1]);
    expect(labels.filter((label) => label === 'Run the numbers')).toHaveLength(2);
  });

  it('leaves room for the fixed-width Turnstile widget on a 320px phone', () => {
    // The widget is a fixed 300px. At the standard 16px gutters a 320px screen
    // offers 288px, and the overflow is a scrollbar no farmer can dismiss.
    expect(html()).toContain('@media (max-width: 339px)');
  });

  it('renders no worked ticket and no stamp on the front door', () => {
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    expect(html).not.toContain('Here is one, worked.');
    expect(html).not.toContain('CHECKS OUT');
  });
});
describe('the mark ships as a working icon', () => {
  // A favicon fails silently: nothing throws, the tab just shows a blank page
  // glyph and the install prompt never appears. So the head, the manifest and
  // the files on disk are checked against each other rather than by eye.
  const asset = (name: string) => new URL(`../public/${name}`, import.meta.url);

  it('links the icon set from every page head', () => {
    const head = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    expect(head).toContain('<link rel="icon" href="/favicon.ico" sizes="48x48">');
    expect(head).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(head).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  });

  it('ships every file the head and the manifest name', async () => {
    const manifest = JSON.parse(renderManifest());
    const named = [
      'favicon.ico', 'favicon.svg', 'apple-touch-icon.png',
      ...manifest.icons.map((icon: { src: string }) => icon.src.replace('/', '')),
    ];
    for (const name of named) {
      const bytes = await readFile(asset(name));
      expect(bytes.byteLength, `public/${name} is missing or empty`).toBeGreaterThan(0);
    }
    // 192 and 512 are what Chrome requires before it will offer the install
    // this manifest exists to get (pages.ts).
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('cuts the icon from the wordmark, paper on ink', async () => {
    // design.md §7: a crop of the wordmark, not a monogram and not a drawn
    // mark. Outlines, so the icon never waits on a font.
    const svg = await readFile(asset('favicon.svg'), 'utf8');
    expect(svg).toContain('fill="#191813"');
    expect(svg).toContain('fill="#F7F5EF"');
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<text');
  });
});

describe('the bands are the lockup, paper on ink', () => {
  it('bands the wordmark, the rule and the tagline in ink', () => {
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    // Brand card lockup 2. The band is above the column, so the order is
    // asserted from the top of the body rather than from the h1.
    const body = html.slice(html.indexOf('<body>'));
    expect(body).toContain('<header class="banner">');
    expect(body.indexOf('class="wordmark"')).toBeGreaterThan(body.indexOf('<header class="banner">'));
    expect(body.indexOf('class="tagline"')).toBeLessThan(body.indexOf('<main>'));
    expect(html).toContain('.banner { background: var(--ink); }');
    expect(html).toContain('.wordmark a { color: var(--paper); text-decoration: none; }');
    // A solid black band would print as a solid black band.
    expect(html).toContain('.banner { background: transparent; }');
  });

  it('closes the page in that same band, not in a copy of it', () => {
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    const body = html.slice(html.indexOf('<body>'));
    // Owner ruling 2026-08-19: the footer is the header band again, carrying
    // the same class rather than a second copy of the values, so the two can
    // never drift apart. A `footer` rule of its own painting ink is exactly
    // the drift this test exists to catch.
    expect(body).toContain('<footer class="banner">');
    expect(body.indexOf('<footer class="banner">')).toBeGreaterThan(body.indexOf('</main>'));
    expect(html).not.toMatch(/\nfooter \{[^}]*background/);
    // Links in paper, the trust line and the address in rule, the way the
    // wordmark and the tagline sit in the header.
    expect(html).toContain('footer nav a { margin-right: var(--s-12); color: var(--paper); }');
    expect(html).toContain('footer p { font-size: var(--text-footnote); color: var(--rule); margin: 0; }');
    // Ink on ink is what a browser's default focus ring draws on either band.
    expect(html).toContain('.banner a:focus-visible { outline: 2px solid var(--paper); outline-offset: 2px; }');
  });

  it('puts the buttons in ink, and keeps the blue for links', () => {
    // Owner ruling 2026-08-18: buttons are black, not denim.
    const html = renderForm(undefined, [], { turnstileSiteKey: 'canon-check' });
    const button = /\nbutton \{[^}]*\}/.exec(html)?.[0] ?? '';
    expect(button, 'the button rule moved and this test can no longer see it').not.toBe('');
    expect(button).toContain('background: var(--ink)');
    expect(button).not.toContain('var(--denim)');
    expect(html).toContain('a { color: var(--denim); }');
  });
});
