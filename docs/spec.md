# QUOTE DECODER — SPEC

Single source of product law. `design.md` covers how it looks and sounds. Nothing else is law.

Version 1.0, merged 2026-08-15 from the cave spec and the rate/verdict law. Pre-merge originals live in `docs/archive/` for provenance only.

---

## BLURB

Dealer show farmer shiny quote. Quote hide real rate. "0% financing" not 0%. Discount is secret interest. Farmer smell trick. Farmer cannot do math.

We give farmer club: point phone at quote → see real rate → see real cost → see quote vs what other farmers pay. Free. Fast. No login. Sixty seconds.

Farmer trust us because we only tribe at table not selling him something. Sometimes we say "dealer deal good, take it." This why farmer believe us.

Farmer with quote in hand = best lead in America. Buying THIS WEEK. When farmer say "make lenders fight for my deal" — we sell that lead. That the business. Tool free forever. Lead only move when farmer say go. Never sneak. Sneak once on AgTalk = tribe exile forever.

Site headline: **"Point your phone at the dealer's quote. See the number they didn't print."**

## ONE BIG WARNING BEFORE BUILD

Old cave have magic spear: `src/finance/index.ts` (1,175 line money math) + its test pit. Canada test. Extraction-security test. Privacy test.

**CARRY SPEAR TO NEW CAVE. DO NOT CARVE NEW SPEAR.** Copy folder. Copy tests. New math = new bugs = wrong number shown to farmer = brand dead day one. Whole brand IS "number right."

Everything else — screens, auth, watches, portfolio — leave in old cave. Let sleep. Year-end PDF module (`report-pdf.ts`) also good loot — take later, January weapon.

---

## 1. WHY THE APR IS MISSING (the structural fact)

Credit primarily for agricultural purpose is exempt from federal Truth in Lending disclosure (Reg Z, 12 CFR §1026.3(a)). Most farm-equipment paper is not required to show an APR. That is the market gap, stated as regulation, not as dealer intent.

**Approved public wording (only this framing, never intent claims):**
> "Most farm-equipment credit is not federally required to show an APR. We calculate a comparable rate from the actual deal you were offered."

Never say or imply "they hid it." Say "it is not required, so we compute it."

---

## 2. THE RATE — definition of record

**Headline number: "Your real rate" = the all-in annualized cost of choosing this financing deal instead of the cash deal.**

Formally: the annual IRR (XIRR for non-monthly or irregular schedules) of the DIFFERENCE between the all-in cash-purchase cash flows and the all-in financing cash flows. Decision math, not a claimed Reg-Z APR, and we say so.

**Two computed views, one headline:**
- `real_rate_all_in` — includes every mandatory finance-only cost, upfront or rolled. **This is the only number that gets the 48px treatment.**
- `promo_price_rate` — excludes finance-only fees; isolates the cost of forgoing the cash discount. **Receipt line only. Never a second headline. Two big numbers confuse a man holding a quote.**

**Public contract sentence:**
> "This is not the legal APR. It is the annual cost of this deal against its cash alternative, using the costs we can verify."

### 2.1 Fee taxonomy (drives the math)

| Item | Treatment |
|---|---|
| Sales tax, registration, delivery charged either way | Excluded from rate; shown separately on receipt |
| Mandatory finance-only doc/origination/insurance fee | Included in `real_rate_all_in` |
| Optional warranty/service plan | Excluded by default; farmer-toggleable |
| Fee rolled into payments | Included, and explicitly called out on receipt |
| Unknown/unclassified amount | **Blocks the verdict.** "Confirm this amount." |

`fees_json` entry shape: `{ name, amount, required: bool, finance_only: bool, rolled_into_finance: bool, status: "confirmed"|"unknown" }`

**Tax edge (golden-fixture requirement):** tax is not always invariant between alternatives. Some states tax pre-discount price; trade-in tax credits vary by state. Ledger must allow per-alternative tax entry. At least one golden test encodes a state where cash-deal tax ≠ finance-deal tax.

### 2.2 The deal ledger (the full input model)

Fields: cash price · finance price · cash discount/rebate · trade allowance · trade payoff (negative equity) · down payment/due at signing · taxes (per-alternative capable) · delivery/setup · mandatory finance-only fees · amount financed if stated · payment amount · **payment frequency (monthly/quarterly/semiannual/annual — ag pays annual, this is not optional)** · payment count · balloon.

**Reconciliation gate:** if the ledger and scheduled payments don't reconcile, no verdict. Say:
> "We found a difference between the quoted total and scheduled payments. A trade, down payment, tax, fee, or add-on may be missing. Confirm it before we rate this deal."

An unexplained gap between `payment × periods` and the financed ledger = an **unexplained amount** flag. Never call it a junk fee until the farmer confirms what it is. Confirmed ones feed the junk-fee index honestly.

### 2.3 Quick path vs verdict path (protects the 60-second doctrine)

The reconciliation gate guards the **stamp**, not the **first number**.

- **Quick path** (price, discount, term, payment + frequency toggle): instant `promo_price_rate` with assumptions PRINTED in ink: "Assumes no trade, no down payment, no fees. Confirm the full deal to get the verdict." Never a silent zero — a stated assumption.
- **Verdict path** (ledger complete or photo-extracted + confirmed, reconciled): earns `real_rate_all_in` and a stamp.

Value in sixty seconds. Rigor before judgment. Both, no compromise between.

---

## 3. VERDICT RULE v1

