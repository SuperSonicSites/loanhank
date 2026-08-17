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

/* The hero, one flex stack. The camera form's own box dissolves (display:
   contents) so its children and the manual disclosure interleave into one
   visual order: the snap box, the type-instead line, Run the numbers, then
   the Turnstile widget beneath the button. Desktop moves only the disclosure
   to the top: a calculator searcher wants fields; a phone at the dealer lot
   wants the camera. */
.hero { display: flex; flex-direction: column; }
.hero-camera { display: contents; }
.camera-btn { order: 1; }
.shots { order: 2; }
.addmore { order: 3; }
.hero-manual { order: 4; }
.camera-run { order: 5; }
.hero-camera .cf-turnstile { order: 6; margin: var(--s-8) 0 0; }
.camera-note { order: 7; }
@media (min-width: 700px) {
  .hero-manual { order: 0; }
}

/* The camera hero: a styled file input. The label is the big box; the input
   is visually hidden but still focusable, so validation and keyboards keep
   working. capture="environment" opens a phone camera with no JavaScript.
   The camera glyph is the only icon in the product (design.md section 6). */
.camera-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--s-8);
  width: 100%; min-height: 96px; padding: var(--s-16);
  background: var(--denim); color: var(--input-white);
  border: 1px solid var(--denim); border-radius: var(--radius);
  font-size: var(--text-body); font-weight: 700; cursor: pointer;
  margin: 0 0 var(--s-8);
}
.camera-btn .cam { width: 32px; height: 32px; }
.camera-input {
  position: absolute; width: 1px; height: 1px;
  opacity: 0; overflow: hidden; clip-path: inset(50%);
}
.hero-camera:has(.camera-input:focus-visible) .camera-btn { outline: 2px solid var(--denim); outline-offset: 2px; }
/* The add-another line appears once a photo is in. Pure CSS on :valid, so the
   no-JS path gets the same line the enhanced path does. */
.addmore { display: none; }
.camera-input:valid ~ .addmore { display: block; }
.shots { display: flex; gap: var(--s-8); flex-wrap: wrap; margin: 0 0 var(--s-12); }
.shot { display: flex; flex-direction: column; gap: var(--s-4); }
.shot img { width: 72px; height: 72px; object-fit: cover; border: var(--hairline); border-radius: var(--radius); background: var(--input-white); }
.retake {
  width: auto; min-height: var(--tap-min); padding: 0 var(--s-8);
  background: var(--paper); color: var(--denim); border: 1px solid var(--denim);
  font-weight: 400; font-size: var(--text-footnote);
}

/* Manual entry, demoted to a native disclosure under the snap box. Smaller
   than the hero on purpose, and never a modal. */
.hero-manual { margin: 0 0 var(--s-8); }
.hero-manual summary {
  min-height: var(--tap-min); padding: var(--s-8) 0;
  color: var(--denim); font-weight: 400; font-size: var(--text-label); cursor: pointer;
}
.hero-manual[open] summary { margin-bottom: var(--s-8); }

/* A plain ruled block: the whose-side lines. */
.block { border-top: var(--hairline); margin: var(--s-32) 0 0; padding-top: var(--s-24); }

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

export /**
 * The only script in the product, and it is entirely optional.
 *
 * It contains no "<" anywhere, deliberately. A "<" inside an inline script is
 * an HTML hazard on its own, and it was also what blinded the voice sweep: a
 * naive tag stripper matching <[^>]+> ran from the "<" in a for-loop all the
 * way to </script>, swallowing every line between and hiding them from every
 * copy rule we have.
 *
 * Everything the tool does works with JavaScript switched off: the form is a
 * plain POST and always will be (design.md §9). This adds three things that
 * only exist when a browser offers them.
 *
 * It never calls prompt() on its own. Chrome's beforeinstallprompt is caught
 * and held, and the install dialog opens only when a farmer clicks the one
 * line inviting him to. That is the difference between an invitation and an
 * interruption, and design.md §10 only forbids the second one.
 *
 * The third thing is the many-photos enhancement on the camera hero. The
 * native input takes one photo (or a gallery multi-select where the OS allows)
 * with no JavaScript at all; this accumulates captures into the same input via
 * DataTransfer, draws the thumbnail row with a retake on each, and holds the
 * four-photo ceiling client-side. The server holds it again either way.
 */
