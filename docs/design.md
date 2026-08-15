# HANK DESIGN DOC — SHOP TICKET, NOT DASHBOARD

Companion to DECODER_MASTER_PROMPT.md. This doc = how it looks, sounds, feels. Carve once, obey everywhere.

---

## 1. PHILOSOPHY

One sentence: **Hank hands farmer a shop ticket, like the repair shop does. Not a dashboard, not an app, not a pitch.**

Farmer trusts: work orders, receipts, parts invoices, extension PDFs, the Fed's ugly tables, Machinery Pete. Farmer smells and flees: SaaS gradients, stock-photo farmers in clean overalls, dashboards, confetti, chat widgets, anything that moves.

**North star sentence: looks like one stubborn number-guy built it in 2009 and has maintained it lovingly since.** Reference the real trusted uglies: Machinery Pete's site, AgTalk, DTN screens, auction sale bills. Dense, plain, a little dated, opinionated. The AI look is the opposite: airy, tasteful, frictionless, perfectly consistent, characterless. When a screen starts feeling like a slick mock, it is drifting toward robot. Add ink.

**The eight tests. Every screen passes all eight or screen not ship:**

1. **SUNLIGHT TEST** — readable on phone, noon, dealer lot, glare. Light background, big ink, high contrast.
2. **GLOVE TEST** — every tap target hits with work gloves. 48px minimum. Fat fields.
3. **RECEIPT TEST** — every number itemized, sourced, dated. No number without a line. No claim without an n.
4. **NEIGHBOR TEST** — result so clear farmer screenshots it and texts neighbor. The screen IS the ad.
5. **NOTHING MOVES** — no animation except one progress line during extraction. Motion = marketing smell.
6. **WORST NEWS IS AMBER** — never red anywhere. Red = shame = closed tab. Doctrine from old cave, keep forever.
7. **SAY-IT-PLAIN TEST** — every word survives being read aloud at a coffee shop table without embarrassment.
8. **MADE-BY-A-GUY TEST** — would a farmer guess a person built this, or a robot? Airy whitespace, friendly rounded corners, perfect symmetry, snappy parallel copy = robot. Density, rules, square shoulders, plain talk = person.

---

## 2. TONE — HANK VOICE

Hank = the neighbor who's good with numbers. Not mascot. Not cartoon. A voice.

**Rules:**
- Short sentences. Plain words. Sixth-grade reading, expert-grade numbers.
- Numbers to the dollar. "$2,347" never "~$2.3K".
- Never exclamation marks. Never "unlock," "supercharge," "empower," "journey," "seamless."
- Every figure carries source + date. "Chicago Fed, Q1 2026" in small type under the number.
- Hank says "we don't know" when we don't know. Hank shows n or shows nothing.
- **Hank sometimes says the dealer's deal is good. This is the most important sentence Hank can say.** Neutrality is the brand. One dishonest nudge = dead.
- Second person, direct: "Your real rate." "You'd pay." Never "users," never "customers."

**Anti-robot writing stones (AI copy has a rhythm; break it):**
- **No em dashes in product copy.** Comma, period, or new sentence.
- **No staccato triads** ("Free. Fast. Private."). Robot drumbeat. Write like talking: "Free, takes about a minute, and your numbers stay here unless you say otherwise." Ban is on prose rhythm, not on enumeration. A spec table cell is a list of jobs, not a sentence read aloud, so cells are exempt.
- **No "It's not X. It's Y."** No "Here's the thing." No "Let's be honest." All robot tells.
- **Sentence case everywhere.** Title Case Headlines Are A Tell.
- Perfectly parallel sentence pairs sparingly. A little lopsidedness reads human.
- **Never improve this doc's own wording.** Where a line here is clipped, lopsided, or ungrammatical, copy it verbatim. The awkwardness is the texture. "page background. warm off-white. kills glare, feels print" is correct; "Warm off-white, kills glare, feels like print" is the same content smoothed into a triad, and the smoothing is the drift. Anything building from this doc will feel the pull to tidy. Tidy is the tell.

**Microcopy (canonical, use these):**

