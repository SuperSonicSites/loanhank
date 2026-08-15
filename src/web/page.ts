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
input[type="text"]:focus, select:focus { border: 2px solid var(--denim); outline: none; }

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

a { color: var(--denim); }

@media print {
  body { background: #FFF; color: #000; }
  .no-print { display: none; }
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

/** Screen 1. The tool is the landing page. */
export function renderForm(values: FormValues = EMPTY_FORM, problems: string[] = []): string {
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
`);
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
