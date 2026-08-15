# QUOTE DECODER — CAVE SPEC

## BLURB

Dealer show farmer shiny quote. Quote hide real rate. "0% financing" not 0%. Discount is secret interest. Farmer smell trick. Farmer cannot do math.

We give farmer club: point phone at quote → see real rate → see real cost → see quote vs what other farmers pay (Fed numbers). Free. Fast. No login. Sixty seconds.

Farmer trust us because we only tribe at table not selling him something. Sometimes we say "dealer deal good, take it." This why farmer believe us.

Farmer with quote in hand = best lead in America. Buying THIS WEEK. When farmer say "make lenders fight for my deal" — we sell that lead. That the business. Tool free forever. Lead only move when farmer say go. Never sneak. Sneak once on AgTalk = tribe exile forever.

Site headline: **"Point your phone at the dealer's quote. See the number they didn't print."**

## ONE BIG WARNING BEFORE BUILD

Old cave have magic spear: `src/finance/index.ts` (1,175 line money math) + 5,700 line test pit. Canada test. Extraction-security test. Privacy test.

**CARRY SPEAR TO NEW CAVE. DO NOT CARVE NEW SPEAR.** Copy folder. Copy tests. New math = new bugs = wrong number shown to farmer = brand dead day one. Whole brand IS "number right."

Everything else — screens, auth, watches, portfolio — leave in old cave. Let sleep. Year-end PDF module (`report-pdf.ts`) also good loot — take later, January weapon.

## ARCHITECTURE

Small. Boring. One worker.

```
Cloudflare Worker (Hono)
 ├─ GET  /            → the page (form + photo button). server-render or tiny Vite. NO LOGIN.
 ├─ POST /extract     → photo → vision LLM → fields. farmer CONFIRMS every field. photo deleted after.
 ├─ POST /decode      → fields → engine → real APR, total cost, cash-vs-finance, verdict vs benchmark
 ├─ POST /email       → save email, queue PDF teardown send
 └─ POST /consent     → farmer say "lenders compete" → lead row born
D1 (or Supabase, pick one, no both)
 ├─ decodes   ← THE GOLD. see DATA ENGINE + TREASURES below. no PII, no dealer name.
 │    (id, ts, quarter, state, region, equip_category, new_or_used,
 │     price, price_band, structure_type [0pct_discount|standard|lease|balloon],
 │     term_months, stated_rate, cash_discount, down_pct,
 │     implied_apr ← golden column, engine-computed,
 │     benchmark_at_ts, delta_vs_benchmark,
 │     -- forage fields: grab if on paper, NEVER require --
 │     brand, model_year, hours, list_price, down_payment,
 │     trade_in_value, fees_json, lender_type [captive|bank|fcs|cu|unknown])
 ├─ emails    (email, decode_id, consented bool, consent_ts)
 └─ benchmarks (Fed rates by loan type + quarter. HAND-ENTERED. cron later, not now)
```

Rules of cave:

- Engine = pure functions. No fetch inside. No DB inside. Same input → same output. All money math lives here, NOWHERE else. UI never do arithmetic. UI only paint engine output.
- Photo: extract → confirm → DELETE. No account numbers ever stored. Same privacy doctrine as old cave. This is sales weapon, not chore.
- US only v1. Fed benchmark data exist for US. Canada later (Canada compounding different — spear already know this, tests already in pit).

## REPO

```
/engine     ← stolen spear + stolen tests. touch only with test first.
/api        ← worker routes. thin. dumb. call engine.
/web        ← one page. form, confirm screen, result screen. that all.
/tests      ← engine tests (stolen), api tests, 1 e2e (photo→result)
/ops        ← runbook.md, benchmarks.md (Fed table + source links), ads.md (copy variants), leads.md (buyer list)
```

Method:

- Money math = test FIRST, then code. Always.
- Every real quote uploaded → becomes anonymized fixture in test pit. Quote pile = moat.
- Main branch always deployable. One command ship (`wrangler deploy`). No staging theater.
- No feature before funnel number demand it. **No build barn before have cow.**

## FUNNEL

```
Meta ad ($500 test)
  "0% financing isn't 0%. Point your phone at the quote. See what it really costs."
   ↓ click
THE TOOL IS THE LANDING PAGE. no brochure page. form above fold.
   ↓ type 4 numbers (price, discount, term, payment) OR photo
INSTANT ANSWER. no gate. real APR big font. verdict vs Fed benchmark. honest — sometimes "deal good."
   ↓ gate 1 (soft)
"Want full teardown PDF?" → email
   ↓ gate 2 (explicit, farmer push button)
"Want lenders compete for this deal?" → consent → LEAD
   ↓
sell lead to equipment-finance broker/lender. manual first: email + spreadsheet to 3 buyers. no API until money.
   ↓ later
email owns farmer: benchmark updates, year-end tax PDF (January), maturity pings → repeat leads
```

Value before email. Email before consent. Consent before handoff. Never reorder. This the whole religion.

