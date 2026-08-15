# Research — Quote Decoder

**Compiled:** August 15, 2026
**Trimmed:** August 15, 2026, after the pivot from loan-portfolio manager to zero-financing quote decoder.
**Scope of this file:** only the evidence that still bears on the decoder funnel.

> **What changed.** The original research validated a US+Canada farm-loan portfolio product: document intake, X-Ray, portfolio view, scenarios, payment calendar, maturity watches. That product is cancelled. This file keeps the evidence for the surviving wedge and drops the rest.
>
> **Full original, unedited:** `docs/archive/Research-full-2026-08-15.md`. It holds the Canada section (Interest Act s.6, CORRA, FCC), the debt-service and cash-flow evidence, renewal rate shock, prepayment penalties, and the portfolio validation. Go get it if the product ever turns back that way. Nothing was deleted, only moved.

Confidence tags: **[HIGH]** = read the actual page. **[MED]** = read the page, small detail unconfirmed. **[UNVERIFIED]** = could not confirm, do not put it in marketing copy.

---

# PART ONE — THE WEDGE

## 1. "0% isn't 0%" — the single hottest nerve

This is the sharpest, most repeatable, most emotionally charged cluster found anywhere in the corpus, and the one where farmers most explicitly say **they cannot do the math themselves**. It is the entire product.

