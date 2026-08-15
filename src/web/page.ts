// The one public page, server-rendered as a string (spec.md Decision 2: no
// client framework, the form works as a plain POST). Everything here is
// design.md law: the paper/ink palette from section 3, Libre Franklin and
// Courier Prime from section 4, one 640px column from section 5, square
// shoulders and 56px controls from section 6, the wordmark from section 7.
//
// This file does ZERO arithmetic. Every figure it prints arrives already
// computed and already formatted by src/finance/.

import type { PromoPriceRate } from '../finance/index.js';
import { CA_PROVINCES, US_STATES } from '../shared/schema.js';

const styles = `
/* ---------------------------------------------------------------------------
   TOKENS — design/tokens/*.css, values verbatim from the design bundle.
   Inlined rather than imported because every byte on this page is served from
   the worker and nothing is fetched from a third party.

   ONE DELIBERATE OMISSION: the bundle's typography.css opens with
   @import url('https://fonts.googleapis.com/css2?...'). That is dropped.
   design.md §4 requires subset woff2, self-hosted and preloaded; §9 forbids the
   third-party request; and the no-cookie-banner stance in spec.md §10 only
   holds while nothing leaves the page. A Google Fonts import hands every
   visitor's IP to a third party on first paint. design.md wins on conflict, so
   the faces below are the self-hosted ones and the import is not here.
   --------------------------------------------------------------------------- */

@font-face {
  font-family: 'Libre Franklin';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/libre-franklin-latin-400-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Libre Franklin';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/libre-franklin-latin-700-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Libre Franklin';
  font-style: normal;
  font-weight: 900;
  font-display: swap;
  src: url('/fonts/libre-franklin-latin-900-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Courier Prime';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/courier-prime-latin-400-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Courier Prime';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/courier-prime-latin-700-normal.woff2') format('woff2');
}

:root {
  /* colors.css */
  --paper: #F7F5EF;
  --ink: #191813;
  --ink-soft: #57534A;
  --rule: #D8D4C8;
  --denim: #2F5D8A;
  --field: #3F7A34;
  --field-fill: #E4EDDC;
  --amber-ink: #8A5A00;
  --amber-fill: #F2E4C2;
  --input-white: #FFFFFF; /* pure white allowed inside input fields only */

  /* typography.css */
  --font-ui: "Libre Franklin", "Franklin Gothic Medium", "Segoe UI", Arial, sans-serif;
  --font-mono: "Courier Prime", "Courier New", monospace;
  --text-apr: 48px;
  --text-apr-desktop: 56px;
  --text-verdict: 24px;
  --text-h1: 28px;
  --text-body: 18px;
  --text-receipt: 16px;
  --text-label: 16px;
  --text-footnote: 14px;
  --lh-body: 1.5;

  /* spacing.css */
  --s-4: 4px;
  --s-8: 8px;
  --s-12: 12px;
  --s-16: 16px;
  --s-24: 24px;
  --s-32: 32px;
  --s-48: 48px;
  --radius: 2px;
  --col-max: 640px;
  --control-h: 56px;
  --tap-min: 48px;
  --hairline: 1px solid var(--rule);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--text-body);
  line-height: var(--lh-body);
}

main { max-width: var(--col-max); margin: 0 auto; padding: var(--s-32) var(--s-16) var(--s-48); }

.wordmark { font-weight: 900; font-size: var(--text-h1); letter-spacing: -0.02em; text-transform: uppercase; margin: 0; }
.wordmark a { color: var(--ink); text-decoration: none; }
.wordmark-rule { border: 0; border-top: var(--hairline); margin: var(--s-8) 0 var(--s-4); }
.tagline { font-size: var(--text-footnote); color: var(--ink-soft); margin: 0 0 var(--s-32); }

h1 { font-weight: 700; font-size: var(--text-h1); line-height: 1.3; margin: 0 0 var(--s-16); }
p { margin: 0 0 var(--s-16); }
.note { color: var(--ink-soft); font-size: var(--text-footnote); }

label { display: block; font-weight: 500; font-size: var(--text-label); margin: 0 0 var(--s-4); }

input[type="text"], select {
  width: 100%;
  height: var(--control-h);
  padding: 0 var(--s-12);
  background: var(--input-white);
  border: var(--hairline);
  border-radius: var(--radius);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-body);
}
input[type="file"] {
  width: 100%; min-height: var(--control-h); padding: var(--s-12);
  background: var(--input-white); border: var(--hairline); border-radius: var(--radius);
  font-family: inherit; font-size: var(--text-receipt);
}
input[type="text"]:focus, select:focus, input[type="file"]:focus { border: 2px solid var(--denim); outline: none; }
input[type="email"] {
  width: 100%; height: var(--control-h); padding: 0 var(--s-12);
  background: var(--input-white); border: var(--hairline); border-radius: var(--radius);
  color: var(--ink); font-family: var(--font-mono); font-size: var(--text-body);
}
input[type="email"]:focus { border: 2px solid var(--denim); outline: none; }

.field { margin: 0 0 var(--s-16); }

button {
  width: 100%;
  min-height: var(--control-h);
  border: 1px solid var(--denim);
  border-radius: var(--radius);
  background: var(--denim);
  color: var(--input-white);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: 700;
  cursor: pointer;
}
.secondary {
  background: var(--paper); color: var(--denim); border: 2px solid var(--denim);
  margin-top: var(--s-12);
}

/* Errors are ink on amber. No red exists in this product. */
.problem {
  background: var(--amber-fill);
  color: var(--amber-ink);
  border-left: 4px solid var(--amber-ink);
  padding: var(--s-12) var(--s-16);
  margin: 0 0 var(--s-24);
}
.problem ul { margin: var(--s-8) 0 0; padding-left: 20px; }

/* Confirm screen field flags. A field we could not read gets an amber label
   and an EMPTY box. Never a guess sitting in a filled box. */
.flag-read { font-size: var(--text-footnote); color: var(--ink-soft); margin: 0 0 var(--s-4); }
.flag-unreadable {
  font-size: var(--text-footnote); color: var(--amber-ink); background: var(--amber-fill);
  display: inline-block; padding: 2px var(--s-8); margin: 0 0 var(--s-4);
}

.field.checkbox label { font-weight: 400; font-size: var(--text-label); }
.field.checkbox input { width: var(--tap-min); height: var(--tap-min); margin-right: var(--s-8); vertical-align: middle; }

/* The ticket. Labels left in Libre Franklin, values right in Courier Prime,
   hairline between every line, double rule above the total. No zebra, no
   header fill, no cell borders, no card, no shadow, no rounded wrapper. */
.ticket { margin: var(--s-24) 0 0; }
.ticket-rule { border: 0; border-top: 1px solid var(--ink); margin: var(--s-16) 0; }
.ticket-rule-double { border: 0; border-top: 3px double var(--ink); margin: var(--s-16) 0; }

.headline-label {
  font-family: var(--font-mono);
  font-size: var(--text-footnote); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-soft); margin: 0;
}
.headline-rate {
  font-family: var(--font-mono); font-weight: 700;
  font-size: var(--text-apr); line-height: 1.1; margin: var(--s-4) 0 0;
}
@media (min-width: 700px) {
  .headline-rate { font-size: var(--text-apr-desktop); }
}

.ticket table { width: 100%; border-collapse: collapse; font-size: var(--text-receipt); }
.ticket td { padding: 6px 0; border-bottom: var(--hairline); }
.ticket td:first-child { font-family: var(--font-ui); }
.ticket td:last-child { font-family: var(--font-mono); text-align: right; white-space: nowrap; }
.ticket tr:last-child td { border-bottom: 0; }

/* The stamp. Rubber-stamp register: mono caps, a hair of rotation, a plain
   box. A pristine vector distressed edge is fake antique, so there is none. */
.stamp {
  display: inline-block;
  font-family: var(--font-mono);
  font-weight: 700; font-size: 20px; letter-spacing: 0.12em;
  padding: 6px var(--s-16); margin: var(--s-12) 0;
  transform: rotate(-1.75deg);
}
.stamp-good { color: var(--field); border: 3px solid var(--field); background: var(--field-fill); }
.stamp-amber { color: var(--amber-ink); border: 3px solid var(--amber-ink); background: var(--amber-fill); }

.verdict-line { font-family: var(--font-ui); font-weight: 600; font-size: var(--text-verdict); margin: var(--s-8) 0 0; }
.reference { font-family: var(--font-mono); font-size: var(--text-receipt); margin: 0; }
.footnote { font-size: var(--text-footnote); color: var(--ink-soft); }

.verdict-none { font-family: var(--font-ui); margin: var(--s-24) 0 0; }
.verdict-none h2 { font-size: var(--text-verdict); font-weight: 600; margin: 0 0 var(--s-8); }
.verdict-none ul { margin: var(--s-8) 0 0; padding-left: 20px; }

.assumption {
  font-family: var(--font-ui);
  background: var(--amber-fill);
  color: var(--amber-ink);
  padding: var(--s-12) var(--s-16);
  margin: var(--s-16) 0 0;
  font-size: var(--text-receipt);
}

.gate { border-top: var(--hairline); margin: var(--s-32) 0 0; padding-top: var(--s-24); }
.gate h2 { font-size: var(--text-verdict); font-weight: 600; margin: 0 0 var(--s-8); }

.divider { text-align: center; color: var(--ink-soft); font-size: var(--text-receipt); margin: var(--s-24) 0 var(--s-8); }

footer { margin: var(--s-48) 0 0; padding-top: var(--s-16); border-top: var(--hairline); }
footer p { font-size: var(--text-footnote); color: var(--ink-soft); margin: 0; }
footer nav { font-size: var(--text-footnote); margin: 0 0 var(--s-8); }
footer nav a { margin-right: var(--s-12); }

a { color: var(--denim); }

/* The printout negotiates for the farmer at the dealer desk. It is the best
   marketing this product will ever ship, so it prints like a shop ticket. */
@media print {
  body { background: #FFF; color: #000; font-size: 12pt; }
  main { max-width: none; padding: 0; }
  .no-print, form, footer { display: none; }
  .ticket-rule, .wordmark-rule, .ticket-rule-double { border-top-color: #000; }
  .ticket td { border-bottom-color: #999; }
  .stamp { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  a[href]::after { content: ""; }
}
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="A free tool that reads a farm-equipment dealer quote and shows the real rate.">
<link rel="preload" as="font" type="font/woff2" href="/fonts/libre-franklin-latin-900-normal.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/fonts/libre-franklin-latin-400-normal.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/fonts/courier-prime-latin-400-normal.woff2" crossorigin>
<style>${styles}</style>
</head>
<body>
<main>
  <p class="wordmark"><a href="/">LoanHank</a></p>
  <hr class="wordmark-rule">
  <p class="tagline">Runs the numbers. Takes no side.</p>
${body}
  <footer>
    <p>Free tool. Nothing leaves here unless you say go.</p>
  </footer>
</main>
</body>
</html>
`;
}

