// The one public page, server-rendered as a string (spec.md Decision 2: no
// client framework, the form works as a plain POST). Everything here is
// design.md law: the paper/ink palette from section 3, Libre Franklin and
// Courier Prime from section 4, one 640px column from section 5, square
// shoulders and 56px controls from section 6, the wordmark from section 7.
//
// This file does ZERO arithmetic. Every figure it prints arrives already
// computed and already formatted by src/finance/.

import type { PromoPriceRate } from '../finance/index.js';

const styles = `
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

:root {
  --paper: #F7F5EF;
  --ink: #191813;
  --ink-soft: #57534A;
  --rule: #D8D4C8;
  --denim: #2F5D8A;
  --field: #3F7A34;
  --field-fill: #E4EDDC;
  --amber-ink: #8A5A00;
  --amber-fill: #F2E4C2;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: 'Libre Franklin', 'Franklin Gothic Medium', 'Segoe UI', Arial, sans-serif;
  font-size: 18px;
  line-height: 1.5;
}

main { max-width: 640px; margin: 0 auto; padding: 32px 16px 48px; }

.wordmark { font-weight: 900; font-size: 28px; letter-spacing: -0.02em; text-transform: uppercase; margin: 0; }
.wordmark a { color: var(--ink); text-decoration: none; }
.wordmark-rule { border: 0; border-top: 1px solid var(--rule); margin: 8px 0 4px; }
.tagline { font-size: 14px; color: var(--ink-soft); margin: 0 0 32px; }

h1 { font-weight: 700; font-size: 28px; line-height: 1.3; margin: 0 0 16px; }
p { margin: 0 0 16px; }
.note { color: var(--ink-soft); font-size: 14px; }

label { display: block; font-weight: 500; font-size: 16px; margin: 0 0 4px; }

input[type="text"], select {
  width: 100%;
  height: 56px;
  padding: 0 12px;
  background: #FFF;
  border: 1px solid var(--rule);
  border-radius: 2px;
  color: var(--ink);
  font-family: 'Courier Prime', 'Courier New', monospace;
  font-size: 18px;
}
input[type="file"] {
  width: 100%; min-height: 56px; padding: 12px;
  background: #FFF; border: 1px solid var(--rule); border-radius: 2px;
  font-family: inherit; font-size: 16px;
}
input[type="text"]:focus, select:focus, input[type="file"]:focus { border: 2px solid var(--denim); outline: none; }

.field { margin: 0 0 16px; }

button {
  width: 100%;
  height: 56px;
  border: 1px solid var(--denim);
  border-radius: 2px;
  background: var(--denim);
  color: #FFF;
  font-family: inherit;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
}

/* Errors are ink on amber. No red exists in this product. */
.problem {
  background: var(--amber-fill);
  color: var(--amber-ink);
  border-left: 4px solid var(--amber-ink);
  padding: 12px 16px;
  margin: 0 0 24px;
}
.problem ul { margin: 8px 0 0; padding-left: 20px; }

/* The ticket. Receipt rules, mono numbers, right aligned, double rule before
   the total, exactly like the shop hands you. */
.ticket { font-family: 'Courier Prime', 'Courier New', monospace; margin: 24px 0 0; }
.ticket-rule { border: 0; border-top: 1px solid var(--ink); margin: 16px 0; }
.ticket-rule-double { border: 0; border-top: 3px double var(--ink); margin: 16px 0; }

.headline-label { font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); margin: 0; }
.headline-rate { font-size: 48px; font-weight: 700; line-height: 1.1; margin: 4px 0 0; }

.ticket table { width: 100%; border-collapse: collapse; font-size: 16px; }
.ticket td { padding: 6px 0; border-bottom: 1px solid var(--rule); }
.ticket td:last-child { text-align: right; white-space: nowrap; }
.ticket tr:last-child td { border-bottom: 0; }

.verdict-none { font-family: 'Libre Franklin', sans-serif; margin: 24px 0 0; }
.verdict-none h2 { font-size: 24px; font-weight: 600; margin: 0 0 8px; }
.verdict-none ul { margin: 8px 0 0; padding-left: 20px; }

.assumption {
  font-family: 'Libre Franklin', sans-serif;
  background: var(--amber-fill);
  color: var(--amber-ink);
  padding: 12px 16px;
  margin: 16px 0 0;
  font-size: 16px;
}

footer { margin: 48px 0 0; padding-top: 16px; border-top: 1px solid var(--rule); }
footer p { font-size: 14px; color: var(--ink-soft); margin: 0; }


/* Confirm screen field flags. A field we could not read gets an amber label
   and an EMPTY box. Never a guess sitting in a filled box. */
.flag-read { font-size: 14px; color: var(--ink-soft); margin: 0 0 4px; }
.flag-unreadable {
  font-size: 14px; color: var(--amber-ink); background: var(--amber-fill);
  display: inline-block; padding: 2px 8px; margin: 0 0 4px;
}

.field.checkbox label { font-weight: 400; font-size: 16px; }
.field.checkbox input { width: 24px; height: 24px; margin-right: 8px; vertical-align: middle; }

/* The stamp. Rubber-stamp register: mono caps, a hair of rotation, a plain
   box. A pristine vector distressed edge is fake antique, so there is none. */
.stamp {
  display: inline-block;
  font-family: 'Courier Prime', 'Courier New', monospace;
  font-weight: 700; font-size: 20px; letter-spacing: 0.12em;
  padding: 6px 16px; margin: 12px 0;
  transform: rotate(-1.75deg);
}
.stamp-good { color: var(--field); border: 3px solid var(--field); background: var(--field-fill); }
.stamp-amber { color: var(--amber-ink); border: 3px solid var(--amber-ink); background: var(--amber-fill); }

.verdict-line { font-family: 'Libre Franklin', sans-serif; font-weight: 600; font-size: 24px; margin: 8px 0 0; }
.reference { font-size: 16px; margin: 0; }
.footnote { font-size: 14px; color: var(--ink-soft); }

.secondary {
  background: var(--paper); color: var(--denim); border: 2px solid var(--denim);
  margin-top: 12px;
}

.divider { text-align: center; color: var(--ink-soft); font-size: 16px; margin: 24px 0 8px; }

a { color: var(--denim); }

@media print {
  body { background: #FFF; color: #000; font-size: 12pt; }
  main { max-width: none; padding: 0; }
  .no-print, form, footer { display: none; }
  .ticket-rule, .wordmark-rule { border-top-color: #000; }
  .ticket-rule-double { border-top-color: #000; }
  .ticket td { border-bottom-color: #999; }
  /* The stamp prints. It is the thing the farmer carries back to the desk. */
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
${view.rows.map(field).join('\n')}
    <div class="field">
      <label for="paymentFrequency">How often you pay</label>
      <p class="flag-read">Check this one carefully</p>
      <select id="paymentFrequency" name="paymentFrequency">
        ${frequencyOptions(view.frequency)}
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