A farmer posted a thread titled literally **"Biggest issue with equipment financing?"** ([r/farming, 2024](https://www.reddit.com/r/farming/comments/1ez2ydf/biggest_issue_with_equipment_financing/)). The top reply: **[HIGH]**

> u/Prostock26: *"I always LOL at the 0% interest price is always like 3k higher then the 'cash' price. Sir that is not '0% interest' then"*

An entire dedicated thread exists on this in r/tractors — **"0% financing but with cash discount?"** ([2024](https://www.reddit.com/r/tractors/comments/1bydns5/0_financing_but_with_cash_discount/)). The opening post: **[HIGH]**

> *"That's exactly the same as charging interest, but lying about the price."* … *"Feels like it violates some kind of truth in advertising laws."*

The OP's actual numbers: **$3,000 "cash discount" on a ~$28k tractor, 7-year loan.** They knew they were being charged something. They did not compute what.

Replies confirm the mechanism from inside the dealership: **[HIGH]**

> u/Prior-Profile-8410 (dealership mechanic): *"I can assure you the 0% rate is gonna cost you same total as regular rate"*
>
> u/Natenate25: *"They offer 0% but charge the dealer the buydown. It costs us 8% of the total amount financed…"* — and then the thesis statement: ***"0% is never really 0%. It has to be paid for somewhere."***

And the counter-argument, which is *also* useful because it proves the number is genuinely non-obvious: **[HIGH]**

> u/Auton_52981: *"Generally 0% with a cash discount is nothing like interest on the cash price because there are so many variables with a loan."*

**Why this is the whole business:** a thread where farmers argue about arithmetic and nobody produces the number. Both sides are partly right, which is exactly the condition under which a tool wins.

The Natenate25 quote is also the source of treasure #2 in the master prompt. The dealer buydown cost (*"8% of the total amount financed"*) is the manufacturer's subsidy depth, spoken out loud.

## 2. The rate is deliberately hard to compare

**[HIGH]** — [r/tractors, "Financing. Dealer or Local bank?", ~July 2026](https://www.reddit.com/r/tractors/comments/1v98g3u/financing_dealer_or_local_bank/):

> u/Northwoods_Phil: *"there are all sorts of games they play with financing sometimes. Get it quoted every which way and compare all the hidden fees"*
>
> u/EnrichedUranium235: *"Is the money back or discount if offered better than the lower interest rate for you? Depends."* … *"you have to do the math for each situation"* — and flags two hidden cost drivers: dealer-required insurance as *"an additional monthly fee,"* and package deals that *"roll that cost into one loan."*

That thread's OP had a straightforward question, dealer or bank, and got seven answers, none of them a number.

Supports the junk-fee index (treasure #7) and the `fees_json` forage field.

## 3. Same machine, wildly different rate, depending on how it gets *classified*

**[HIGH]** — [r/tractors, "Financing a used tractor", ~April 2026](https://www.reddit.com/r/tractors/comments/1sd4j3t/financing_a_used_tractor/):

> u/badadvicegoodintent (OP update): *"credit union treats it as an unsecured loan, so interest rates were over 10%. Lowest rate was with agdirect"*

Same used tractor, same borrower, same week: **10%+ vs. a specialty ag rate.** The only variable was which lender's box it fell into, and the farmer discovered this by cold-calling.

**This is the consent gate's reason to exist.** A farmer cannot run that experiment manually, and the spread he is leaving on the table is the value of the introduction we sell. Also supports the `lender_type` forage field and treasure #5, the competition gap map.

Also from that thread: *"AgDirect requires a minimum of $25,000 to finance"* (u/JohnD4230). A structural gap: sub-$25k buyers get pushed to worse paper. Relevant to lead scoring, since those quotes will read as beatable but may not be.

## 4. Farmers who do not know their own rate

**[HIGH]** — [r/farming, "Who do you finance inputs with?", 2023](https://www.reddit.com/r/farming/comments/15l27tw/who_do_you_finance_inputs_with/):

> u/NMS_Survival_Guru, who states he takes *"about $2mil in operating loans each year for the past 10yrs"*: ***"I really don't know the rate on it as my grandmother still handles the books"***

$2M a year, ten years running, rate unknown to the operator. In the same thread others quote precise input-financing rates (*"1.9% interest on seed through JD"*, *"0%"* on seed), so the knowledge exists in the community, it is just unevenly held.

## 5. Lease quotes are opaque too

**[HIGH]** — [r/farming, "Can someone explain the case for leasing equipment?", 2024](https://www.reddit.com/r/farming/comments/1bkhav0/can_someone_explain_the_case_for_leasing_equipment/). The OP asks a clear question about a $400,000 tractor. The top answer:

> u/IAFarmLife: *"This would be a case by case decision that you should ask your tax professional"*

Every substantive reply routes to a professional. The thread never produces a comparison.

**Decoder relevance:** `lease` is one of the four `structure_type` values, and money-factor-to-APR conversion is part of the golden column. This thread is the evidence that a lease quote is opaque enough to be worth decoding. It is *not* evidence for a lease-vs-buy advisory feature, which is out of scope.

## 6. Terms lengthening, rates sticky

**[HIGH, verified]** — [AgTalk "Best Equipment Loans", 8/8/2017](https://talk.newagtalk.com/forums/thread-view.asp?tid=723914): user *hay-okie* reports AgDirect's rate moving 3.95% → 4.55% in two years with **loan terms cut from 10 years to 7 max**, concluding *"We would need a 20 year loan to make it feasible now!"*

**[HIGH, verified]** — [AgTalk "What are typical bank terms/rates on equipment loans", 11/2007](https://talk.newagtalk.com/forums/thread-view.asp?tid=34782): user *pknoeber* notes Farm Credit at 6.5% fixed vs. smaller banks at *"9.25% rates"* on the same used equipment, and explains the collateral logic: *"the bank only loans 75% of the value…b/c that's what the item will sell for at an auction."*

Supports the `term_band` cohort split (0-48 / 49-72 / 73+) and treasure #4, term creep as a stress signal.

## 7. "Make them compete" — the consent gate, in the industry's own words

**[HIGH]** — [r/farming, "Loan advice", 2023](https://www.reddit.com/r/farming/comments/16h7owi/loan_advice/), from a self-identified Farm Credit lender:

> u/Mke_already: *"Compare what they're saying, also MAKE THEM COMPETE FOR RATES."* … *"Margins are far too tight in farming to just take the first rate thrown at you."*

The advice from inside the industry is *compare*. Nothing gives the farmer a comparable number. This quote is the closest thing in the corpus to a farmer-side blessing of the lead product, and the consent copy should echo its verb.

## 8. Distrust of lender math (tone constraint, not a feature)

**[HIGH, verified]** — [AgTalk "Loans", 8/10/2025](https://talk.newagtalk.com/forums/thread-view.asp?tid=1210519):

> *dittfarms*: *"When I take out a loan I feel like I get scrutinized to no end."*
> *7200R*: *"I've been turned down on loans in the past and cannot figure out why. One banker I asked said it was because I didn't barrow enough in the past??"*

**[HIGH]** — [r/farming, "Denied our operating loan today", Feb 2024, 190 pts, 92 comments](https://www.reddit.com/r/farming/comments/1awpkh1/denied_our_operating_loan_today/):

> u/PurpleCow88 (OP): ***"It feels like the only way they'll give you money is if you already have the equivalent amount sitting in your bank account."***

**Why it stays in a decoder-only file:** it sets the tone rules. The audience assumes anyone holding the number has an angle. That is why "you confirm every number," "we sometimes say take the deal," and the `/how-we-make-money` page are not decoration. It is also why the lead-gen tension in §12 is the real risk.

---

# PART TWO — MARKET AND TOOLING

## 9. The tooling gap

**What farmers actually use:** **[HIGH]** — [r/farming, "How do you keep track of your income and expenses?"](https://www.reddit.com/r/farming/comments/8mlxo3/how_do_you_keep_track_of_your_income_and_expenses/):

> u/NotaWizardOzz: Google Sheets + *"Keep receipts together for a paper copy."*
> u/neubs: ***"big pile of receipts in a box"***

**[HIGH, verified]** — [AgTalk "Loan calculator", 1/2/2011](https://talk.newagtalk.com/forums/thread-view.asp?tid=204711): a farmer wanted a tool to *"compare three different loans side by side."* The community's best answers were Excel, Quicken, and QuickBooks. **Fifteen years later, the answers in the equipment threads above are still Excel and phone calls.**

**Competitive landscape (verified against primary sites unless noted):** every ag-specific software product found — Ambrook, FarmRaise, Figured, AgriWebb, Harvest Profit, Traction Ag, PcMars, AgExpert, FarmKeep — is built around income/expense/production accounting. None surfaced amortization, document extraction, or rate benchmarking on their own marketing pages. FarmBooks appears defunct.

The only true amortization engine found, **Amorta** ($79–249/mo), is sold to *accounting firms*. Single-loan planning calculators exist (farmfinancetool.com, AgBizInfo, lender calculators) but they ask you to supply the rate.

**Nothing found solves for the rate from a dealer quote.** **[MED — absence-of-feature is only as good as the pages checked.]**

## 10. US macro — is the problem real, and where do benchmarks come from

- **Farm loan rates, Chicago Fed Q1 2026:** operating **7.08%**, feeder cattle **7.12%**, real estate **6.74%**. ([AgLetter May 2026](https://www.chicagofed.org/publications/agletter/2025-2029/may-2026)) **[HIGH]** — *this is the seed row for the `benchmarks` table.*
- **Market size:** 1,900,487 US farms (2022 Census, −7% vs 2017); **437,310 farms reported interest expense in 2022, 23% of all farms.** ([NASS](https://www.nass.usda.gov/Newsroom/2024/02-13-2024.php)) **[HIGH]**
- **Total US farm sector debt: $624.7B forecast for 2026, +5.2%** — non-real-estate $220.4B. Debt-to-asset forecast 13.75%, ERS says solvency *"is forecast to continue to worsen."* ([USDA ERS, May 19 2026](https://www.ers.usda.gov/topics/farm-economy/farm-sector-income-finances/assets-debt-and-wealth)) **[HIGH]**
- **Interest expense is the fastest-growing production cost.** 2024 interest expense **$31.5B, up over $8.5B (+37%) vs 2020**, *"the fastest increasing production item category."* ([Choices, Q4 2025](https://www.choicesmagazine.org/choices-magazine/submitted-articles/labor-and-interest-expenses-of-american-farms-and-ranches)) **[HIGH]**
  - ⚠️ **Do not publish a single "interest expense" number without checking scope.** USDA's three series disagree materially: ERS sector accounts (~$28–34B), NASS Farm Production Expenditures (~$11.6–12.8B for 2023–24), 2022 Census Table 4 ($41.8B). No reconciling note found. **[FLAGGED]**
- **Chicago Fed AgLetter, Q4 2025:** 5.6% of loans with *"major or severe"* repayment problems, **highest since mid-2020**. ([Feb 2026](https://www.chicagofed.org/publications/chicago-fed-insights/2026/february-agletter-insights)) **[HIGH]**
- **Balloon prevalence: NO STATISTIC EXISTS** that could be found. [Iowa State C5-93](https://www.extension.iastate.edu/agdm/wholefarm/pdf/c5-93.pdf) teaches the structure as standard; [12 U.S.C. § 2015(a)(1)](https://www.law.cornell.edu/uscode/text/12/2015) permits 5-year terms against far longer amortizations. **Enough to justify decoding balloon structures, not enough to publish a prevalence claim.** **[FLAGGED]**

**Canada is parked.** US only for v1. The one fact that will matter when it returns: semi-annual not-in-advance compounding is a statutory default under [Interest Act, RSC 1985, c I-15, s.6](https://laws-lois.justice.gc.ca/eng/acts/i-15/FullText.html), so a US monthly-compounding assumption produces a wrong Canadian number. The engine already knows this and the tests already cover it. Full Canadian section is in the archive.

---

# PART THREE — VERDICT, RISK, COPY

## 11. Decoder verdict

| Element | Verdict | Evidence |
|---|---|---|
| **The 0%-vs-cash-discount wedge** | **Strongly validated** | §1. Highest-intensity, most repeatable cluster in the corpus. Farmers argue about it and nobody produces the number. |
| **Solving for the implied rate** | **Validated as the missing thing** | §1, §2, §9. Every existing calculator asks the farmer to supply the rate. That is the gap. |
| **Farmer confirms every extracted number** | **Validated** | §8. The trust deficit is the problem. A tool that *guesses* dies here. This is the license to operate, not a UX nicety. |
| **Benchmark vs. published Fed rates** | **Validated, US-strong** | §10. Chicago Fed publishes farm loan rates by purpose, quarterly. Real, citable, free. |
| **Cohort medians with n shown** | **Validated by absence** | Nothing in §9 has this data. It cannot be bought. The n≥20 rule is what keeps it honest. |
| **Honest "this deal checks out" verdict** | **Validated as essential** | §8. Neutrality is the only thing separating us from every other party at the table. |
| **Green-or-amber, never red** | **Keep** | Farm financial distress is tied to farmer mental health in published research (AFBF/Morning Consult 2019: 91% said financial issues affect farmer mental health). |
| **Selling consented leads** | **OPEN RISK — see §12** | The corpus is hostile to lead-gen. §7 is the one quote that cuts the other way. |
| **Portfolio, watches, calendar, scenarios, Canada** | **Out of scope** | Validated in the archive for a product we are not building. Do not build from the archive without a decision. |

## 12. The two risks the research actually surfaces

**Risk 1 — nobody searches for this.** The category does not exist in farmers' heads. **[HIGH]** Searched extensively: Reddit's ag communities have **no "is there an app for tracking my loans" thread.** Farmers do not conceive of it as a software category. They ask *"is 0% really 0%."*

> **Market the answer, never the category.** Copy that says "farm equipment financing software" will not connect. The go-to-market has to be an argument they are already having, and that argument is 0%-vs-cash-discount.

This is why the tool is the landing page and the ad headline is the community's own sentence.

**Risk 2 — the business model is the thing the audience distrusts most.** The original research found, and this file has not softened:

> *"No lender matching... Every farmer in the corpus can smell a lead-gen funnel. The absence of a sales motive is the asset."*

That was written about a product with no sales motive. This product has one. The master prompt's answer is radical transparency: `/how-we-make-money` linked next to the consent button, explicit farmer-pushed consent, and a verdict that sometimes says take the dealer's deal. §7 (*"MAKE THEM COMPETE FOR RATES"*, from a Farm Credit lender) is the strongest counter-evidence in the corpus, and §3 shows the spread is real money.

**This is doctrine, not evidence.** It is the single most important thing the $500 test measures, and the funnel table's email→consent row (≥10% good, <3% broken) is the number that settles it. Do not let a good decode rate hide a dead consent rate.

## 13. The burning question

> ### "What is this actually costing me?"

The emotional engine: every party who holds the number, dealer, lender, banker, accountant, is a party selling him something. The farmer is the only person in the transaction without the math.

**The real product is not calculation. It is the first number in the deal that isn't coming from someone with a stake in the answer.** And the moment we sell leads, that sentence needs the transparency page standing behind it.

## 14. Headlines that survive the pivot

The "I WANT THAT" test: a farmer says it when a headline states a number he knows he *should* have, admits he doesn't have it, and implies it takes a minute, without smelling like a pitch.

**Ad headline (Meta, v1):**
> **`0% financing isn't 0%. Here's what it actually costs you.`**

The literal community consensus (*"0% is never really 0%"*) turned into a promise. Highest click-through potential of anything tested, and narrow in exactly the way an ad should be.

**Landing headline (the tool page):**
> **`Point your phone at the dealer's quote. See the number they didn't print.`**

**Alternates worth testing, all still valid post-pivot:**
1. `Your dealer knows the real interest rate. Now you can too.`
2. `Before you sign: what that "0% for 84 months" is really charging you.`
3. `What's your real rate? Most farmers can't say. In 60 seconds, you can.`
4. `The $2,347 hiding in a $28,000 tractor quote.`
5. `You have the quote. You've never had the number.`
6. `A longer term isn't savings. We'll show you the difference.`
7. `Nobody in the deal is on your side of the table. This is.`
8. `The only number in your quote that isn't coming from someone selling you something.`
9. `You didn't get into farming to do amortization math.`
10. `The math on your iron, without calling the dealer back.`

**Do not say:** any variant of "take control of your farm debt" or "farm equipment financing platform." Those describe a category farmers don't shop for and carry the scent of the funnel.

**Also retired with the old product:** the live site's *"Know your loans. See every renewal coming."* — *"renewal"* is a Canadian mortgage word (US farmers say note, comes due, maturity), and *"know your loans"* states a category benefit instead of the arithmetic.

---

## Appendix — limitations, stated plainly

1. **Reddit was blocked at the network layer** in the research sandbox (`403 PROXY_REJECTED`, five independent agents). All Reddit findings were retrieved live through the user's own browser and read on-page.
2. **The WebSearch budget (200 calls) was exhausted** partway through, cutting short the AgTalk equipment-finance sweep and the balloon-prevalence hunt.
3. **AgTalk's keyword search is login-walled.** A free registered account would likely unlock the richest untapped vein in this space, **Machinery Talk**. Still the highest-value research next step, and it is now doubly valuable: those threads are also extraction fixtures and quote-shape samples.
4. **Quora is dead for North American ag finance.** Five searches. *"How do I finance farm equipment?"* — **"No answer yet · Last followed 6y."** Do not invest in it as a channel, but note the diagnostic: farmers asked, nobody answered.
5. **Unreachable this session:** TractorByNet, MyTractorForum, TheCombineForum, agriculture.com, RealAgriculture, The Western Producer, Facebook groups.
6. **Ten AgTalk/trade-press quotes from an earlier pass were independently re-verified**; eight confirmed exactly, two had detail errors, corrected inline before this trim.
7. **Name check:** Trademarkia exact-phrase searches returned zero results for "LoanHank." **[UNVERIFIED as clearance]** — not a USPTO search. Counsel before hats.