| moment | words |
|---|---|
| primary button | `Run the numbers` |
| photo button | `Snap the quote instead` |
| extraction wait | `Reading your paper… about 10 seconds.` |
| confirm screen header | `Check these against your paper. Fix anything we got wrong.` |
| good verdict | `This deal checks out. We'd take it.` |
| amber verdict | `Look closer. This deal prices at X%. The comparable published rate is Y%. The difference costs you $Z over the term.` (figures from the engine, never typed; see §2¾) |
| email gate | `Want the full teardown as a PDF? We'll email it. That's all we use your email for.` |
| consent gate | `Want lenders to compete for this deal? You say go. Nothing moves without you.` |
| consent decline | `No thanks — my numbers stay here.` (equal-weight button, not gray shame text) |
| blurry photo | `Too blurry to read. Try again in better light.` |
| footer trust line | `Free tool. Photo deleted after reading. Nothing leaves here unless you say go.` |

---

## 2½. SALES COPY DOCTRINE — KENNEDY MECHANICS, HANK VOICE

Dan Kennedy rules, spoken through Hank's mouth. Direct response only. Every word sells or gets cut.

1. **ENTER THE ARGUMENT ALREADY IN HIS HEAD.** Kennedy's first law: join the conversation the prospect is already having with himself. We own the transcript of that conversation — the research file. He is already saying "0% is never really 0%," "they play games with the numbers," "it's never on the ticket." Copy never teaches a new idea. Copy agrees with him, then hands him the weapon. Steal his exact phrases from the corpus. He wrote our copy already.

2. **HEADLINE IS 80% OF THE WORK.** Write 25, ship 1, test weekly. Allowed formulas: warning (`Before you sign that 0% deal...`), question he answers yes to (`Did the dealer tell you the real rate?`), specific-number (`The $2,347 hiding in a $28,000 tractor quote`). Test headlines, never button colors.

3. **SPECIFICITY STONE.** $2,347 beats "thousands." n=143 beats "many farmers." Odd exact number beats round number: round smells like marketing, exact smells like math. Kennedy: specificity IS believability. We are a math company. This weapon is free for us — use it in every line.

4. **REASON-WHY EVERYTHING — especially why free.** Nobody believes free. Damaging admission, stated plain: `This tool is free because some farmers later ask us to make lenders compete for their deal, and lenders pay us for that introduction. That is the whole business. Now you know our angle.` Kennedy: own the skeptic's objection before he raises it. Our transparency IS the Kennedy admission — two doctrines, one move.

5. **NOBODY BELIEVES YOU. STACK PROOF.** Default assumption: he thinks we're lying. Every claim carries source + date, or n, or a demonstration he can run himself. Testimonials when they come: full name, town, operation — with permission — or don't run it. "J.D. from Iowa" smells fake because it is.

6. **OFFER BEATS COPY.** Never sell "try our tool." Sell a THING he can hold: **The Teardown** — one-page ticket, real rate, real cost, his quote against 143 real ones. Named, printable, carried back to the dealer desk. Kennedy: the offer is the hero; copy just carries it.

7. **ONE ACTION PER PIECE.** Ad → run the numbers. Ticket → get the PDF. PDF → say go, or go sign the deal. Never two asks in one piece, ever.

8. **REAL DEADLINES ONLY.** Kennedy demands a deadline; we never invent one. Ours are printed on the dealer's own paper: "quote valid until 8/31," promo end dates, December 31 Section 179. `Your quote expires in 9 days. Worth knowing what it really costs before then.` His deadline, our urgency. Countdown timers = slop = dead.

9. **TAKEAWAY SELLING.** We are not for everyone and say so: `If your deal checks out, we'll say so, and you should go sign it.` Refusing to sell is the strongest sell. Also true, which is why it works twice.

10. **EMOTION FIRST, MATH TO JUSTIFY.** The emotion is not fear — fear is banned with red. The emotion is SHREWDNESS: the pride of the operator nobody gets one past. Farmer is the hero who checked. Dealer is not the villain, just the other side of the table. Copy makes him feel sharp, never stupid. Never "you're being ripped off." Always "you'd be the one who checked."

11. **LONG COPY LIVES WHERE INTEREST LIVES.** Landing stays a 60-second tool. The teardown PDF and the emails run long — Kennedy: no such thing as too long, only too boring. Every paragraph earns the next one or dies.