- **CHECKS OUT** — `real_rate_all_in` ≤ matched published reference + 100 bps
- **LOOK CLOSER** — `real_rate_all_in` > matched published reference + 100 bps
- **NO VERDICT YET** — no matched reference (e.g., 84-month deal, card stops at 7 years), unreconciled ledger, or any unknown fee

**Stamp law:** two stamps only. NO VERDICT YET is NOT a third stamp. A stamp is a judgment; this is an abstention. Render as plain words, no stamp: "No verdict yet. Here's what's missing." The absence of the stamp is the message.

**Always show beside any verdict:** the delta, the reference source + as-of date, and the caveat "subject to approval."
> "Your real rate: 5.2%. Comparable published equipment rate: 6.5%, subject to approval. This deal checks out."

**The 100 bps buffer is policy, not discovered truth.** It is versioned in the engine as `VERDICT_BUFFER_BPS` and `VERDICT_BUFFER_VERSION`, and `/how-we-figure-it` prints that version. Revisit only when the pile has real cohort data. Explicit, symmetric, reproducible beats falsely precise.

Note the credibility feature: this rule will frequently bless captive 0% promos. Good. A tool that sometimes says "take the dealer's deal" is the only tool anyone believes.

### 3.1 The firewall between the verdict and the business

**The verdict judges the paper the farmer already holds, and nothing else.** It is arithmetic against a published rate card. It is not a lead qualifier, not a sales trigger, and not an argument for anything we might later sell.

Carved in both directions, because a firewall with one wall is a funnel:

**Nothing on the verdict side may reference the business.** No verdict screen, no stamp, no verdict line, no receipt row, no reference line, no footnote, and no canonical example in `design.md` may mention a partner, a lender who might compete, refinancing, or the interest question. A LOOK CLOSER stamp says the deal prices above the published card. It never says what to do about it, because the moment it does, the stamp is selling.

**Nothing on the business side may reference the verdict.** The interest question, and any consent flow that ever follows it, may not mention the rate, the stamp, the verdict, the delta, or how the deal compared. It asks one question about a hypothetical and carries no argument.

**And the question does not move with the answer.** The interest question renders identically for CHECKS OUT, for LOOK CLOSER, and for an abstention. Showing it only to farmers whose deals looked expensive would be steering by omission, which is the same sin performed quietly.

The disclosure link beside the question is the one permitted crossing, and it runs the safe way: from the business toward the truth about it, never from the verdict toward the business. FTC guidance wants that disclosure near the action (§10).

Enforced by `tests/firewall.test.ts`, both directions and the independence property.

**Why this is law rather than taste.** The moment a stamp can be read as a sales cue, every verdict becomes suspect in retrospect, including the honest ones. The neutrality is only worth something if it is structural, and structure means a test.

---

## 4. BENCHMARK HIERARCHY

1. **Matched live equipment rate card** (same amount band, nearest supported term band) → may support a verdict. Phase-0 source: AgDirect published equipment rates.
2. **Regional machinery/intermediate survey rates** (KC Fed) → market context line only, never the verdict source.
3. **Operating, real-estate, Prime, SOFR, GoC, broad Fed rates** → NEVER shown as comparable for an equipment-paper verdict. Purpose-mixing is how the receipt test dies.
4. **No suitable match** → rate yes, verdict no.

**Snapshot rule:** every benchmark row carries `source_url`, `as_of_date`, and an archived copy (R2, bucket `loanhank-snapshots`, no expiry rule). Any past verdict must be reproducible after the source page changes. Update cadence: on source change, minimum quarterly check. **AgDirect republishes its card monthly** ("Rates effective August 01-31 2026"), so the tier-1 table is checked monthly, not quarterly, or verdicts run against a card two months stale.

**Single-source fragility, on the record:** AgDirect can reformat, pull, or object to being the reference. It is also Farm Credit-affiliated and a plausible future lead buyer — awkward or synergistic; decide knowingly before scale. Expansion path: add other published, date-stamped equipment programs under the same matching transparency; later, pile cohort medians (n ≥ 20) complement but do not replace tier 1 for verdicts.

---

## 5. ARCHITECTURE

Small. Boring. One worker.

```
Cloudflare Worker (Hono)
 ├─ GET  /            → the page (form + photo button). server-rendered. NO LOGIN.
 ├─ POST /extract     → photo → vision LLM → fields. farmer CONFIRMS every field. photo deleted after.
 ├─ POST /decode      → ledger → engine → real rate, total cost, cash-vs-finance, verdict vs benchmark
 ├─ POST /email       → save email, queue PDF teardown send
 └─ POST /interest    → farmer answers the non-binding interest question (Phase A, §8)
D1
 ├─ decodes    ← THE GOLD. no PII, no dealer name.
 ├─ emails     (email, decode_id, consent fields, consent_text_version)
 ├─ benchmarks (published equipment rates, hand-entered, one row per source+date)
 └─ events     (funnel metrics: event, decode_id nullable, ts, meta json)
```

A real consent route and lead handoff ship only after the lawyer stones clear (§8 Phase C). Until then nothing moves and there is no consent button.

Rules of cave:

- Engine = pure functions. No fetch inside. No DB inside. Same input → same output. All money math lives here, NOWHERE else. UI never do arithmetic. UI only paint engine output.
- Photo: extract → confirm → DELETE. No account numbers ever stored. This is sales weapon, not chore.
- US only v1. Published equipment rate cards are US. Canada later; the engine already knows Canadian semi-annual compounding and the tests are in the pit.