export interface FormValues {
  quotedPrice: string;
  cashDiscount: string;
  paymentCount: string;
  payment: string;
  paymentFrequency: string;
}

const EMPTY_FORM: FormValues = {
  quotedPrice: '',
  cashDiscount: '',
  paymentCount: '',
  payment: '',
  paymentFrequency: 'monthly',
};

const FREQUENCIES: Array<[string, string]> = [
  ['monthly', 'Every month'],
  ['quarterly', 'Every quarter'],
  ['semiannual', 'Twice a year'],
  ['annual', 'Once a year'],
];


/**
 * One list, both countries. A Canadian deal gets its arithmetic and an honest
 * abstention, because no published Canadian equipment rate card exists to
 * check it against, and an American one is not a substitute.
 */
function regionOptions(selected: string): string {
  const group = (label: string, codes: readonly string[]) =>
    `<optgroup label="${label}">`
    + codes.map((code) => `<option value="${code}"${code === selected ? ' selected' : ''}>${code}</option>`).join('')
    + '</optgroup>';
  return `<option value="">Pick one</option>${group('United States', US_STATES)}${group('Canada', CA_PROVINCES)}`;
}

function frequencyOptions(selected: string): string {
  return FREQUENCIES
    .map(([value, label]) =>
      `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`)
    .join('\n        ');
}

