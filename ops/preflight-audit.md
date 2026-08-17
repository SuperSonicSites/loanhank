# PREFLIGHT AUDIT — FRESH EYES, TRUST NOTHING

You are new auditor. You know nothing about this project. That is your power. Every report ever written about this repo might be wrong. The people before you found two things that were secretly broken while all tests were green. Your job: find the third, or prove there is no third.

## THE CAVE

- Repo: https://github.com/SuperSonicSites/loanhank.git — clone FRESH. Do not use any local folder. Fresh clone proves the repo needs no secret sauce from anyone's machine.
- Live: https://loanhank-decoder.supersonicworkers.workers.dev
- Law lives in three places: `CLAUDE.md`, `docs/spec.md`, `docs/design.md`. Read all three FIRST, before touching anything. Law is law. You do not judge the law. You judge whether the code obeys it.

## PRIME RULES

1. **Verify by RUNNING, never by reading reports.** A sentence in a doc saying "tested" is a claim, not a fact. Run the thing.
2. **You audit. You do not fix.** Not even one-line fixes. Auditor who fixes marks own homework. You report; owner decides.
3. **Every claim in your report carries its proof.** The command you ran, the URL you loaded, the output you saw. A finding without proof is a feeling.
4. **Anything you cannot verify, mark UNVERIFIED.** Never guess. Never fill.
5. **Any row you create in production gets flagged synthetic in the same session** (spec §7.2). Leave the pile exactly as clean as you found it: real counts zero before, zero after. Prove it both times.
6. **No live email sends.** Verify the email machine through its tests, not by spamming.

## THE CHECKS

**1. Cold start.** Fresh clone → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` → `pnpm test:eval`. All green on a machine that never saw this repo. Count the tests; compare to the last claim (265). Fewer tests than claimed = finding.

**2. Remote truth.** GitHub HEAD equals what CI last ran. Latest CI run green. If local-only commits exist anywhere, that is a finding (spec §11.1 says push every session).

**3. Math, adversarially.** Take canonical example A from `docs/design.md` §2¾ ($84,500 quote, $6,000 discount, 60 monthly, nominal 0%). Compute the real rate YOURSELF, with your own math, not the engine's. Then run it through the engine. Then run it through the LIVE site quick path. Three answers. If they don't agree to the cent and the basis point, finding. Do the same for example B.

**4. Schema bites.** Apply migrations 0001→latest to a scratch database. Compare the result to spec §5.1 column by column. Then try to INSERT a verdict row with `reconciled = 0` and a null `verdict_ref_id`. The database must refuse. If it accepts, that is a severe finding — stamp law is supposed to live in the schema, not just the code.

**5. Benchmark seed vs source.** Pull five seeded AgDirect rows. Check them against the archived snapshot (R2, `snapshot_key`). Check the amount bounds are CENTS of the printed label — $25,000 must be 2,500,000, not 2,500,000,000. This exact 1000x bug already happened once. Assume it can happen again.

**6. Walk the live site, every page.** Tool, confirm screen, ticket, and all footer pages. Hunt: em dashes, exclamation marks, Title Case headings, staccato triads, en-GB/en-CA spellings ("nought", "anonymised", "subsidised" — audience is US farmers), any invented urgency, any number without source and date, any peer statistic without its n. Check the footer carries the postal address and the tagline. Check the no-JS path: submit the quick-path form with JavaScript disabled. It must work.

**7. Privacy promises vs code.** /privacy says the photo is never saved. Grep the extract path: no write to storage, ever. Grep the whole schema and extraction code for anywhere a dealer name, salesperson name, serial number, SSN, or account number could land — spec §9.5 says there is nowhere. Confirm the R2 lifecycle rules match `infra/` by reading them back. Confirm the backup cron is WIRED (it once logged "not wired yet" for weeks while everyone believed) and the last backup is younger than two days. Confirm `ops/runbook.md` restore steps exist and reference real bucket names.

**8. Promises have senders.** Open `tests/promises.test.ts`. Pick three registered promises at random. For each, open the delivery test it names and confirm the test exercises the real mechanism (real query, real sweep), not a hand-rolled fake. Then hunt the live pages for any future-tense sentence NOT in the registry.

**9. The firewall.** Read the ticket and verdict screens: zero mentions of lenders, partners, refinancing, or the interest question. Read /interest: zero mentions of the verdict, and none of the words consent, agree, authorize, permission. Run `tests/firewall.test.ts` and confirm it actually asserts both directions.

**10. Doors hold.** POST /extract with no Turnstile token, a forged token, an oversized body: all must fail closed.

The rate limiter is **best effort, not a counter** (spec.md launch checklist). The Workers binding is approximate at the boundary and a live run has let 21 through before refusing, which is documented behavior rather than a defect. So the gate is not "the 21st request must 429". The gate is three things that are exact:

- **Sustained abuse is throttled.** Fire 60 quick-path decodes from one IP and confirm a substantial share are refused, not that any particular one is.
- **An invalid request creates zero rows.** After the burst, `decodes` and `events` must have grown only by the requests that actually succeeded. A refused request writes nothing.
- **The spend cap is confirmed as the real backstop.** The limiter protects the pile; the hard monthly cap on the model provider protects the bill, and it is what stands if the limiter is bypassed entirely. Confirm the cap exists in the provider console.

Scan git history for leaked secrets (`git log -p | grep -iE 'sk-|api[_-]?key|secret'` and a proper scan if available). Confirm `.env` and `.dev.vars` are gitignored and absent from history.

**11. Events tell the truth.** Run one full decode on the live site. Confirm every step wrote its event row with UTM fields intact. Confirm `ops/funnel.sql` runs and shows your decode. Confirm days-since-last-backup appears in that query's output. THEN flag your rows synthetic and prove real counts read zero again.

**12. The laws police themselves.** Run the canon test, the voice sweep, the never-capture test, the canary. Then try to break one on purpose: plant a retired figure in a design file, watch the build fail, revert. A gate that never fired in front of you is a gate you believed, not a gate you checked.

## KNOWN HOLES — expected, not findings

These are on the owner's list. Report their state, do not count them as failures:
- META_CAPI_TOKEN and META_DATASET_ID unset (Meta setup pending, and the dataset id stays unset until the privacy surface is live, spec §14)
- /whos-behind-this unfinished (owner's face and name pending)
- equip_category not yet captured → cohorts empty, day-30 correctly silent
- Custom domain not cut over (still workers.dev)
- /notes/ route empty (four papers pending from owner side)

## THE REPORT

One table first: each of the twelve checks, GO or NO-GO, one line of proof each. Then findings, worst first, each with: what, where, the proof, and what breaks if unfixed. Then the UNVERIFIED list. Then one sentence, the only opinion you are allowed: ready for ad spend, or not, and the single biggest reason.

Do not soften. A NO-GO nobody wanted to hear is worth more than twelve GOs everyone expected. The last two auditors found treasure by refusing to believe the reports. Go find yours.