## NUMBERS DECIDE, NOT FEELINGS

Write on cave wall BEFORE spend $500:

| step | good | bad = stop, fix, retest |
|---|---|---|
| click → completed decode | ≥ 25% | < 10% kill page, fix flow |
| decode → email | ≥ 20% | < 8% PDF offer weak |
| email → consent | ≥ 10% | < 3% consent copy weak |
| $ per consented lead | ≤ $50 | > $150 funnel broken |

(garbage form-fill industry sell junk leads at $600/mo minimums. our lead = verified quote, real intent, this-week buyer. worth multiples. 2-3 broker calls confirm price.)

One week data > one month opinion. If numbers good → scale spend. If bad twice → THEN rethink. No new strategy hunts between tests. **No more cave-painting. Throw spear.**

## DATA ENGINE (THE MOAT)

Every decode = one row of truth nobody else in America has: real dealer quote, real structure, real implied APR, dated. Form-fill competitors have name + phone. We have the market itself. After 10,000 rows, uncatchable.

**Golden column: `implied_apr`.** Engine computes it for every quote (0% w/ discount → real rate; lease → money factor → rate; standard → stated). One comparable number across all structures. Everything ranks on it.

**Cohort = how quotes become comparable:**
`equip_category × new_or_used × term_band (0-48/49-72/73+) × price_band × quarter`. Region split later, when rows enough.

**Stats: caveman math, no ML.** Pull cohort rows in worker, sort, take median + p25/p75 + your-percentile. SQLite/D1 fine at this scale. No warehouse until 50k rows.

**Cold start — three phases, honest at every step:**

| phase | rows in cohort | farmer sees |
|---|---|---|
| 0 | < 20 | vs Fed benchmark + published rate sheets (AgDirect posts live tiers) only. say "vs published rates" |
| 1 | ≥ 20 | "median for used tractors, 60-72 mo, this quarter: 7.4% (n=143). you: 8.9% — higher than 78%." ALWAYS show n |
| 2 | thousands | quarterly "State of Farm Equipment Financing" report from the pile. free, public, sourced. = PR + SEO + authority + what lead buyers drool on |

**Stone rules:**
- NEVER show peer stat with n < 20. Fake percentile = lie = brand dead. Show benchmark instead, say so.
- NEVER store or show dealer name. Photo extraction DROPS it. "Dealer X bad" = lawsuit. We rank quotes, not dealers.
- Always print n next to any peer claim. Honesty is the costume AND the body.
- Row count itself = marketing. "Compared against 12,000 real quotes" — number goes in ad when number big.
- Flywheel: more decodes → tighter medians → better answer → better ad claim → more decodes. Feed it, never fake it.

## QUOTE PILE TREASURES (FORAGE LIKE ALPHA)

Pile worth more than leads. Ten treasures sleep in it. Forage all, from day one, so no gold lost.

1. **PRICE DATABASE — buried king.** Valuation data locked behind paywalls (Sandhills, EquipmentWatch). This why Trade Check idea died. But every quote carry price + model + year + hours. Pile slowly rebuild the locked database — FREE, as exhaust. Dead idea come back to life without paying.
2. **SUBVENTION DEPTH — Wall Street meat.** Cash-discount size = manufacturer's secret subsidy. Deere buy rate down hard = channel weak. Track buydown depth by brand by quarter → demand-health signal for DE / CNH / AGCO tickers. Analysts pay big for signal nobody else have.
3. **DEMAND INDEX.** Quote volume by category × region × week. Quote come BEFORE purchase = leading indicator. Fresher than anything USDA or dealer group publish.
4. **STRESS SIGNALS.** Term creep (60→72→84 mo). Balloon/lease share rise. Down payment shrink. = ag-credit stress measured at the desk, quarters before Fed surveys see it. Journalists + researchers eat this. Free authority.
5. **COMPETITION GAP MAPS.** Delta-vs-benchmark by region + lender type = map of where spreads fat because nobody compete. Sell map to lenders as expansion intel. Price own leads from fat-spread regions HIGHER.
6. **LEAD SCORING — direct money.** Quote 200bp over cohort median = lead that almost surely convert for competing lender. Tier lead price on beatability. "We know quote is beatable" = pitch no form-fill shop can make.
7. **JUNK-FEE INDEX.** Which add-ons appear, cost, how often forced insurance show up. Consumer-protection content. Farmers share it around fire.
8. **TIMING INTEL.** Seasonality of promos + prices → "December quotes on this iron run cheaper" → farmer-facing negotiation content. Keep tool magnetic between purchases.
9. **SEO PAGES NOBODY CAN COPY.** Every cohort median = a page. "Average used combine financing rate 2026." Competitor can copy words, not data under words.
10. **BETTER SPEAR.** Every new quote format = new extraction fixture. Accuracy compound.

