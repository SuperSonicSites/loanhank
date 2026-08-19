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

/* The Turnstile widget is a fixed 300px and cannot be told to be narrower.
   On a 320px phone the 16px gutters leave 288px for it, and the page gains a
   horizontal scrollbar nobody can get rid of. Tighten the gutter rather than
   clip or scale the widget: the challenge has to stay whole and tappable, and
   an iPhone SE is the screen design.md sizes the fold against. */
@media (max-width: 339px) {
  main, .banner-lockup { padding-left: var(--s-8); padding-right: var(--s-8); }
}

/* Lockup 2 off the brand card: the full lockup at 28px, paper on ink. The band
   runs the full width of the screen and the lockup inside it holds the column,
   so the wordmark still lines up with the first letter of the H1. The rule runs
   the width of the word, never the width of the column (design.md section 7). */
.banner { background: var(--ink); }
.banner-lockup { max-width: var(--col-max); margin: 0 auto; padding: var(--s-16); }
.wordmark { font-weight: 900; font-size: var(--text-h1); letter-spacing: -0.02em; text-transform: uppercase; line-height: 1.1; margin: 0; }
.wordmark a { color: var(--paper); text-decoration: none; }
.wordmark-rule { border: 0; border-top: 1px solid var(--paper); width: 172px; margin: var(--s-4) 0; }
.tagline { font-size: var(--text-footnote); color: var(--rule); margin: 0; }

h1 { font-weight: 700; font-size: var(--text-h1); line-height: 1.3; margin: 0 0 var(--s-16); }
/* The subhead under the H1. A heading by structure, body type by weight: it
   carries the offer in plain words and must not compete with the headline. */
.subline { font-weight: 400; font-size: var(--text-body); line-height: var(--lh-body); margin: 0 0 var(--s-24); }
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
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  background: var(--ink);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: 700;
  cursor: pointer;
}
.secondary {
  background: var(--paper); color: var(--ink); border: 2px solid var(--ink);
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
.progress { order: 8; }
.wait { order: 9; }
@media (min-width: 700px) {
  .hero-manual { order: 0; }
}

/* One submit at a time. Both forms carry the canonical "Run the numbers"
   label, and with the disclosure open the two land next to each other reading
   as two identical buttons on one screen. Opening the disclosure is the
   farmer choosing the typing path, so the photo path's submit, its challenge
   widget and its note step aside until he closes it again.

   :has() rather than a sibling combinator, because display:contents flattens
   the camera form's BOXES and not the DOM: .camera-run is a child of the
   form, never a sibling of the disclosure. Where :has() is unsupported both
   buttons show, which is the behaviour this replaces rather than a new one. */
.hero:has(.hero-manual[open]) .camera-run,
.hero:has(.hero-manual[open]) .cf-turnstile,
.hero:has(.hero-manual[open]) .camera-note { display: none; }

/* The camera hero: a styled file input. The label is the big box; the input
   is visually hidden but still focusable, so validation and keyboards keep
   working. capture="environment" opens a phone camera with no JavaScript.
   The camera glyph is the only icon in the product (design.md section 6).

   Transparent, outlined in ink: the box reads as a target to put a photo
   INTO, and the filled ink button below it stays the one action. Two solid
   ink blocks stacked read as two competing buttons. */
.camera-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--s-8);
  width: 100%; min-height: 96px; padding: var(--s-16);
  background: transparent; color: var(--ink);
  border: 2px solid var(--ink); border-radius: var(--radius);
  font-size: var(--text-body); font-weight: 700; cursor: pointer;
  margin: 0 0 var(--s-8);
}
.camera-btn .cam { width: 32px; height: 32px; }
/* Visually hidden, still focusable and still the thing that opens the camera.
   The selector names the type as well as the class on purpose: input[type=
   "file"] above is more specific than a bare class, so it won that fight and
   kept width:100% here. An absolutely positioned element is sized against the
   nearest positioned ancestor, .hero-camera is display:contents and generates
   no box, and nothing else on the page is positioned, so 100% resolved
   against the VIEWPORT and sat at the column's static offset: 649px of
   horizontal scroll on a wide screen. clip-path hides the paint, never the
   layout. Every inherited box property is zeroed for the same reason. */