export interface PhotoPath {
  /** Empty means the photo path is off, and the button does not render. */
  turnstileSiteKey: string;
}

/** Screen 1. The tool is the landing page. */
export function renderForm(
  values: FormValues = EMPTY_FORM,
  problems: string[] = [],
  photo: PhotoPath | null = null,
): string {
  const problemBlock = problems.length === 0
    ? ''
    : `  <div class="problem">
    <p>We could not read a couple of these. Fix them and run it again.</p>
    <ul>${problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul>
  </div>
`;

  return shell('LoanHank', `${problemBlock}  <h1>Point your phone at the dealer's quote. See the number they didn't print.</h1>
  <p>Free, takes about a minute, and your numbers stay here unless you say otherwise.</p>

  <form method="post" action="/decode">
    <div class="field">
      <label for="quotedPrice">Quoted price</label>
      <input type="text" id="quotedPrice" name="quotedPrice" inputmode="decimal" value="${escapeHtml(values.quotedPrice)}" required>
    </div>
    <div class="field">
      <label for="cashDiscount">Cash discount</label>
      <input type="text" id="cashDiscount" name="cashDiscount" inputmode="decimal" value="${escapeHtml(values.cashDiscount)}">
    </div>
    <div class="field">
      <label for="payment">Payment</label>
      <input type="text" id="payment" name="payment" inputmode="decimal" value="${escapeHtml(values.payment)}" required>
    </div>
    <div class="field">
      <label for="paymentFrequency">How often you pay</label>
      <select id="paymentFrequency" name="paymentFrequency">
        ${frequencyOptions(values.paymentFrequency)}
      </select>
    </div>
    <div class="field">
      <label for="paymentCount">How many payments</label>
      <input type="text" id="paymentCount" name="paymentCount" inputmode="numeric" value="${escapeHtml(values.paymentCount)}" required>
    </div>
    <button type="submit">Run the numbers</button>
  </form>
${photoBlock(photo)}`);
}