12. **P.S. ALWAYS.** Every email ends with a P.S. Most-read line after the subject. The P.S. carries one number: `P.S. Median rate on used tractors this quarter: 7.4%. If your quote starts with an 8, run it through.`

13. **SEQUENCE, NOT SHOT.** Money is in the follow-up. Three steps after the teardown: Day 0 the ticket. Day 4 `Did you take the deal? Here's what changed since.` Day 30 fresh cohort median. Then quarterly, forever. One ask per step.

14. **MEASURE OR DEAD.** Direct response only, no brand advertising ever — brand is the exhaust of direct response that works. Every piece owns ONE number. Winners live, losers die weekly. Feelings do not vote.

**Canonical ad (Meta, v1):**
- Image: real quote photo, amber grease-pencil circle on "0% FINANCING."
- Headline: `0% financing isn't 0%.`
- Body: `That $3,000 "cash discount" you give up? That's the interest, wearing a different hat. Free tool reads your quote and shows the real rate. Takes about a minute. If the deal's good, we'll tell you that too.`
- CTA: `Run the numbers`

---

---

## 2¾. CANONICAL EXAMPLES

Every figure below is engine output. **None of it may be typed by hand, including by the owner of this document.** The first version of the amber verdict line in §2 was written by hand and was wrong: it printed the total of payments minus the *quoted* price and called it the cost against the *cash* price. Against the cash price the same deal is $8,347, not $2,347. A wrong number in canon propagates into every ticket, ad and email that copies it.

`tests/design-canon.test.ts` runs these two deals through `src/finance/` and fails if anything below drifts from what the engine says. Change a figure here and the test breaks. Change the engine and the test tells you which line of this document to update.

<!-- canon:start -->

### Example A — CHECKS OUT

An $84,500 quote with a $6,000 cash discount, taken at the dealer's "0%" over 60 monthly payments. The ledger is complete: no trade, no down payment, no fees, all confirmed by the farmer, and the payments reconcile against the financed amount.

- `a.quoted_price`: $84,500
- `a.cash_discount`: $6,000
- `a.payment`: $1,408.33
- `a.payment_count`: 60
- `a.payment_frequency`: monthly
- `a.cash_price`: $78,500
- `a.total_of_payments`: $84,500
- `a.cost_versus_cash`: $6,000
- `a.real_rate`: 2.94%
- `a.published_rate`: 7.25%
- `a.published_band`: 5 years
- `a.published_source`: AgDirect
- `a.published_as_of`: 2026-08-01
- `a.published_amount_band`: $25,000-$99,999
- `a.verdict`: CHECKS OUT
- `a.line`: This deal checks out. We'd take it.
- `a.reference`: Comparable published equipment rate: 7.25%, subject to approval. AgDirect, $25,000-$99,999, 5 years, fixed, as of 2026-08-01.

**This example blesses the dealer's promo, and it stays canonical for that reason.** The 0% costs $6,000 against paying cash, and 2.94% is still far under the 7.25% an independent lender publishes for this size and term. A farmer reading it should go sign. A tool that never says that is a tool nobody believes, so the neutrality proof lives here in permanent view rather than in a promise about our intentions.

### Example B — LOOK CLOSER

Used equipment, $62,000 financed at a stated 9.9% over 48 monthly payments, no cash discount offered.

- `b.amount_financed`: $62,000
- `b.stated_rate`: 9.90%
- `b.payment`: $1,569.50
- `b.payment_count`: 48
- `b.payment_frequency`: monthly
- `b.total_of_payments`: $75,336
- `b.real_rate`: 9.90%
- `b.published_rate`: 7.25%
- `b.published_band`: 4 years
- `b.published_total`: $71,610
- `b.difference`: $3,726
- `b.published_amount_band`: $25,000-$99,999
- `b.verdict`: LOOK CLOSER
- `b.line`: Look closer. This deal prices at 9.90%. The comparable published rate is 7.25%. The difference costs you $3,726 over the term.

<!-- canon:end -->

The reference line prints the matched band's own bounds, not just the rate. The matching discipline is the part a reader can check: a $78,500 quote over five years is compared against the $25,000-$99,999 five-year row and nothing else, and printing the band is what makes that visible rather than merely true.