const script = `(function(){
var d=null;
var dt=null;
function redrawShots(inp){
var row=document.getElementById('shots');
if(!row)return;
row.textContent='';
Array.prototype.forEach.call(dt.files,function(f,i){
var s=document.createElement('span');s.className='shot';
var img=document.createElement('img');
img.alt='Page '+(i+1);
if(f.type.indexOf('image/')===0)img.src=URL.createObjectURL(f);
var b=document.createElement('button');
b.type='button';b.className='retake';b.textContent='Retake';
b.addEventListener('click',function(){
var next=new DataTransfer();
Array.prototype.forEach.call(dt.files,function(g,j){if(j!==i)next.items.add(g);});
dt=next;inp.files=dt.files;redrawShots(inp);});
s.appendChild(img);s.appendChild(b);row.appendChild(s);});
row.hidden=dt.files.length===0;
}
document.addEventListener('change',function(ev){
var inp=ev.target;
if(!inp||inp.id!=='photo'||!window.DataTransfer)return;
if(dt===null)dt=new DataTransfer();
Array.prototype.forEach.call(inp.files,function(f){
if(dt.items.length>=4)return;
dt.items.add(f);});
inp.files=dt.files;
redrawShots(inp);
});
addEventListener('beforeinstallprompt',function(e){e.preventDefault();d=e;
var b=document.getElementById('install');if(b)b.hidden=false;});
function beacon(n){try{navigator.sendBeacon&&navigator.sendBeacon('/event',n)}catch(e){}}
if(matchMedia('(display-mode: standalone)').matches){
var f=document.querySelectorAll('input[name="standalone"]');
Array.prototype.forEach.call(f,function(i){i.value='1';});
if(location.pathname==='/')beacon('standalone_launch');}
addEventListener('click',function(ev){
var b=ev.target&&ev.target.closest&&ev.target.closest('#install');
if(!b)return;ev.preventDefault();if(!d)return;
beacon('install_prompt_shown');d.prompt();
d.userChoice.then(function(c){
beacon(c.outcome==='accepted'?'install_accepted':'install_dismissed');d=null;
b.hidden=true;});});
})();`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Footer-linked on every page (spec.md §10). */
const FOOTER_PAGES: Array<[string, string]> = [
  ['/notes/', 'Notes'],
  ['/how-we-figure-it', 'How we figure it'],
  ['/how-we-make-money', 'How we make money'],
  ['/straight-answers', 'Straight answers'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/whos-behind-this', "Who's behind this"],
  ['/contact', 'Contact'],
];

/**
 * The postal address printed in the site footer.
 *
 * Module-level rather than threaded through fifteen render functions. It is a
 * versioned public var with the same value on every request in an isolate, so
 * there is nothing per-request to leak between farmers. The worker sets it
 * once in middleware.
 */
let footerPostalAddress = '';

export function setFooterPostalAddress(value: string): void {
  footerPostalAddress = value;
}

export function shell(title: string, body: string): string {
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
<link rel="manifest" href="/manifest.webmanifest">
<style>${styles}</style>
<script>${script}</script>
</head>
<body>
<main>
  <p class="wordmark"><a href="/">LoanHank</a></p>
  <hr class="wordmark-rule">
  <p class="tagline">Runs the numbers. Takes no side.</p>
${body}
  <footer>
    <nav>${FOOTER_PAGES.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav>
${footerPostalAddress === '' ? '' : `    <address>${escapeHtml(footerPostalAddress)}</address>
`}
    <p>Free tool. Your photo is never saved. Your numbers stay here unless you say go.</p>
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

/**
 * The typed path: four fields plus frequency, a plain no-JS POST (spec.md
 * Decision 2). It renders in three places: inside the manual disclosure on the
 * landing page, as the whole hero when the photo path is off, and inline
 * beside an extraction failure so no farmer meets a dead end without the
 * typing path in view.
 *
 * `entry` names the path for the funnel: 'typed' for the disclosure, and
 * 'recovery' when these fields rescued a failed photo.
 */
function typedForm(
  values: FormValues,
  entry: 'typed' | 'recovery',
  campaign: Record<string, string>,
  fbc: string | null,
): string {
  return `  <form method="post" action="/decode">
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
    <input type="hidden" name="standalone" value="">
    <input type="hidden" name="entry" value="${entry}">
${campaignFields(campaign)}${fbcField(fbc)}    <button type="submit">Run the numbers</button>
  </form>
`;
}

/**
 * The whose-side block. Posture, never the label: canon in design.md §2, and
 * the how-we-make-money link sits beside it because a claimed allegiance and a
 * disclosed angle must always be visible together (design.md §10).
 */
const WHOSE_SIDE = `  <div class="block">
    <p>The dealer's math sells the machine. The lender's math sells the money. This math just shows you the number.</p>
    <p class="note"><a href="/how-we-make-money">How we make money</a></p>
  </div>
`;

/** Screen 1. The tool is the landing page, and the hero is the camera. */
export function renderForm(
  values: FormValues = EMPTY_FORM,
  problems: string[] = [],
  photo: PhotoPath | null = null,
  campaign: Record<string, string> = {},
  fbc: string | null = null,
): string {
  const problemBlock = problems.length === 0
    ? ''
    : `  <div class="problem">
    <p>We could not read a couple of these. Fix them and run it again.</p>
    <ul>${problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul>
  </div>
`;

  // When the photo path is off there is no hero to invert and no disclosure to
  // demote into: the typed form is the whole tool and renders in the open.
  const tool = photo === null || photo.turnstileSiteKey === ''
    ? typedForm(values, 'typed', campaign, fbc)
    : `  <div class="hero">
${cameraHero(photo, campaign, fbc)}    <details class="hero-manual">
      <summary>Type the numbers instead</summary>
${typedForm(values, 'typed', campaign, fbc)}    </details>
  </div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
`;

  return shell('LoanHank', `${problemBlock}  <h1>Point your phone at the dealer's quote. See the number they didn't print.</h1>
  <p>Free, takes about a minute, and your numbers stay here unless you say otherwise.</p>

${tool}${WHOSE_SIDE}`);
}

/**
 * The failure screen for the photo path. The message renders beside the typed
 * fields, not instead of them: a farmer whose photo failed is standing at the
 * desk with the paper in his hand, and the typing path must be in view.
 */
export function renderExtractFailure(
  message: string,
  campaign: Record<string, string> = {},
  fbc: string | null = null,
): string {
  return shell('LoanHank', `  <div class="problem">
    <p>${escapeHtml(message)}</p>
  </div>
${typedForm(EMPTY_FORM, 'recovery', campaign, fbc)}`);
}

/**
 * Campaign labels ride through the form as hidden fields, so a decode can be
 * attributed to the ad that produced it with no cookie and no JavaScript.
 */
function campaignFields(campaign: Record<string, string>): string {
  return Object.entries(campaign)
    .map(([name, value]) => `    <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">
`)
    .join('');
}

/**
 * The Meta click tag, riding a hidden field from landing to POST because there
 * is no cookie and no JavaScript to carry it (spec.md Decision 2). It dies at
 * the sender and never touches a table (spec.md §9.5, §10).
 *
 * The worker withholds it for any request carrying Sec-GPC: 1, so an opted-out
 * browser drops the tag here as well as at the sender. Defence in depth,
 * on purpose.
 */
function fbcField(fbc: string | null | undefined): string {
  if (fbc === null || fbc === undefined || fbc === '') return '';
  return `    <input type="hidden" name="fbc" value="${escapeHtml(fbc)}">
`;
}

/**
 * The camera hero. One full-width button that opens the camera directly: a
 * styled file input with capture="environment", which needs no JavaScript to
 * open a phone camera. A decode accepts up to four photos of the same paper;
 * accumulating captures is the JS enhancement, never the requirement, and the
 * native input alone takes one photo or a gallery multi-select where the OS
 * allows.
 *
 * It renders only when Turnstile is configured, because the upload calls a
 * vision model and every call costs real money. The typed form never depends
 * on any of this: design.md section 9 makes a working no-JS form law, so the
 * challenge lives here and nowhere near it.
 */
function cameraHero(photo: PhotoPath, campaign: Record<string, string>, fbc: string | null): string {
  return `    <form method="post" action="/extract" enctype="multipart/form-data" class="hero-camera">
      <label class="camera-btn" for="photo"><svg class="cam" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.5" y="5" width="17" height="12" rx="1"></rect><path d="M6.5 5l1.5-2.5h4L13.5 5"></path><circle cx="10" cy="11" r="3.25"></circle></svg>Snap the quote</label>
      <input type="file" id="photo" name="photo" class="camera-input" accept="image/jpeg,image/png,application/pdf" capture="environment" multiple required>
      <div id="shots" class="shots" hidden></div>
      <p class="note addmore">Add the next page, or the fine print.</p>
${campaignFields(campaign)}${fbcField(fbc)}      <button type="submit" class="camera-run">Run the numbers</button>
      <div class="cf-turnstile" data-sitekey="${escapeHtml(photo.turnstileSiteKey)}" data-action="extract"></div>
      <p class="note camera-note">Reading your paper takes about 10 seconds. The photo is never saved.</p>
    </form>
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

  return shell('Your ticket · LoanHank', `  <div class="ticket">
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
  /** Present means offer these and nothing else, rather than a free box. */
  choices?: string[];
}

export interface ConfirmView {
  rows: ConfirmRow[];
  frequency: string;
  warnings: string[];
  /** The click tag carried forward, or null when the visit carried none. */
  fbc?: string | null;
  /** How many photos this read came from, carried to the decode event. */
  photoCount?: number;
  /** Campaign labels carried through, spec.md §9.5's four and nothing else. */
  campaign?: Record<string, string>;
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
/**
 * A closed list renders as a select, everything else as a text box.
 *
 * A select can only return what we put in it, which is why `brand` uses one:
 * a dealership name has no path in, rather than a prompt asking politely for a
 * manufacturer and a free box accepting whatever arrives (spec.md 9.5).
 */
function control(row: ConfirmRow): string {
  if (row.choices === undefined) {
    return `      <input type="text" id="${row.name}" name="${row.name}" inputmode="decimal" value="${escapeHtml(row.value)}">`;
  }
  const options = row.choices
    .map((choice) => `<option value="${escapeHtml(choice)}"${choice === row.value ? ' selected' : ''}>${escapeHtml(choice)}</option>`)
    .join('');
  return `      <select id="${row.name}" name="${row.name}">
        <option value="">Not listed</option>
        ${options}
      </select>`;
}

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
${control(row)}
${row.hint ? `      <p class="note">${escapeHtml(row.hint)}</p>
` : ''}    </div>`;
  };

  return shell('Check these · LoanHank', `${warningBlock}  <h1>Check these against your paper. Fix anything we got wrong.</h1>
  <p>Your photo is gone already. It was read and never saved.</p>

  <form method="post" action="/decode">
    <input type="hidden" name="ledger" value="1">
    <input type="hidden" name="extracted" value="${extractedSnapshot(view)}">
    <input type="hidden" name="photoCount" value="${view.photoCount ?? 1}">
${campaignFields(view.campaign ?? {})}${fbcField(view.fbc)}
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
    <input type="hidden" name="standalone" value="">
    <button type="submit">Looks right — run it</button>
  </form>
`);
}

/**
 * Disclosed before the address is typed, which is the only moment a
 * disclosure can honestly be made. Versioned, and stored on the row, because a
 * follow-up sent against a row with no version recorded is a follow-up we
 * cannot prove was disclosed.
 */
export const FOLLOWUP_DISCLOSURE =
  "We'll follow up once about your deal, and when the numbers for deals like yours change. "
  + 'Unsubscribe anytime.';
export const FOLLOWUP_TEXT_VERSION = 'v1 (2026-08-16)';

export interface EmailGate {
  decodeId: string;
}

/**
 * Gate 1, rendered under the ticket as its own quiet block. Never a modal,
 * never a popup, and never before the farmer has his answer: value before
 * email is the whole religion.
 *
 * It renders only when a teardown can actually be sent. The copy promises a
 * PDF, and promising one we cannot deliver is the same class of error as
 * printing a number we cannot stand behind.
 */
function emailGateBlock(gate: EmailGate | null, fbc: string | null = null): string {
  if (gate === null) return '';
  return `
  <div class="gate no-print">
    <h2>Want the full teardown as a PDF?</h2>
    <p>We'll email it. That's all we use your email for.</p>
    <p class="note">${escapeHtml(FOLLOWUP_DISCLOSURE)}</p>
    <form method="post" action="/email">
      <input type="hidden" name="decodeId" value="${escapeHtml(gate.decodeId)}">
${fbcField(fbc)}
      <div class="field">
        <label for="email">Your email</label>
        <input type="email" id="email" name="email" inputmode="email" autocomplete="email" required>
      </div>
      <button type="submit">Send me the teardown</button>
    </form>
  </div>
`;
}

/**
 * Gate 2, Phase A (spec.md §8). A NON-BINDING interest question, and nothing
 * else.
 *
 * The wording is spec's, verbatim, and it is not paraphrasable. Read what it
 * carefully is not: it does not ask permission, it does not mention consent,
 * it does not say a lender will call, and answering Yes moves nothing
 * anywhere. It measures intent, not permission, and it is not brokering
 * because nothing moves.
 *
 * The real consent button ships only after the lawyer stones clear (Phase C).
 * Until then the word consent appears nowhere near this, because a farmer who
 * thought he had consented to something would have been misled by us.
 *
 * Both answers are equal-weight buttons. No gray shame text on the decline.
 */
function interestBlock(gate: EmailGate | null, fbc: string | null = null): string {
  if (gate === null) return '';
  return `
  <div class="gate no-print">
    <h2>If an independent equipment lender could quote this deal, would you want to hear from one?</h2>
    <p class="note">Nothing moves either way. We are asking whether this would be worth building. Your numbers stay here regardless of which button you press.</p>
    <form method="post" action="/interest">
      <input type="hidden" name="decodeId" value="${escapeHtml(gate.decodeId)}">
${fbcField(fbc)}
      <button type="submit" name="answer" value="yes">Yes</button>
      <button type="submit" name="answer" value="not_now" class="secondary">Not now</button>
    </form>
    <p class="note"><a href="/how-we-make-money">How we make money</a></p>
  </div>
`;
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
  gate: EmailGate | null;
  /**
   * The click tag carried forward into the gate forms. NOT part of the gate
   * object: the firewall test pins the gate to exactly the decode id, and the
   * tag is measurement plumbing, not something the gate is told.
   */
  fbc?: string | null;
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

  return shell('Your ticket · LoanHank', `  <div class="ticket">
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
  }${emailGateBlock(view.gate, view.fbc ?? null)}${interestBlock(view.gate, view.fbc ?? null)}  <p class="no-print"><a href="/">Run another quote</a></p>
`);
}

/** Plain confirmations. One line, on voice, nothing to click. */
export function renderNotice(heading: string, body: string): string {
  return shell(`${heading} · LoanHank`, `  <h1>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(body)}</p>
  <p class="no-print"><a href="/">Back to the tool</a></p>
`);
}
