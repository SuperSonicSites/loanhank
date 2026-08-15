// Rebuild the design bundle's example figures from design.md canon.
//
//     node design/_sweep-from-canon.mjs
//
// SCOPE OF design/. The bundle is the visual system and nothing else: tokens,
// type, colour, spacing, and component anatomy. It carries no copy authority
// and no arithmetic authority. Copy lives in design.md §2 and §2½; figures
// live in design.md §2¾ canon, which is itself engine output. When the Claude
// Design app re-exports a card, run this, then run
// `pnpm test tests/design-canon.test.ts` before merging.
//
// This exists because the first bundle shipped carrying figures canon had
// already retired: $2,347, $86,847, 7.9% against a 6.5% reference, a
// "$75,000 to $100,000" band that is not on the AgDirect card, and "rate cards
// stop at 72 months" when the card runs to 84. A blunt string sweep was not
// enough either: the numbers sit inside <span class="num"> tags and the prose
// around them was wrong in its own right, quoting a basis-point delta that
// belonged to neither example. So the two cards that carry worked figures are
// generated whole.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const canonText = readFileSync(new URL('../docs/design.md', import.meta.url), 'utf8');

const canon = new Map();
const block = canonText.slice(
  canonText.indexOf('<!-- canon:start -->'),
  canonText.indexOf('<!-- canon:end -->'),
);
for (const match of block.matchAll(/^- `([a-z0-9._]+)`:\s*(.+?)\s*$/gm)) {
  canon.set(match[1], match[2]);
}
const need = (key) => {
  const value = canon.get(key);
  if (!value) throw new Error(`design.md canon is missing ${key}`);
  return value;
};

const bps = (rate) => Math.round(Number(rate.replace('%', '')) * 100);
const deltaA = bps(need('a.real_rate')) - bps(need('a.published_rate'));
const deltaB = bps(need('b.real_rate')) - bps(need('b.published_rate'));
const under = (delta) => `${Math.abs(delta)}</span> basis points ${delta < 0 ? 'under' : 'over'}`;

const num = (value) => `<span class="num">${value}</span>`;

const header = (sheet) => `
</head>
<body>
<main data-screen-label="${sheet} card">
<header class="wmrow"><span class="wm">LOANHANK</span>
<div class="fields">
<div class="fld"><span class="lab">SHEET</span><span class="val">${sheet}</span></div>
<div class="fld"><span class="lab">REV</span><span class="val">B</span></div>
<div class="fld"><span class="lab">DATE</span><span class="val">8/2026</span></div>
</div>
</header>`;

const footer = `
<p class="note">Figures on this sheet are design.md §2¾ canon, which is engine output. Do not edit them here; edit the engine or the canon block and re-run <code>design/_sweep-from-canon.mjs</code>.</p>
</main>
</body>
</html>
`;

const verdictBody = `${header('verdict')}
<section>
<h2><span class="n">1</span> CHECKS OUT</h2>
<div><span class="stamp st-good">CHECKS OUT</span></div>
<p class="verdict">${need('a.line')}</p>
<p class="ref">Comparable published equipment rate ${num(need('a.published_rate'))}, subject to approval. You are <span class="num">${under(deltaA)}. ${need('a.published_source')}, ${need('a.published_amount_band')}, ${need('a.published_band')}, fixed, as of ${need('a.published_as_of')}.</p>
<p class="note">This example blesses the dealer's promo and stays canonical for that reason. A tool that never says take the deal is a tool nobody believes.</p>
</section>
<section>
<h2><span class="n">2</span> LOOK CLOSER</h2>
<div><span class="stamp st-caution">LOOK CLOSER</span></div>
<p class="verdict">${need('b.line')}</p>
<p class="ref">Comparable published equipment rate ${num(need('b.published_rate'))}, subject to approval. You are <span class="num">${under(deltaB)}. AgDirect, ${need('b.published_amount_band')}, ${need('b.published_band')}, fixed, as of ${need('a.published_as_of')}.</p>
</section>
<section>
<h2><span class="n">3</span> No verdict. No stamp.</h2>
<p class="verdict">No verdict yet. Here's what's missing.</p>
<p>Term on your quote: ${num('96 months')}. Published rate cards for this equipment stop at ${num('84 months')}. There is no comparable rate, and we won't guess one.</p>
<p class="note">An abstention is not a third stamp. No stamp, no grey badge, no neutral chip. The absence of the stamp is the message, and the words carry it.</p>
</section>
<section>
<h2><span class="n">4</span> Anatomy</h2>
<p class="note">Stamp: mono caps, 24px, 0.08em tracking, 3px border, 2px radius, rotated -1.5deg. Field green on field-fill for CHECKS OUT, amber ink on amber-fill for LOOK CLOSER. Two stamps exist and there will never be a third. Colour never carries the verdict alone: stamp shape and words carry it too.</p>
</section>${footer}`;