input[type="file"].camera-input {
  position: absolute; width: 1px; height: 1px;
  min-height: 0; padding: 0; border: 0; margin: -1px;
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
  background: var(--paper); color: var(--ink); border: 1px solid var(--ink);
  font-weight: 400; font-size: var(--text-footnote);
}

/* THE ONLY MOTION IN THE PRODUCT (design.md section 6): one thin denim line,
   crawling while the model reads the paper. Denim because the ruling on
   2026-08-18 kept exactly three things blue and this is one of them.

   Indeterminate on purpose. A percentage would be a lie: nothing on this page
   knows how far through a vision call it is, and a bar that sits at 90% for
   six seconds teaches a farmer that our numbers are decorative. It crawls to
   say "working", and it says the rest in words underneath.

   Both elements ship hidden. With JavaScript off nothing reveals them, which
   is the point: a farmer who never gets the enhancement never sees a bar that
   cannot move, and the form still posts (design.md section 9). */
.progress { height: 2px; margin: var(--s-12) 0 var(--s-4); background: var(--rule); overflow: hidden; }
.progress::after {
  content: ""; display: block; height: 100%; width: 40%;
  background: var(--denim);
  animation: crawl 1.8s linear infinite;
}
@keyframes crawl { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
/* Reduced motion still has to say "working". The line stays and stops moving,
   rather than disappearing and leaving the words on their own. */
@media (prefers-reduced-motion: reduce) {
  .progress::after { width: 100%; animation: none; }
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

/* The footer is the same band as the header, the same class, so the two can
   never drift apart. Main's own bottom padding is the gap above it, and the
   band runs to the edge of the screen the way the header does. Links in paper,
   the trust line and the address in rule, mirroring wordmark and tagline. */
footer p { font-size: var(--text-footnote); color: var(--rule); margin: 0; }
footer address { font-style: normal; font-size: var(--text-footnote); color: var(--rule); margin: 0 0 var(--s-8); }
footer nav { font-size: var(--text-footnote); margin: 0 0 var(--s-8); }
footer nav a { margin-right: var(--s-12); color: var(--paper); }

a { color: var(--denim); }
/* Both bands are ink, so a browser's default focus ring lands black on black.
   Paper is the only ring that can be seen on either one. */
.banner a:focus-visible { outline: 2px solid var(--paper); outline-offset: 2px; }

/* The printout negotiates for the farmer at the dealer desk. It is the best
   marketing this product will ever ship, so it prints like a shop ticket. */
@media print {
  body { background: #FFF; color: #000; font-size: 12pt; }
  main { max-width: none; padding: 0; }
  .no-print, form, footer { display: none; }
  .banner { background: transparent; }
  .banner-lockup { padding: 0; }
  .banner .wordmark a, .banner .tagline { color: #000; }
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
 * The fourth thing is the wait state on the photo path. That POST holds a
 * vision call open for about ten seconds, and a farmer staring at a button
 * that did nothing taps it again, which buys a second model call with real
 * money. So the submit disables its own button, hides the pre-submit note and
 * reveals the crawling line with the canonical wait words under it.
 *
 * The disable is deferred a tick on purpose. A submit button disabled inside
 * its own handler drops its name and value from the body the browser is still
 * assembling, and the consent screen posts answer=yes on exactly that.
 *
 * pageshow puts it all back, because bfcache restores this page from the back
 * button exactly as it left: button dead, line crawling, form unusable.
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
addEventListener('submit',function(ev){
var f=ev.target;if(!f||!f.querySelector)return;
var b=f.querySelector('button[type="submit"]');
if(b)setTimeout(function(){b.disabled=true;},0);
if(!f.className||f.className.indexOf('hero-camera')===-1)return;
var n=f.querySelector('.camera-note');if(n)n.hidden=true;
var p=f.querySelector('.progress');if(p)p.hidden=false;
var w=f.querySelector('.wait');if(w)w.hidden=false;
});
addEventListener('pageshow',function(){
Array.prototype.forEach.call(document.querySelectorAll('button[disabled]'),function(x){x.disabled=false;});
Array.prototype.forEach.call(document.querySelectorAll('.progress,.wait'),function(x){x.hidden=true;});
Array.prototype.forEach.call(document.querySelectorAll('.camera-note'),function(x){x.hidden=false;});
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
  // Title Case verbatim: the statute writes the phrase this way and design.md
  // §2 exempts this one string from sentence case rather than tidying it.
  ['/do-not-sell', 'Do Not Sell or Share My Personal Information'],
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
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<style>${styles}</style>
<script>${script}</script>
</head>
<body>
<header class="banner">
  <div class="banner-lockup">
    <p class="wordmark"><a href="/">LoanHank</a></p>
    <hr class="wordmark-rule">
    <p class="tagline">Runs the numbers. Takes no side.</p>
  </div>
</header>
<main>
${body}
</main>
<footer class="banner">
  <div class="banner-lockup">
    <nav>${FOOTER_PAGES.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav>
${footerPostalAddress === '' ? '' : `    <address>${escapeHtml(footerPostalAddress)}</address>
`}
    <p>Free tool. Your photo is never saved. Your numbers stay here unless you say go.</p>
  </div>
</footer>
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
 * The disclosed angle on the front door. The whose-side sentence that sat above
 * this link was removed by owner ruling 2026-08-18; the link stays, because a
 * disclosed angle belongs on the page that carries the tool (design.md §10).
 */
const MONEY_LINK = `  <div class="block">
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

  return shell('LoanHank', `${problemBlock}  <h1>0% isn't 0%. Snap the quote and see the real rate.</h1>
  <h2 class="subline">Take a picture of the dealer's quote and we'll show you the number they didn't print. It's free, secured, we do not keep a copy of it and you get the truth about your quote.</h2>

${tool}${MONEY_LINK}`);
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
      <div class="progress" hidden aria-hidden="true"></div>
      <p class="note wait" role="status" hidden>Reading your paper… about 10 seconds.</p>
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

/**
 * Screen 3, abstaining. We could not price it, so we say that, and the typed
 * fields render beneath the message the way they do beside a photo failure:
 * the retry is right there, and it carries the campaign labels and the click
 * tag forward. A farmer who hit this screen, fixed his numbers, and completed
 * used to fire as not_from_ad, which undercounted ad-attributed decodes and
 * inflated cost per decode, the number §7.1's wall depends on.
 */
export function renderUnpriceable(
  reason: string,
  campaign: Record<string, string> = {},
  fbc: string | null = null,
): string {
  return shell('LoanHank', `  <div class="problem">
    <p>${escapeHtml(reason)}</p>
  </div>
${typedForm(EMPTY_FORM, 'recovery', campaign, fbc)}`);
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
function emailGateBlock(gate: EmailGate | null): string {
  if (gate === null) return '';
  return `
  <div class="gate no-print">
    <h2>Want the full teardown as a PDF?</h2>
    <p>We'll email it. That's all we use your email for.</p>
    <p class="note">${escapeHtml(FOLLOWUP_DISCLOSURE)}</p>
    <form method="post" action="/email">
      <input type="hidden" name="decodeId" value="${escapeHtml(gate.decodeId)}">
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
function interestBlock(gate: EmailGate | null): string {
  if (gate === null) return '';
  return `
  <div class="gate no-print">
    <h2>If an independent equipment lender could quote this deal, would you want to hear from one?</h2>
    <p class="note">Nothing moves either way. We are asking whether this would be worth building. Your numbers stay here regardless of which button you press.</p>
    <form method="post" action="/interest">
      <input type="hidden" name="decodeId" value="${escapeHtml(gate.decodeId)}">
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
  }${emailGateBlock(view.gate)}${interestBlock(view.gate)}  <p class="no-print"><a href="/">Run another quote</a></p>
`);
}

/** Plain confirmations. One line, on voice, nothing to click. */
export function renderNotice(heading: string, body: string): string {
  return shell(`${heading} · LoanHank`, `  <h1>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(body)}</p>
  <p class="no-print"><a href="/">Back to the tool</a></p>
`);
}
