# RATE + VERDICT LAW — v1.0 (2026-08-15)

Status: LAW. Where this conflicts with `master-prompt.md` or `design.md`, this document wins. It amends: the decodes schema, the funnel wall numbers, and the verdict/stamp states. Adopted from external researcher review + accepted amendments.

---

## 0. WHY THE APR IS MISSING (the structural fact)

Credit primarily for agricultural purpose is exempt from federal Truth in Lending disclosure (Reg Z, 12 CFR §1026.3(a)). Most farm-equipment paper is not required to show an APR. That is the market gap, stated as regulation, not as dealer intent.

**Approved public wording (only this framing, never intent claims):**
> "Most farm-equipment credit is not federally required to show an APR. We calculate a comparable rate from the actual deal you were offered."

Never say or imply "they hid it." Say "it is not required, so we compute it."

---

## 1. THE RATE — definition of record

**Headline number: "Your real rate" = the all-in annualized cost of choosing this financing deal instead of the cash deal.**

Formally: the annual IRR (XIRR for non-monthly or irregular schedules) of the DIFFERENCE between the all-in cash-purchase cash flows and the all-in financing cash flows. Decision math, not a claimed Reg-Z APR, and we say so.

**Two computed views, one headline:**
- `real_rate_all_in` — includes every mandatory finance-only cost, upfront or rolled. **This is the only number that gets the 48px treatment.**
- `promo_price_rate` — excludes finance-only fees; isolates the cost of forgoing the cash discount. **Receipt line only. Never a second headline. Two big numbers confuse a man holding a quote.**

**Public contract sentence:**
> "This is not the legal APR. It is the annual cost of this deal against its cash alternative, using the costs we can verify."

---

## 2. FEE TAXONOMY (drives the math)

| Item | Treatment |
|---|---|
| Sales tax, registration, delivery charged either way | Excluded from rate; shown separately on receipt |
| Mandatory finance-only doc/origination/insurance fee | Included in `real_rate_all_in` |
| Optional warranty/service plan | Excluded by default; farmer-toggleable |
| Fee rolled into payments | Included, and explicitly called out on receipt |
| Unknown/unclassified amount | **Blocks the verdict.** "Confirm this amount." |

`fees_json` entry shape: `{ name, amount, required: bool, finance_only: bool, rolled_into_finance: bool, status: "confirmed"|"unknown" }`

**Tax edge (golden-fixture requirement):** tax is not always invariant between alternatives. Some states tax pre-discount price; trade-in tax credits vary by state. Ledger must allow per-alternative tax entry. At least one golden test encodes a state where cash-deal tax ≠ finance-deal tax.

---

## 3. THE DEAL LEDGER (replaces "four fields" as the full model)

Fields: cash price · finance price · cash discount/rebate · trade allowance · trade payoff (negative equity!) · down payment/due at signing · taxes (per-alternative capable) · delivery/setup · mandatory finance-only fees · amount financed if stated · payment amount · **payment frequency (monthly/quarterly/semiannual/annual — ag pays annual, this is not optional)** · payment count · balloon.

**Reconciliation gate:** if the ledger and scheduled payments don't reconcile, no verdict. Say:
> "We found a difference between the quoted total and scheduled payments. A trade, down payment, tax, fee, or add-on may be missing. Confirm it before we rate this deal."

An unexplained gap between `payment × periods` and the financed ledger = an **unexplained amount** flag. Never call it a junk fee until the farmer confirms what it is. Confirmed ones feed the junk-fee index honestly.

---

## 4. QUICK PATH vs VERDICT PATH (protects the 60-second doctrine)

The reconciliation gate guards the **stamp**, not the **first number**.

- **Quick path** (price, discount, term, payment + frequency toggle): instant `promo_price_rate` with assumptions PRINTED in ink: "Assumes no trade, no down payment, no fees. Confirm the full deal to get the verdict." Never a silent zero — a stated assumption.
- **Verdict path** (ledger complete or photo-extracted + confirmed, reconciled): earns `real_rate_all_in` and a stamp.

Value in sixty seconds. Rigor before judgment. Both, no compromise between.

---

## 5. VERDICT RULE v1

- **CHECKS OUT** — `real_rate_all_in` ≤ matched published reference + 100 bps
- **LOOK CLOSER** — `real_rate_all_in` > matched published reference + 100 bps
- **NO VERDICT YET** — no matched reference (e.g., 84-month deal, card stops at 7 years), unreconciled ledger, or any unknown fee