### 5.1 Schema

**Units live in the column names.** Every money column is integer `_cents`, every rate column is integer `_bps`. The engine works in cents and basis points end to end, and a column named `cash_price` holding `84500` is indistinguishable from one holding `8450000`. Implemented in `migrations/0001_init.sql`.

`decodes` — one row per decode, no PII, no dealer name, no account numbers:

- identity/context: `id`, `ts`, `quarter`, `state`, `region`, `equip_category`, `new_or_used`, `structure_type` (`0pct_discount|standard|lease|balloon`), `lender_type` (`captive|bank|fcs|cu|unknown`)
- ledger (§2.2): `cash_price_cents`, `finance_price_cents`, `cash_discount_cents`, `trade_allowance_cents`, `trade_payoff_cents`, `down_payment_cents`, `tax_cash_cents`, `tax_finance_cents`, `delivery_setup_cents`, `amount_financed_cents`, `payment_amount_cents`, `payment_frequency`, `payment_count`, `balloon_cents`, `term_months`, `stated_rate_bps`
- fees: `fees_json` (§2.1 entry shape, amounts as `amount_cents`)
- computed: `real_rate_all_in_bps`, `promo_price_rate_bps`, `reconciled` (bool), `assumptions_json`, `verdict` (`checks_out|look_closer|none`), `verdict_ref_id`, `benchmark_at_ts`, `delta_vs_benchmark_bps`
- banding for cohorts: `price_band`, `term_band`, `down_pct`
- forage fields, grab if on paper, NEVER require: `brand`, `model_year`, `hours`, `list_price_cents`

Stamp law is a table constraint, not a convention: `CHECK (verdict = 'none' OR (reconciled = 1 AND verdict_ref_id IS NOT NULL))`. A row cannot claim a verdict it did not earn.

`emails` — `id`, `email`, `decode_id`, `created_at`, `consented` (bool), `consent_ts`, `consent_text_version`, `unsubscribed_at`. Consent may not be recorded without both a timestamp and the text version, also a `CHECK`.

`benchmarks` — published rate rows: `id`, `source`, `source_url`, `as_of_date`, `snapshot_key` (R2 archive of the source page, in the `loanhank-snapshots` bucket, which has no expiry rule because a past verdict must stay reproducible), `amount_band` + `amount_min_cents` + `amount_max_cents`, `term_band` + `term_min_months` + `term_max_months`, `rate_bps`, `rate_kind` (`fixed|variable`), `tier` (1 = verdict-eligible per §4).

The band columns come in pairs: the label is what the farmer reads, the bounds are what the matcher compares. `rate_kind` exists because a fixed dealer promo compared against a variable benchmark is a wrong comparison, not a close one.

`events` — `id`, `event`, `decode_id` nullable, `ts`, `meta_json`. Event types include `decode`, `email`, `interest_yes`.

Migrations are append-only. Never edit a shipped migration; add a new one.

## 6. REPO

```
src/finance/  ← the spear. touch only with test first.
src/api/      ← worker routes. thin. dumb. call engine.
src/web/      ← one page. form, confirm screen, result screen. that all.
src/shared/   ← schema types and validation.
migrations/   ← D1 SQL, append-only.
tests/        ← engine tests (stolen), api tests, extraction fixtures.
ops/          ← runbook.md, benchmarks.md (rate table + source links), ads.md (copy variants), leads.md (buyer list), funnel.sql
```

Method:

- Money math = test FIRST, then code. Always.
- **A farmer's photo never becomes a fixture.** The photo is never written down at all (§5), so there is nothing to anonymise and nothing to keep. Extraction improvement comes from the **extracted-versus-confirmed diff**: what the model read, what the farmer corrected it to, per field, text only. No image, no PII, no dealer name. That diff is the eval signal, and without it the extraction flywheel starves.
- Synthetic quotes are fixtures and live in `tests/fixtures/`, generated by `tests/fixtures/make-synthetic-quote.py`. Invented dealership, invented salesperson, known arithmetic.
- Main branch always deployable. One command ship (`pnpm deploy`). No staging theater.
- No feature before funnel number demand it. **No build barn before have cow.**

---

## 7. FUNNEL

```
Meta ad ($500 test)
  "0% financing isn't 0%. Point your phone at the quote. See what it really costs."
   ↓ click
THE TOOL IS THE LANDING PAGE. no brochure page. form above fold.
   ↓ type 4 numbers (price, discount, term, payment) OR photo
INSTANT ANSWER. no gate. real rate big font. verdict vs published benchmark. honest — sometimes "deal good."
   ↓ gate 1 (soft)
"Want full teardown PDF?" → email
   ↓ gate 2 (non-binding, Phase A)
"If an independent equipment lender could quote this deal, would you want to hear from one?" → interest-yes
   ↓ after counsel clears (Phase C)
explicit consent → LEAD → sell to equipment-finance broker/lender. manual first: email + spreadsheet to 3 buyers. no API until money.
   ↓ later
email owns farmer: benchmark updates, year-end tax PDF (January), maturity pings → repeat leads
```

Value before email. Email before interest. Interest before consent. Consent before handoff. Never reorder. This the whole religion.

### 7.1 Wall numbers — write on cave wall BEFORE spend $500

| step | good | workable | broken = stop, fix, retest |
|---|---|---|---|
| click → completed decode | ≥ 25% | | < 10% |
| decode → email | ≥ 20% | | < 8% |
| email → **interest-yes** | ≥ 10% | | < 3% |
| **$ per completed decode** | **≤ $12** | **≤ $25** | **> $40** |