/**
 * The photo path, and the only JavaScript in the product.
 *
 * It renders only when Turnstile is configured, because the upload calls a
 * vision model and every call costs real money. The typed form above never
 * depends on any of this: design.md section 9 makes a working no-JS form law,
 * so the challenge lives here and nowhere near it.
 */
function photoBlock(photo: PhotoPath | null): string {
  if (photo === null || photo.turnstileSiteKey === '') return '';
  return `
  <p class="divider">or</p>

  <form method="post" action="/extract" enctype="multipart/form-data">
    <div class="field">
      <label for="photo">Snap the quote instead</label>
      <input type="file" id="photo" name="photo" accept="image/jpeg,image/png,application/pdf" capture="environment" required>
    </div>
    <div class="cf-turnstile" data-sitekey="${escapeHtml(photo.turnstileSiteKey)}" data-action="extract"></div>
    <button type="submit" class="secondary">Read my quote</button>
    <p class="note">Reading your paper takes about 10 seconds. The photo is never saved.</p>
  </form>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
`;
}

export interface TicketLine {
  label: string;
  amount: string;
}

export interface TicketView {
  rate: string;
  result: PromoPriceRate;
  lines: TicketLine[];
  costSentence: string;
  missing: string[];
}

/** Screen 3. The ticket. This table is the product. */
export function renderTicket(view: TicketView): string {
  const rows = view.lines
    .map((line) => `      <tr><td>${escapeHtml(line.label)}</td><td>${escapeHtml(line.amount)}</td></tr>`)
    .join('\n');

  return shell('Your ticket — LoanHank', `  <div class="ticket">
    <hr class="ticket-rule">
    <p class="headline-label">Cost of the cash discount</p>
    <p class="headline-rate">${escapeHtml(view.rate)}</p>
    <hr class="ticket-rule">
    <table>
${rows}
    </table>
    <hr class="ticket-rule-double">
    <p>${escapeHtml(view.costSentence)}</p>
  </div>

  <p class="assumption">${escapeHtml(view.result.assumptions.join(' '))}</p>

  <div class="verdict-none">
    <h2>No verdict yet. Here's what's missing.</h2>
    <p>We will not rate a deal against published rates until the whole deal is on the table, because a missing trade or fee moves the number.</p>
    <ul>${view.missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  </div>

  <p class="no-print"><a href="/">Run another quote</a></p>
`);
}

/** Screen 3, abstaining. We could not price it, so we say that and nothing else. */
export function renderUnpriceable(reason: string): string {
  return shell('LoanHank', `  <div class="problem">
    <p>${escapeHtml(reason)}</p>
  </div>
  <p><a href="/">Go back and check the numbers</a></p>
`);
}

export interface ConfirmRow {
  name: string;
  label: string;
  /** 'read' pre-fills the box. 'unreadable' leaves it empty with an amber label. */
  state: 'read' | 'unreadable';
  value: string;
  hint?: string;
}

export interface ConfirmView {
  rows: ConfirmRow[];
  frequency: string;
  warnings: string[];
}

/**
 * What the model read, carried forward so the next screen can diff it against
 * what the farmer corrected it to.
 *
 * Numbers only, by schema. This is the whole eval signal now that photos are
 * never stored: the fields farmers fix most are the next prompt change.
 */
function extractedSnapshot(view: ConfirmView): string {
  const snapshot: Record<string, string> = { paymentFrequency: view.frequency };
  for (const row of view.rows) snapshot[row.name] = row.state === 'read' ? row.value : '';
  return escapeHtml(JSON.stringify(snapshot));
}