Both examples carry "subject to approval" beside the published rate wherever they appear in product, per spec.md §3. Neither is a promise of a rate any farmer will be offered.

---

## 3. COLOR

Warm paper + ink + workwear. No gradient anywhere, ever.

| token | hex | job |
|---|---|---|
| `paper` | `#F7F5EF` | page background. warm off-white. kills glare, feels print |
| `ink` | `#191813` | all body text, all numbers. warm near-black |
| `ink-soft` | `#57534A` | secondary text, sources, dates |
| `rule` | `#D8D4C8` | hairlines, borders, receipt rules |
| `denim` | `#2F5D8A` | primary buttons, links. desaturated steel blue — chore coat, not SaaS |
| `field` | `#3F7A34` | good-verdict stamp + chip only |
| `field-fill` | `#E4EDDC` | good-verdict chip background |
| `amber-ink` | `#8A5A00` | caution-verdict text (AA-safe) |
| `amber-fill` | `#F2E4C2` | caution chip background |

**Density rule (this is what saves the palette):** warm paper only works if the page is DENSE with ink. Airy cream minimalism = AI-startup smell. Dense cream = newsprint. Same hex, opposite message. When in doubt, add a rule line and a sourced number, not more air.

**Stone rules:**
- **No red exists in this product.** Not in errors, not in charts, not in icons. Errors are ink on amber-fill.
- Color NEVER carries meaning alone: verdict = color + stamp shape + words. (~8% of your male audience is colorblind. Green/amber alone fails exactly them.)
- Numbers always `ink`. Never colored numbers.
- **`ink-soft` never draws a line.** Every hairline, border, and rule in this product is `rule`. No exception, no component. If a border is too faint for its job, fill the shape with `rule` instead of darkening the border. A filled block shows a corner radius better than an outline anyway.
- Contrast: body 7:1 target, 4.5:1 floor, everything AA at minimum.
- **No hex is ever adjusted to buy contrast margin.** The nine above are fixed values, not starting points. `ink-soft` on `paper` sits at 7.0:1, which meets the target with no room to spare. That is correct as specified and needs no help.
- No pure white `#FFF` backgrounds except inside input fields (slight lift off paper).
- Not John Deere green, not Case red, not brand-anything green. We are nobody's dealer.

---

## 4. TYPE

Two families, both free, both fast. Subset, woff2, preload. Nothing else ever.

**Why these two and not the usual:** Inter, Space Grotesk, Poppins, Manrope, IBM Plex = the default fonts of AI mocks. Everyone's eye now reads them as "generated." We reach past the whole era:

- **Libre Franklin** — UI, headings, body. Free revival of Franklin Gothic (1902): the face of American newspapers, extension bulletins, and government crop reports for a century. Farmers have read this letterform their whole lives without knowing its name. Zero tech smell.
- **Courier Prime** — every number, the whole receipt, the stamps. Typewriter face, not terminal face. Reads "carbon-copy invoice from the implement dealer, 1987," not "developer IDE." Monospaced, so receipt columns always align.

| use | spec |
|---|---|
| the big APR | Courier Prime Bold, 48px mobile / 56px desktop |
| verdict line | Libre Franklin SemiBold, 24px |
| h1 (page headline) | Libre Franklin Bold, 28px |
| body | Libre Franklin, 18px, line-height 1.5 |
| receipt line items | Courier Prime, 16px |
| sources/footnotes | Libre Franklin, 14px, `ink-soft`. NEVER smaller than 14 |
| labels above inputs | Libre Franklin Medium 16px. labels ABOVE, never placeholder-as-label |

**Which face carries a number.** The prose above says Courier carries every number and the table says footnotes are Franklin. Both stand. The split is by job, not by character class, and Courier's own stated reason settles it: monospaced so receipt columns align. Alignment decides.

- **Courier** carries any figure the farmer can check, compare, or carry back to the dealer's desk. Money, rates, terms, counts, the n. Anything sitting in a column beside another number.
- **Franklin** carries prose, labels, and provenance, including the dates inside a citation. A citation is a sentence, not a column. `¹ Chicago Fed AgLetter, Q1 2026` is Franklin.
- **Figure inside a sentence:** figure is Courier, words around it are Franklin. `median 7.4% · you 7.9% · n=143` mixes both faces on one line. The seam is correct, not a defect to clean up. A real work order has typed figures in a different face than its printed labels, and that is the register.
- Spec values that describe the system rather than the product stay Franklin. Notes to us, not figures for a farmer.