**Round one is judged at the decode, not at the lead.** The gate above is cost per *completed decode*, because that is the only number a first week of spend can measure honestly. A few hundred dollars buys enough decodes to know whether the top of the funnel works; it does not buy enough interest-yes answers to say anything about lead economics without fooling yourself with a denominator of nine.

**Cost per lead is not judged until $2,000 to $3,000 of spend has run.** Before that the figure exists but means nothing, and acting on it means killing a funnel on noise or scaling one on luck.

(garbage form-fill industry sell junk leads at $600/mo minimums. our lead = verified quote, real intent, this-week buyer. worth multiples. 2-3 broker calls confirm price.)

One week data > one month opinion. If numbers good → scale spend. If bad twice → THEN rethink. No new strategy hunts between tests. **No more cave-painting. Throw spear.**

---

### 7.2 The pile is production, and production is not a test bed

The pile is the company. These rules exist so nobody has to be individually correct about it.

- **Test rows never enter production.** Exercise the funnel against the local database (`wrangler dev`, `pnpm funnel --local`).
- **Verification traffic against production is flagged synthetic immediately, in the session that creates it.** Not at the end of the week, not when somebody asks, and not after a question about whether it counts. `decodes.synthetic`, `emails.synthetic` and `events.synthetic` are columns, and every published statistic and `ops/funnel.sql` read `synthetic = 0`.

  **No sign-off is needed to flag.** Flagging destroys nothing and can only make the pile more honest, so an agent that writes verification rows to production flags them itself and reports that it did. Waiting to be told is how four unflagged rows sat in the pile across a session boundary while everyone assumed somebody else owned them.

  Verification traffic is synthetic by definition, however real the pipes it proves. A send that genuinely reaches a real inbox is still a send nobody asked for, and three runs of the same canonical deal would seed the first cohort median with an echo of our own test.
- **Production deletes require owner sign-off.** Any `DELETE` against `decodes`, `emails` or `events` on the remote database is an owner decision, asked for and answered in writing before it runs. This includes cleaning up a mess the agent itself made. On 2026-08-15 a session cleared 24 self-created rows on its own judgment. The judgment was right and the precedent is not. **The rule is asymmetric on purpose: flag freely, delete never.**
- **The pile's first real row should be the first real farmer.**
- **Benchmarks are the exception, and only through a migration.** Corrections to published-rate rows ship as a new numbered migration, never as an ad-hoc statement, because a verdict has to stay reproducible against what the table said on the day.

---

### 7.3 Testing rules

- **Money math is test first.** Any change in `src/finance/` starts with a failing test, and expected values are derived independently before the function exists, never read back out of it.
- **Every abstention path needs a companion canary.** This product abstains safely everywhere: no matched reference, no verdict; unreconciled ledger, no verdict; unknown amount, no verdict. That safety is also a hiding place. On 2026-08-15 migration 0001 shipped every benchmark amount bound a thousand times too large, so no quote on earth fell inside a band and every deal would have abstained. Nothing failed. It read as caution.

  So: at least one golden deal must match its band and produce a stamp, run against the benchmark table the migrations actually ship, not a copy of it. **A canary that abstains fails the build.** Abstention is earned, never defaulted into. `tests/canary.test.ts`.
- **No promise without a sender.** Any user-facing future-tense commitment needs a test proving the mechanism that keeps it actually fires. "We'll email it." "We will remind you." "We will not email you again." Each one is a claim about the future, and a claim about the future is only as good as the code that arrives to keep it.

  The test covers the negative paths too, because that is where these fail quietly: the out-of-window row skipped, the already-sent row not sent twice, the unsubscribed address refused however early its yes arrived, the nonexistent id answered honestly rather than reassured.

  Every future-tense phrase in product copy is registered in `tests/promises.test.ts`, naming either the test that keeps it or the reason it is not a delivery commitment. A named test that does not exist fails the build, so the citation cannot be fiction. The voice sweep flags any unregistered promise.

  Two defects of this exact species shipped in one session and were caught only by exercising them live. The expiry opt-in stored a yes and had nothing that would ever send it. The failed-send screen said the teardown would follow shortly, and nothing in this product would have sent it. Both read as reassurance, which is what made them worse than an error message: a farmer who is told nothing goes and checks, and a farmer who is told "shortly" waits.
- **Seeded data is checked against its own label.** A hand-typed number is the only thing in the repo with no compiler behind it. `tests/benchmark-seed.test.ts` reads each band's bounds against the band printed on it.
- **Canon is engine output.** Figures printed in `design.md` are recomputed by `tests/design-canon.test.ts`. Canon drift is a failing build.

---

## 8. VALIDATION SPLIT

**Phase A — demand test, no counsel needed.** `ad → decode → optional email receipt → non-binding interest question`:
> "If an independent equipment lender could quote this deal, would you want to hear from one?"  [Yes] [Not now]

No forwarding, no lender contact, no shared PII, no "consent" label. This measures intent, not permission. It is not brokering because nothing moves.

**Phase B — parallel buyer discovery.** Anonymized example deal structures (never farmer records) to 3-5 potential finance buyers. Written answers: states + deal types accepted, minimum ticket, required borrower info, whether they pay for verified quote-in-hand introductions, price, exclusivity, contact policy.

**Phase C — counsel-gated monetization.** Real consent button ships only after the lawyer stones (§10). Then: actual consent → funded conversation validates the business.