**Forage stones (carve deep):**
- Capture forage fields from day one even if unused. Grab if on paper. NEVER require. Empty field fine, lost field gone forever.
- Sell AGGREGATE only, forever. n ≥ 20. No row-level sale. No dealer names. ToS line from day one: "anonymized, aggregated market statistics." Farmer data never leave cave raw.
- Know the bias: pile over-index suspicious farmers with bad quotes. Quoted ≠ funded. Say so in public report, or smart people debunk report and authority die.

## PROCESS

- **Week 1:** steal engine. build page. wire decode. ship live.
- **Week 2:** PDF + email send. benchmark table (Chicago Fed Q1-26: operating 7.08%, real estate 6.74% — update quarterly). ads live.
- **Daily (10 min):** look funnel numbers. no dashboard building. numbers in one SQL query.
- **Weekly:** read every uploaded quote (anonymized). this = free market research nobody else has. new quote shapes → new fixtures.
- **Quarterly:** update Fed benchmark table when AgLetter / KC Fed drop.
- **Now, manual:** call 3 equipment finance brokers. ask: "verified dealer quote, farmer asked for competition, buying this week — what you pay?" price discovery before automation.

## PAGES + LEGAL (boring pages that keep cave safe)

All footer-linked. All Hank voice: plain-words summary box on top, lawyer text under. A 40-page SaaS-template ToS smells robot AND scam. Short and plain wins twice.

**Day-one pages (ship with tool):**

1. `/privacy` — law requires + Meta ads demand a privacy URL before ads run. Must say plainly: what we take (quote numbers; email if you give it; photo for ~10 seconds), photo deleted after reading, anonymized aggregate stats kept forever (this line = license for the treasure pile — no line, no pile), nothing personal moves without your go. **California catch: farmer-consented lead handoff = "sale/share" of personal info under CCPA — and if >50% of revenue comes from it, the law applies at ANY company size. Need "Do Not Sell or Share My Personal Information" link + a rights process.**
2. `/terms` — not financial or tax advice, math shown and farmer confirms inputs, no savings guaranteed, aggregate-data license, the "not a lender / not a broker" sentence ONLY as lawyer approves (see stones).
3. `/how-we-make-money` — the Kennedy damaging admission gets its own page: free tool, farmer pushes go, lenders pay for the introduction, that is the whole business. ALSO linked right next to the consent button — FTC wants disclosure clear, conspicuous, and near the action, not buried in footer.
4. `/contact` — real email, real postal address (PO box fine — CAN-SPAM requires postal address in every email anyway).
5. `/whos-behind-this` — REAL name, REAL face, real camera, two paragraphs. Machinery Pete works because Pete is a person. Anonymous finance site = scam smell. Biggest trust page on the site.
6. `/how-we-figure-it` — show the work: formulas in plain words, benchmark sources + dates + links, what implied APR means, the n≥20 rule stated out loud. Farmer can check our math = ultimate Kennedy proof. Also an SEO page for free.
7. `/straight-answers` — small FAQ, objections only, 6-8 max: Is it free? Why? Are you a lender? Who sees my numbers? What happens to the photo? What if my deal is good?
8. `404` — one line, go-home link, on voice.

**Email plumbing (law, not pages):**
- Every email: one-click unsubscribe + postal address. CAN-SPAM, no exceptions.
- No SMS v1. TCPA is a swamp; enter only with lawyer.
- Log consent forever: timestamp + exact text version farmer saw. Add `consent_text_version` to emails table. Receipts protect cave too.

**Ads measurement tension (decide now, don't drift):** doctrine says no tracking cookies, no banner. Meta test still needs conversion signal. Answer: server-side Conversions API on decode/email/consent events, first-party only, disclosed in `/privacy`. No third-party pixel cookie → no-banner stance holds. If lawyer disagrees, banner is one quiet line, never a modal wall.

**LAWYER STONES — spend $2-5k BEFORE consent button goes live. Not optional:**
1. **State commercial-finance broker laws.** Some states make "introduce borrower to lender for money" a licensed activity. Lead-gen vs. broker line is drawn per state by a fintech lawyer, not by us. May mean geo-gating the consent feature to safe states at launch — tool math itself fine everywhere.
2. **CCPA/CPRA** sale/share analysis + DNSMPI mechanics (see privacy above).
3. **"Not a broker" wording** — might become false in some states the day leads sell. Words follow law, not vibes.
4. **FTC lead-generator guidance** — bless the consent-flow wording.
5. Still open from research: **LoanHank USPTO clearance** (aggregator zero-hit ≠ clearance). Before hats.

**Not building:** cookie-consent modal wall, live chat, accessibility statement page (just BE accessible per design doc), refund page (free tool).

## DO-NOT LIST (carve in stone)

- No app store. No native app. Web only.
- No accounts. No login. No portfolio. No watches. v1 = one page.
- No Canada v1.
- No lead move without farmer button-push. No dark pattern. Tribe small, tribe talk.
- No "not a lead form" copy — that old promise, old product. New honest words: "Free tool. If you want lenders to compete, you tell us. Otherwise your numbers go nowhere."
- No new research loop. Idea validated twice (own audit + field evidence). Next validation = market, $500, one week.