Fallback stack: `"Libre Franklin", "Franklin Gothic Medium", "Segoe UI", Arial, sans-serif` / `"Courier Prime", "Courier New", monospace`.

---

## 5. LAYOUT

**One column. 640px max width, centered, even on desktop.** Tool, not marketing site. Desktop gets same column with more air, never a sidebar, never a second column.

Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48. Section gaps 32-48. Nothing cramped, nothing floaty.

Chrome: wordmark top-left, trust line footer. **No nav.** One page is one page.

**Screen 1 — THE TOOL (this is the landing page):**
```
[wordmark]
H1: Point your phone at the dealer's quote.
    See the number they didn't print.
one line: Free, takes about a minute. Your numbers stay here unless you say otherwise.
┌────────────────────────────┐
│ Quoted price        [____] │   4 fields, 56px tall,
│ Cash discount       [____] │   inputmode=decimal,
│ Term (months)       [____] │   full width
│ Payment             [____] │
└────────────────────────────┘
[ Run the numbers ]              ← denim, full width, 56px
[ Snap the quote instead ]       ← outline denim, same size
footer trust line
```
Above the fold on an iPhone SE. Everything below fold is footnotes.

**Screen 2 — CONFIRM (photo path only):** extracted fields as big editable inputs, each flagged `read from your paper` or `couldn't read — enter it` (amber label, empty box, never a guess). One button: `Looks right — run it`.

**Screen 3 — THE TICKET (result):** receipt layout, hairline rules between lines, mono everything:
```
────────────────────────────────
 YOUR REAL RATE         2.94%      ← 48px mono bold
 [ STAMP: CHECKS OUT ]             ← field-green stamp, rotated ~2°
 This deal checks out.
 We'd take it.
────────────────────────────────
 Quoted price          $84,500
 Cash discount        − $6,000
 Cash price today      $78,500
 Total of payments     $84,500
 What financing costs   $6,000
════════════════════════════════   ← double rule = total, like a receipt
 vs. published rates:
 AgDirect, $25,000-$99,999,
 5 years, fixed: 7.25%
 subject to approval
────────────────────────────────
 ¹ AgDirect published equipment
   rates, as of 2026-08-01

(The peer strip replaces the published rows only once the cohort reaches
n≥20, and it prints n. Shape, with numbers that are illustrative and are
NOT canon because no pile exists yet:
 [ p25──●median────you──p75 ]      ← one strip, direct labels, no legend
 median 7.4% · you 7.9% · n=143 )
```
Then email gate, then consent gate, in that order, each its own quiet block. Never a modal. Never a popup.

**The stamp** = the one ownable brand element. Rubber-stamp style, mono caps, 1.5-2° rotation, slight ink-bleed edge: `CHECKS OUT` (field green) / `LOOK CLOSER` (amber). Two stamps only. No third. This is what gets screenshotted.

---

## 6. ELEMENTS

- **Buttons:** one primary (denim fill, white text), one secondary (denim outline on paper). 56px tall, full width mobile, **2px radius. Square-shouldered, like a toolbox drawer.** Friendly 8-12px rounding = every AI mock on earth. We do not round.
- **Inputs:** 56px, white fill, 1px `rule` border, 2px denim border on focus. Big mono text inside. `inputmode="decimal"` on every money field. No steppers, no sliders — farmers type numbers.
- **Verdict stamp:** stamp + one plain sentence. Never a score, never a gauge, never a percentage-ring donut. **Execution rule: stamp must look actually stamped** — scan a real rubber stamp impression once, use that texture. If that's not doable, plain bold text in a plain box. A pristine vector "distressed" stamp is fake antique, worse than nothing.
- **Comparison strip:** single horizontal band (p25-p75 shaded `rule`), median tick, `you` dot in ink. Direct labels under, words not symbols. No axes, no gridlines, no legend. If n<20, element does not render — benchmark table renders instead.
- **Receipt table:** labels left, mono numbers right-aligned, hairline rules, double rule before totals. This table is the product.
- **Footnotes:** superscript markers, sources + dates at ticket bottom. Every external number has one.
- **Progress:** one thin denim line crawling during extraction. The only motion in the product.
- **Icons:** almost none. Camera icon on photo button. No icon zoo, no emoji, ever.
- **Photos/illustration:** none in product. No hero image. The form is the hero.