const receiptBody = `${header('receipt')}
<section>
<h2><span class="n">1</span> The ticket. This table is the product.</h2>
<p class="rate-label">Your real rate</p>
<p class="rate">${need('a.real_rate')}</p>
<table>
<tr><td>Quoted price</td><td class="num">${need('a.quoted_price')}</td></tr>
<tr><td>Cash discount</td><td class="num">&minus; ${need('a.cash_discount')}</td></tr>
<tr><td>Cash price today</td><td class="num">${need('a.cash_price')}</td></tr>
<tr><td>Total of payments</td><td class="num">${need('a.total_of_payments')}</td></tr>
<tr class="total"><td>What financing costs</td><td class="num">${need('a.cost_versus_cash')}</td></tr>
</table>
<p class="ref">The published rate for this band is ${num(need('a.published_rate'))}<sup>1</sup>, subject to approval.</p>
<p class="ref">Quotes like yours carry a median of ${num('M.MM%')}<sup>2</sup>, ${num('n=NN')}.</p>
<p class="note"><sup>1</sup> ${need('a.published_source')} published equipment rate card, ${need('a.published_amount_band')} band, ${need('a.published_band')} term, as of ${need('a.published_as_of')}.<br>
<sup>2</sup> Placeholder, not canon. No pile exists yet, so there is no median and no n. The peer row does not render at all until a cohort reaches twenty, and it always prints its own n.</p>
</section>
<section>
<h2><span class="n">2</span> Anatomy</h2>
<p class="note">Labels left in Libre Franklin. Values right-aligned in Courier Prime 16px, ink, always to the dollar. The minus is a real minus, aligned in the mono column. Hairline rule between every line, double rule above the total. No zebra striping, no header fill, no cell borders, no card, no shadow, no rounded wrapper.</p>
<p class="note">Print: black on white, same rules, stamp included. The printout is what the farmer carries back to the dealer desk, and it is the best marketing this product will ever ship.</p>
</section>${footer}`;

function rebuild(relative, body) {
  const path = `${here}${relative}`;
  const text = readFileSync(path, 'utf8');
  const cut = text.indexOf('</head>');
  if (cut === -1) throw new Error(`${relative} has no </head>`);
  writeFileSync(path, text.slice(0, cut) + body);
  console.log(`regenerated ${relative}`);
}

rebuild('guidelines/Verdict.html', verdictBody);
rebuild('guidelines/Receipt.html', receiptBody);

// The remaining cards use figures only as type specimens. Those become neutral
// placeholders: a specimen that looks like a real median gets quoted as one.
const PLACEHOLDERS = [
  ['7.9%', need('a.real_rate')],
  ['$2,347', need('a.cost_versus_cash')],
  ['$86,847', need('a.total_of_payments')],
  ['6.5%', need('a.published_rate')],
  ['n=143', 'n=NN'],
  ['7.4%', 'M.MM%'],
];
for (const name of readdirSync(new URL('guidelines/', import.meta.url))) {
  if (!name.endsWith('.html') || name === 'Verdict.html' || name === 'Receipt.html') continue;
  const path = `${here}guidelines/${name}`;
  let text = readFileSync(path, 'utf8');
  const before = text;
  for (const [from, to] of PLACEHOLDERS) text = text.split(from).join(to);
  if (text !== before) {
    writeFileSync(path, text);
    console.log(`swept guidelines/${name}`);
  }
}