Honest ladder: decode/email = farmer demand. Interest-yes = directional intent. Buyer LOIs = revenue model. Post-counsel consent = the business. No rung skipped, no rung overclaimed.

### 8.1 Lead pricing law

**Compensation for a lead is a flat fee or a retainer. Nothing else.**

No success fee. No funded-deal contingency. No share of interest, points, spread, or origination. No volume bonus tied to closings. If money moves to us because a farmer's loan actually funded, we are being paid for the outcome of a credit transaction, and in a number of states that is the definition of the licensed activity we have said we do not perform.

**The single exception, and it is not available today:** contingent compensation may exist only where a signed broker-of-record agreement is on file for that arrangement, and only after counsel has confirmed the licensing position in every state it touches. Until such an agreement exists, contingent pricing may not be quoted, negotiated, agreed in principle, or built into any system.

This binds the pricing conversation as much as the code. A buyer who will only pay per funded deal is a buyer we do not take at that price, however good the price is.

### 8.2 The Phase C consent form, specified now and built later

Recorded here so the shape is settled before anybody is under pressure to ship it. **None of this exists yet. None of it may be built before counsel has reviewed the wording** (§10 lawyer stones).

**What consent collects, and only at consent:**

- Phone number. Not asked for anywhere else in the product, not on the decode, not at the email gate, not with the interest question. It arrives at consent or not at all.
- Self-reported credit tier, optional, and clearly optional. Self-reported, never pulled, never inferred, and never verified by us. A farmer may decline it and still consent.

**The opt-in is explicit, named, and per-channel:**

- The partner is **named** on the form. Not "our lending partners", not "a lender in our network". The name of the company that will contact him, shown before he agrees.
- Channels are itemised and separately agreed: **calls, texts, and email**. A yes to email is not a yes to a phone call, and a yes to a phone call is not a yes to an autodialed one.
- The wording satisfies **TCPA** for calls and texts, including the prior express written consent language, and **CASL** for anything reaching a Canadian address, which requires consent rather than an unsubscribe link. CASL is the stricter and sets the floor.
- The exact text version shown is stored beside the answer (`consent_text_version`), forever, as it already is for everything else we ask.

**Never collected, at any stage, consent included:** credit applications, tax documents, SSNs, EINs, bank statements, account or routing numbers. This is **schema law, not practice**: no table and no extraction schema in this product may contain a field capable of holding any of them, so the failure mode is a compile error rather than a judgment call at four in the afternoon. A lender who needs those collects them itself, on its own paper, under its own licence and its own liability. We introduce; we do not underwrite, and we do not warehouse the material of underwriting.

Extends the never-capture list in §9.5, which covers what is on the dealer's paper. This covers what a lender might ask us to gather, and the answer is the same.

---

## 9. DATA ENGINE (THE MOAT)

Every decode = one row of truth nobody else in America has: real dealer quote, real structure, real all-in rate, dated. Form-fill competitors have name + phone. We have the market itself. After 10,000 rows, uncatchable.

**Golden columns: `real_rate_all_in` and `promo_price_rate`.** The engine computes them for every quote (0% w/ discount → real rate; lease → money factor → rate; standard → stated). Comparable numbers across all structures. Everything ranks on `real_rate_all_in`.

**Cohort = how quotes become comparable:**
`equip_category × new_or_used × term_band (0-48/49-72/73+) × price_band × quarter`. Region split later, when rows enough.

**Pile hygiene:** only `reconciled = true` decodes enter cohort medians, percentile claims, and the quarterly report. Quick-path rows are stored, flagged `reconciled = false`, and excluded from all published statistics. Assumption-laden rates in the medians = the moat rotting quietly.

**Stats: caveman math, no ML.** Pull cohort rows in worker, sort, take median + p25/p75 + your-percentile. D1 fine at this scale. No warehouse until 50k rows.

**Cold start — three phases, honest at every step:**

| phase | reconciled rows in cohort | farmer sees |
|---|---|---|
| 0 | < 20 | published equipment rate cards only (§4 tier 1). say "vs published rates" |
| 1 | ≥ 20 | "median for used tractors, 60-72 mo, this quarter: 7.4% (n=143). you: 8.9% — higher than 78%." ALWAYS show n |
| 2 | thousands | quarterly "State of Farm Equipment Financing" report from the pile. free, public, sourced. = PR + SEO + authority + what lead buyers drool on |

**Stone rules:**
- NEVER show peer stat with n < 20. Fake percentile = lie = brand dead. Show benchmark instead, say so.
- NEVER store or show dealer name. Photo extraction DROPS it. "Dealer X bad" = lawsuit. We rank quotes, not dealers.
- Always print n next to any peer claim. Honesty is the costume AND the body.
- Row count itself = marketing. "Compared against 12,000 real quotes" — number goes in ad when number big.
- Flywheel: more decodes → tighter medians → better answer → better ad claim → more decodes. Feed it, never fake it.

### 9.2 Currency and country are never pooled

**CAD and USD are never pooled, converted, or compared in any statistic, ever.** Not in a median, not in a percentile, not in a quarterly report, not in an ad claim. They are different money in different markets, no conversion is performed anywhere in this product, and a blended figure would be indefensible the first time somebody checked it. Country and currency are part of the cohort key rather than a column somebody could forget to filter on (`decodes_cohort_v2`).

Canada is collected from day one and rated by nobody. There is no published Canadian equipment rate card, so a Canadian deal gets its arithmetic and an abstention in plain words:

> No published Canadian equipment rate exists to compare against. We show the math; there is no card to check it against.

Labeled Canadian rows are the only Canadian equipment-finance benchmark that will ever exist. They exist only if collected before there is any use for them.

### 9.3 The peer ladder

Two systems, permanently separate. **The stamp is anchored** to published cards plus the versioned policy buffer and is never influenced by the pile. **The peer context comes alive** as the pile grows.

Always the finest cohort with n ≥ 20, falling back deterministically: drop price band, then term band, then widen the window to two quarters, then four. Country, currency, equipment category and condition are never dropped. The chosen cohort and its n print on every ticket. `cohortLadder` in `src/finance/`, policy version `PEER_POLICY_VERSION`.

Every peer statistic shown is **snapshotted on the decode row** — exact median, quartiles, n, cohort key, computed-at, policy version — so a ticket rendered today is reproducible in two years after the cohort has moved underneath it. Same discipline as `verdict_ref_id`.

The ladder returns "no cohort qualifies yet" for weeks. That is correct output, not a gap. The day a cohort crosses twenty, nothing changes but what there is to print.

### 9.4 Capture greed never touches the sixty-second flow

Forage fields are read silently and never block a decode. **The farmer confirms only what drives the math and the stamp.** Everything else — model, hours, promo name, trade description, quote dates — is taken if it is on the paper and left null if it is not. An empty forage column is fine. A farmer who abandoned the form because we asked him about combine hours is not.

### 9.5 The never-capture list

These are on the paper. They are never extracted, never stored, and never inferable from what is stored:

- Dealer or dealership identity, in any form
- Salesperson name
- Customer name, address, phone, email
- Serial numbers, VINs, stock numbers, account numbers

**Extended by §8.2 for anything a lender might ask us to gather:** credit applications, tax documents, SSNs, EINs, bank statements, account and routing numbers. Same rule, same enforcement.

This is enforced by shape, not by discipline: `quoteExtractionSchema` has no field that can hold any of them, so a model that returned one would have nowhere to put it. `brand` means the manufacturer and is null when only a dealership name is visible. We rank quotes, never dealers.

### 9.1 Quote pile treasures (forage like alpha)

Pile worth more than leads. Ten treasures sleep in it. Forage all, from day one, so no gold lost.

1. **PRICE DATABASE — buried king.** Valuation data locked behind paywalls (Sandhills, EquipmentWatch). But every quote carry price + model + year + hours. Pile slowly rebuild the locked database — FREE, as exhaust.
2. **SUBVENTION DEPTH — Wall Street meat.** Cash-discount size = manufacturer's secret subsidy. Track buydown depth by brand by quarter → demand-health signal for DE / CNH / AGCO tickers.
3. **DEMAND INDEX.** Quote volume by category × region × week. Quote come BEFORE purchase = leading indicator.
4. **STRESS SIGNALS.** Term creep (60→72→84 mo). Balloon/lease share rise. Down payment shrink. = ag-credit stress measured at the desk, quarters before Fed surveys see it.
5. **COMPETITION GAP MAPS.** Delta-vs-benchmark by region + lender type = map of where spreads fat because nobody compete. Price own leads from fat-spread regions HIGHER.
6. **LEAD SCORING — direct money.** Quote 200bp over cohort median = lead that almost surely convert for competing lender. Tier lead price on beatability.
7. **JUNK-FEE INDEX.** Which add-ons appear, cost, how often forced insurance show up. Only farmer-confirmed unexplained amounts count (§2.2).
8. **TIMING INTEL.** Seasonality of promos + prices → farmer-facing negotiation content.
9. **SEO PAGES NOBODY CAN COPY.** Every cohort median = a page. "Average used combine financing rate 2026."
10. **BETTER SPEAR.** Every new quote format = new extraction fixture. Accuracy compound.

**Forage stones (carve deep):**
- Capture forage fields from day one even if unused. Grab if on paper. NEVER require. Empty field fine, lost field gone forever.
- Sell AGGREGATE only, forever. n ≥ 20. No row-level sale. No dealer names. ToS line from day one: "anonymized, aggregated market statistics." Farmer data never leave cave raw.
- Know the bias: pile over-index suspicious farmers with bad quotes. Quoted ≠ funded. Say so in public report, or smart people debunk report and authority die.

---

## 10. PAGES + LEGAL

All footer-linked. All Hank voice: plain-words summary box on top, lawyer text under. A 40-page SaaS-template ToS smells robot AND scam. Short and plain wins twice.

**Day-one pages (ship with tool):**

1. `/privacy` — law requires + Meta ads demand a privacy URL before ads run. Must say plainly: what we take (quote numbers; email if you give it), **the photo sentence exactly as the machinery behaves**:

   > Your photo is never saved. It goes straight to the reader and is gone when the answer comes back.

   The happy path never writes a photo anywhere. The `loanhank-quotes` bucket and its one-day expiry rule remain as a backstop against any future path that does write one, and today nothing does. Also: anonymized aggregate stats kept forever (this line = license for the treasure pile — no line, no pile), nothing personal moves without your go. **California catch: farmer-consented lead handoff = "sale/share" of personal info under CCPA — and if >50% of revenue comes from it, the law applies at ANY company size. Need "Do Not Sell or Share My Personal Information" link + a rights process.**