/**
 * Screen 2, the confirm screen. Photo path only.
 *
 * Anything we could not read arrives here as an EMPTY box with an amber
 * label, never as a guess the farmer has to catch. That is the whole reason
 * this screen exists: the model abstains, and the farmer fills the gap from
 * the paper in his hand.
 */
export function renderConfirm(view: ConfirmView): string {
  const warningBlock = view.warnings.length === 0
    ? ''
    : `  <div class="problem">
    <ul>${view.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>
  </div>
`;

  const field = (row: ConfirmRow): string => {
    const unreadable = row.state === 'unreadable';
    return `    <div class="field">
      <label for="${row.name}">${escapeHtml(row.label)}</label>
      <p class="${unreadable ? 'flag-unreadable' : 'flag-read'}">${
      unreadable ? 'Could not read it, type it in' : 'Read from your paper'
    }</p>
      <input type="text" id="${row.name}" name="${row.name}" inputmode="decimal" value="${escapeHtml(row.value)}">
${row.hint ? `      <p class="note">${escapeHtml(row.hint)}</p>\n` : ''}    </div>`;
  };

  return shell('Check these — LoanHank', `${warningBlock}  <h1>Check these against your paper. Fix anything we got wrong.</h1>
  <p>Your photo is gone already. It was read and never saved.</p>

  <form method="post" action="/decode">
    <input type="hidden" name="ledger" value="1">
    <input type="hidden" name="extracted" value="${extractedSnapshot(view)}">
${view.rows.map(field).join('\n')}
    <div class="field">
      <label for="paymentFrequency">How often you pay</label>
      <p class="flag-read">Check this one carefully</p>
      <select id="paymentFrequency" name="paymentFrequency">
        ${frequencyOptions(view.frequency)}
      </select>
    </div>
    <div class="field">
      <label for="region">State or province</label>
      <p class="flag-read">Where the deal is written</p>
      <select id="region" name="region" required>
        ${regionOptions('')}
      </select>
    </div>
    <div class="field checkbox">
      <label for="financeOnlyFeeRolled">
        <input type="checkbox" id="financeOnlyFeeRolled" name="financeOnlyFeeRolled">
        That fee is rolled into the payments rather than due at signing
      </label>
    </div>
    <div class="field checkbox">
      <label for="unexplainedAmount">
        <input type="checkbox" id="unexplainedAmount" name="unexplainedAmount">
        There is an amount on this quote I cannot account for
      </label>
      <p class="note">Tick this and we will show your rate but hold the verdict. We will not rate a deal with money in it that nobody can explain.</p>
    </div>
    <button type="submit">Looks right — run it</button>
  </form>
`);
}

export interface VerdictTicketView {
  rate: string;
  verdict: 'checks_out' | 'look_closer' | 'none';
  verdictLine: string;
  lines: TicketLine[];
  reference: string | null;
  footnote: string | null;
  missing: string[];
  assumption: string | null;
}

/**
 * Screen 3 with a verdict. Two stamps only, and no verdict is not a third:
 * it renders as plain words and the absence of the stamp is the message.
 */
export function renderVerdictTicket(view: VerdictTicketView): string {
  const rows = view.lines
    .map((line) => `      <tr><td>${escapeHtml(line.label)}</td><td>${escapeHtml(line.amount)}</td></tr>`)
    .join('\n');

  const stamp = view.verdict === 'checks_out'
    ? '<p class="stamp stamp-good">CHECKS OUT</p>'
    : view.verdict === 'look_closer'
      ? '<p class="stamp stamp-amber">LOOK CLOSER</p>'
      : '';

  const abstention = view.verdict !== 'none'
    ? ''
    : `  <div class="verdict-none">
    <h2>No verdict yet. Here's what's missing.</h2>
    <ul>${view.missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  </div>
`;

  return shell('Your ticket — LoanHank', `  <div class="ticket">
    <hr class="ticket-rule">
    <p class="headline-label">Your real rate</p>
    <p class="headline-rate">${escapeHtml(view.rate)}</p>
    ${stamp}
    <p class="verdict-line">${escapeHtml(view.verdictLine)}</p>
    <hr class="ticket-rule">
    <table>
${rows}
    </table>
    <hr class="ticket-rule-double">
${view.reference ? `    <p class="reference">${escapeHtml(view.reference)}</p>\n` : ''}  </div>

${view.assumption ? `  <p class="assumption">${escapeHtml(view.assumption)}</p>\n` : ''}${abstention}${
    view.footnote ? `  <p class="footnote">${escapeHtml(view.footnote)}</p>\n` : ''
  }  <p class="no-print"><a href="/">Run another quote</a></p>
`);
}