**Stamp law (amends nothing — clarifies design.md):** two stamps only, unchanged. NO VERDICT YET is NOT a third stamp. A stamp is a judgment; this is an abstention. Render as plain words, no stamp: "No verdict yet. Here's what's missing." The absence of the stamp is the message.

**Always show beside any verdict:** the delta, the reference source + as-of date, and the caveat "subject to approval."
> "Your real rate: 5.2%. Comparable published equipment rate: 6.5%, subject to approval. This deal checks out."

**The 100 bps buffer is policy, not discovered truth.** Version it in `/how-we-figure-it`. Revisit only when the pile has real cohort data. Explicit, symmetric, reproducible beats falsely precise.

Note the credibility feature: this rule will frequently bless captive 0% promos. Good. A tool that sometimes says "take the dealer's deal" is the only tool anyone believes.

---

## 6. BENCHMARK HIERARCHY (product law)

1. **Matched live equipment rate card** (same amount band, nearest supported term band) → may support a verdict. Phase-0 source: AgDirect published equipment rates.
2. **Regional machinery/intermediate survey rates** (KC Fed) → market context line only, never the verdict source.
3. **Operating, real-estate, Prime, SOFR, GoC, broad Fed rates** → NEVER shown as comparable for an equipment-paper verdict. Purpose-mixing is how the receipt test dies.
4. **No suitable match** → rate yes, verdict no.

**Snapshot rule:** every benchmark row carries `source_url`, `as_of_date`, and an archived copy (R2). Any past verdict must be reproducible after the source page changes. Update cadence: on source change, minimum quarterly check.

**Single-source fragility, on the record:** AgDirect can reformat, pull, or object to being the reference. It is also Farm Credit-affiliated and a plausible future lead buyer — awkward or synergistic; decide knowingly before scale. Expansion path: add other published, date-stamped equipment programs under the same matching transparency; later, pile cohort medians (n ≥ 20) complement but do not replace tier 1 for verdicts.

---

## 7. PILE HYGIENE (data-engine amendment)

**Only reconciled decodes enter cohort medians, percentile claims, and the quarterly report.** Quick-path unreconciled rows are stored, flagged `reconciled = false`, and excluded from all published statistics. Assumption-laden rates in the medians = the moat rotting quietly.

---

## 8. SCHEMA AMENDMENTS (migrations)

decodes: add `real_rate_all_in`, `promo_price_rate`, `reconciled` (bool), `assumptions_json`, `verdict` (`checks_out`|`look_closer`|`none`), `verdict_ref_id`, ledger fields per §3, `fees_json` per §2. (`implied_apr` retired in favor of the two named rates.)
benchmarks: add `source_url`, `as_of_date`, `snapshot_key`, `amount_band`, `term_band`.
events: unchanged; add `interest_yes` event type (§9).

---

## 9. VALIDATION SPLIT (amends the wall numbers)

**Phase A — demand test, no counsel needed.** `ad → decode → optional email receipt → non-binding interest question`:
> "If an independent equipment lender could quote this deal, would you want to hear from one?"  [Yes] [Not now]

No forwarding, no lender contact, no shared PII, no "consent" label. This measures intent, not permission. It is not brokering because nothing moves.

**Wall numbers, amended:**

| step | good | bad = stop, fix, retest |
|---|---|---|
| click → completed decode | ≥ 25% | < 10% |
| decode → email | ≥ 20% | < 8% |
| email → **interest-yes** | ≥ 10% | < 3% |
| $ per interested decode | ≤ $50 | > $150 |

**Phase B — parallel buyer discovery.** Anonymized example deal structures (never farmer records) to 3-5 potential finance buyers. Written answers: states + deal types accepted, minimum ticket, required borrower info, whether they pay for verified quote-in-hand introductions, price, exclusivity, contact policy.

**Phase C — counsel-gated monetization.** Real consent button ships only after the lawyer stones (master-prompt PAGES + LEGAL). Then: actual consent → funded conversation validates the business.

Honest ladder: decode/email = farmer demand. Interest-yes = directional intent. Buyer LOIs = revenue model. Post-counsel consent = the business. No rung skipped, no rung overclaimed.