2. `/terms` — not financial or tax advice, math shown and farmer confirms inputs, no savings guaranteed, aggregate-data license, the "not a lender / not a broker" sentence ONLY as lawyer approves.
3. `/how-we-make-money` — the Kennedy damaging admission gets its own page: free tool, farmer pushes go, lenders pay for the introduction, that is the whole business. ALSO linked right next to the interest/consent question — FTC wants disclosure clear, conspicuous, and near the action, not buried in footer.
4. `/contact` — real email, real postal address (PO box fine — CAN-SPAM requires postal address in every email anyway).
5. `/whos-behind-this` — REAL name, REAL face, real camera, two paragraphs. Machinery Pete works because Pete is a person. Anonymous finance site = scam smell. Biggest trust page on the site.
6. `/how-we-figure-it` — show the work: formulas in plain words, benchmark sources + dates + links, what the real rate means, the 100 bps buffer and its version, the n≥20 rule stated out loud. Farmer can check our math = ultimate Kennedy proof. Also an SEO page for free.
7. `/straight-answers` — small FAQ, objections only, 6-8 max: Is it free? Why? Are you a lender? Who sees my numbers? What happens to the photo? What if my deal is good?
8. `404` — one line, go-home link, on voice.

**Email plumbing (law, not pages):**
- **Every send this product makes is a send that was requested.** The teardown is asked for. The expiry reminder is opted into on a second screen, after the teardown, and only when the farmer's own paper carried a date. Nothing is sent because we decided he might like it. That posture is what satisfies CAN-SPAM and Canada's CASL at the same time, and CASL is the stricter of the two: it wants consent, not merely an exit. Counsel confirms the details.
- Every email: one-click unsubscribe + postal address. CAN-SPAM, no exceptions.
- No SMS v1. TCPA is a swamp; enter only with lawyer.
- Log consent forever: timestamp + exact text version farmer saw (`consent_text_version`). Receipts protect cave too.