---

## 7. LOGO / MARK

Wordmark only, v1: **LOANHANK** set in Libre Franklin Black caps, tight-tracked, ink on paper, single hairline rule beneath. The register is feed-sack and grain-elevator lettering, not startup logo. Optional small tagline under rule: `Runs the numbers. Takes no side.`

No mascot drawing. No cartoon Hank — cartoon = costume = smell. Hank stays a voice and a stamp. If a mark is ever needed: the CHECKS OUT stamp is the mark.

---

## 8. AD CREATIVE DIRECTION

Format that fits the psychology (suspicion-confirmation, native to feed):
- **Photo of a real paper quote** (recreated, no real dealer name) on a truck seat / clipboard. Amber grease-pencil circle around "0% FINANCING," grease-pencil arrow to margin note: `not really 0%`.
- Headline: `0% financing isn't 0%. See what it really costs.`
- Looks like a neighbor's photo, not an ad. No logo-first frames, no stock farmers, no drone shots of wheat at golden hour.
- Grease pencil = ad language. Rubber stamp = product language. Both shop-authentic, never mixed.
- **Shoot it for real.** Real paper, real grease pencil, real truck seat, phone camera, imperfect light. Costs $20 and an afternoon. Digitally faked grease pencil is worse than none.
- **NEVER AI-generate imagery. Not the photo, not the wheat, not the hands. Ever.** Farm Facebook is drowning in AI slop and this audience is now expert at spotting it. One generated image = "they're fake" = brand death with the exact crowd whose trust is the product.

---

## 9. SPEED + ACCESS BUDGETS (design specs, not engineering nice-to-haves)

- Page weight **< 150KB** total, fonts included. Rural LTE is the median network. Speed IS trust.
- First paint < 1.5s on 3G. No framework tax on the landing form.
- Tap targets ≥ 48px. Body ≥ 18px. Footnotes ≥ 14px.
- Works at 200% browser zoom without breakage (older eyes use it).
- Form usable without JS (POST fallback); photo path can require JS.
- Print stylesheet + PDF teardown mirror the ticket exactly: black ink, white paper, same receipt rules, stamp included. Farmer prints it and takes it back to the dealer. **The printout negotiating for the farmer at the dealer desk is the best marketing we will ever ship.**
- No cookie banner (no tracking cookies to need one — absence of banner is itself a trust signal). No chat widget. No newsletter popup. No push permission prompt. Nothing interrupts.

---

## 10. DO-NOT STONES

- No red. No gradients. No animation beyond the progress line. No modals.
- No dashboards, gauges, rings, scores out of 100.
- No stock photography of farmers. No drone wheat.
- No colored numbers. No number without source. No peer claim without n.
- No dark mode v1. No app-store badges. No social proof widgets with fake counts.
- No cartoon Hank.
- Fonts: two families max, forever. Colors: this palette, nothing added without carving it here first.

**Anti-robot stones (the tells, carved so nobody re-introduces them):**
- No AI-generated images anywhere, product or ads. Real photos, phone camera, or nothing.
- No default-AI fonts: Inter, Space Grotesk, Poppins, Manrope, Plex, Roboto. Franklin + Courier only.
- No em dashes, no staccato triads in prose (spec table cells are enumeration, exempt), no Title Case, no "It's not X, it's Y."
- Never improve this doc's own wording. Clipped and lopsided lines get copied verbatim. Tidying is the drift.
- No friendly rounded corners. 2px shoulders everywhere.
- `ink-soft` never draws a line. Borders are `rule`, always.
- No airy minimalism. Dense like newsprint. Whitespace is not a virtue here; clarity is.
- Perfect consistency is itself a tell. If a screen looks like a beautiful mock, it fails the made-by-a-guy test. Add a rule, add a sourced number, tighten a gap.