**Ads measurement tension (decided, don't drift):** doctrine says no tracking cookies, no banner. Meta test still needs conversion signal. Answer: server-side Conversions API on decode/email/interest events, first-party only, disclosed in `/privacy`. No third-party pixel cookie → no-banner stance holds. If lawyer disagrees, banner is one quiet line, never a modal wall.

**LAWYER STONES — spend $2-5k BEFORE any consent button goes live. Not optional:**
1. **State commercial-finance broker laws.** Some states make "introduce borrower to lender for money" a licensed activity. Lead-gen vs. broker line is drawn per state by a fintech lawyer, not by us. May mean geo-gating the consent feature to safe states at launch — tool math itself fine everywhere.
2. **CCPA/CPRA** sale/share analysis + DNSMPI mechanics.
3. **"Not a broker" wording** — might become false in some states the day leads sell. Words follow law, not vibes.
4. **FTC lead-generator guidance** — bless the consent-flow wording.
5. **LoanHank USPTO clearance** (aggregator zero-hit ≠ clearance). Before hats.

**Not building:** cookie-consent modal wall, live chat, accessibility statement page (just BE accessible per design doc), refund page (free tool).

---

## 11. PROCESS

- **Week 1:** steal engine. build page. wire decode. ship live.
- **Week 2:** PDF + email send. benchmark table seeded from published equipment rate cards. ads live.
- **Daily (10 min):** look funnel numbers. no dashboard building. `ops/funnel.sql`, one query.
- **Weekly:** read every uploaded quote (anonymized). free market research nobody else has. new quote shapes → new fixtures.
- **Quarterly:** re-check benchmark sources, re-snapshot, update the table.
- **Now, manual:** call 3 equipment finance brokers. ask: "verified dealer quote, farmer asked for competition, buying this week — what you pay?" price discovery before automation.

---

### 11.1 Session discipline

- Typecheck + full tests before every commit. Main is always deployable.
- **Every session ends with `git push` and a green CI run, and the session report cites that run.** Local-only history is not history: it is one machine's opinion, invisible to review, and lost with the machine. It is also how eleven verification rows sat unflagged across a session boundary, each session assuming the other could see what the first had done.

  A session that cannot push says so in its report rather than ending quietly.

---

## 12. DO-NOT LIST (carve in stone)

- No app store. No native app. Web only.
- No accounts. No login. No portfolio. No watches. v1 = one page.
- No Canada v1 (keep the Canada math, it's the expansion path).
- No lead move without farmer button-push, and no consent button before counsel. No dark pattern. Tribe small, tribe talk.
- No "not a lead form" copy — that old promise, old product. New honest words: "Free tool. If you want lenders to compete, you tell us. Otherwise your numbers go nowhere."
- No new research loop. Idea validated twice (own audit + field evidence). Next validation = market, $500, one week.

---

## 13. DECISIONS

Architectural choices of record. Change one only by editing this table in the same commit as the code.

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Database | **D1.** No Supabase anywhere, code or refs | one vendor, one worker, pile is SQLite-scale for years |
| 2 | Page delivery | **Server-rendered HTML from the worker, no client framework.** Form works as a plain POST; photo path is the only JS | 150KB budget, no-JS fallback is law, rural LTE |
| 3 | Router | Hono | already in the code, fine |
| 4 | Migrations | `wrangler d1 migrations`, `migrations/0001_init.sql` implements §5.1 | append-only law |
| 5 | Extraction model | one vision-capable model behind a thin interface in `src/api/extractor.ts`; provider key via secret; hard monthly spend cap set at the provider | swappable, cost-capped |
| 6 | Email | Resend (or Postmark if deliverability testing says so), from `mail.loanhank.com` | CAN-SPAM plumbing per §10 |
| 7 | Anti-abuse | Turnstile invisible on submit + per-IP rate limit on `/extract` + max upload size | each decode costs real money |
| 8 | Analytics | the `events` table + `ops/funnel.sql`. No third-party analytics, no pixel; Meta via server-side CAPI later | measure-or-dead without tracking cookies |
| 9 | Consent route | **Deferred.** `POST /interest` ships now (non-binding, §8 Phase A); a real consent route ships only after the lawyer stones clear | Phase A measures intent without brokering |
| 10 | Email provider pick | **Pending** — Resend vs Postmark, decided by deliverability testing (§14) | has DNS lead time, decide early |
| 11 | Fonts | Libre Franklin + Courier Prime, subset woff2, self-hosted from the worker | no third-party font CDN, 150KB budget, no tracking |

---

## 14. LAUNCH CHECKLIST

Check off before ads spend a dollar.

- [ ] **Migrations.** `migrations/0001_init.sql` implements §5.1: decodes with full ledger + forage fields, emails with `consent_text_version`, benchmarks with `source_url`/`as_of_date`/`snapshot_key`, events.
- [x] **Funnel query.** `ops/funnel.sql`, run by `pnpm funnel`. One query, not a dashboard. The runner exists because `d1 execute --remote --file` silently prints no rows and `--command` rejects newlines and leading comments; the traps are written down in `ops/funnel.mjs`.
- [ ] **Backups.** Nightly D1 export to R2 (scheduled worker). D1 Time Travel covers ~30 days; the pile must outlive any mistake. **Test a restore once before ads run** — an untested backup is a rumour.
- [x] **Photo retention is code, not a dashboard click.** `infra/r2-lifecycle-quotes.json`, applied by `pnpm infra:r2`, which reads the rule back. R2 lifecycle granularity is one day, so the rule cannot express the ten-second promise: the reaper on the 15-minute cron keeps that promise and this rule caps the worst case at a day. Both halves must be live before a single photo is accepted.
- [x] **Backup retention.** `infra/r2-lifecycle-backups.json`, 90 days, so `loanhank-backups` does not grow forever.
- [ ] **CI.** GitHub Actions: typecheck + tests + `test:eval` gate on PR; deploy on merge to main. The eval gate is what lets extraction prompts change safely.
- [ ] **Cost + abuse protection on `/extract`.** Max upload size (`security.ts` has bones — verify), Turnstile invisible mode on submit, hard monthly spend cap + alert on the LLM provider account. An abuse script hitting `/extract` is a bill, not an outage. Turnstile belongs on the photo path only: it needs JS, and the typed form must keep working without any (design.md §9).
- [x] **Per-IP rate limit.** Native Workers rate limiting binding, 20 a minute per route per hashed IP, on `GET /` and `POST /decode`. Verified live: the twenty-first decode gets a 429. The form still renders when the page-view limit trips, because an undercounted funnel beats a farmer who cannot see the tool.
- [x] **Email deliverability.** Resend, sending from `hank@mail.loanhank.com`, domain verified. DMARC is inherited from `loanhank.com` at `p=none`; tighten later.
- [ ] **Tighten DMARC to `p=quarantine`** after the first few weeks of clean sending. **The clean-send clock starts 2026-08-16**, the first real delivery from `mail.loanhank.com`. `p=none` is right while nothing has sent; leaving it there once mail is flowing is leaving the door open.
- [ ] **Real name and photograph for `/whos-behind-this`.** The page currently admits it is unfinished rather than inventing a byline. An anonymous site about money is a fair thing to distrust, and this is the biggest trust page there is.
- [x] **Postal address for the CAN-SPAM footer.** `LoanHank · 109b - 1917 Peninsula Rd, Ucluelet, BC V0R 3A0, Canada`, versioned in `wrangler.jsonc` and printed verbatim on `/contact`, in every email footer, and in the teardown PDF. The country is included because most recipients are American.
- [ ] ~~Pick provider (Decision 10).~~ Send from `mail.loanhank.com`. SPF + DKIM + DMARC; DMARC starts `p=none`, tighten later. Postal address for the CAN-SPAM footer before the first teardown sends.
- [ ] **Meta Business setup — start NOW, has lead time.** Business Manager + business verification + domain verification on loanhank.com + Conversions API token. Verification can take days-to-weeks.
- [ ] **Eval samples.** Mystery-shop 12-15 dealers + forum-posted quote photos + synthetic print-and-photograph pipeline (20 docs × 5 conditions). Golden holdout of 5, never tuned against. Metric #1: false-confidence rate = 0.
- [ ] **Tax-edge golden fixture.** At least one where cash-deal tax ≠ finance-deal tax (§2.1).
- [ ] **Turnstile domains at cutover.** The widget currently allows `loanhank-decoder.supersonicworkers.workers.dev` so the photo path could be verified before the custom domain exists. **Remove that host from the widget the day loanhank.com cuts over**, or a retired hostname keeps issuing tokens the backend would accept.
- [ ] **Extraction eval from the field.** Once decodes are flowing, read the extracted-versus-confirmed diffs weekly. Fields the farmer corrects most are the next prompt or fixture.
- [ ] **Day-one pages** (§10, all eight) live and footer-linked.
- [ ] **Lawyer stones** (§10) — before any consent button.
- [ ] **USPTO clearance** on LoanHank — before hats.
- [ ] **Real-face photo** for `/whos-behind-this` — real camera.
