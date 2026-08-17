# ADS — the campaign law. ops/ads.md

One page, one funnel, two paid channels plus the free one. The landing page is the
tool. Every channel is judged by one number: cost per completed decode, read from
our own events table, never from the platform's dashboard.

## Channel architecture

- **Meta = volume and priming.** Nobody can target "quote in hand." The headline is
  the targeting: the hook stops only the farmer for whom it's live. Meta's delivery
  algorithm learns "in-market farm equipment buyer" from our decode conversion
  events (server-side CAPI, no pixel). Broad-ish audience, strong creative,
  down-funnel optimization.
- **Google Search = the moment.** The man with the quote googles "equipment loan
  calculator." Exact-match calculator terms, cheap because no lender values
  calculator intent. Three clicks a day of the highest intent that exists.
  This channel is never traded away for a cheaper one; cheap clicks that don't
  decode are expensive.
- **Google Display = the trade-magazine ad, whitelist only.** Broad GDN is
  fat-finger app taps and junk sites; it is banned here. Display runs ONLY as
  managed placements on named ag properties, and is judged by the same decode
  number as everything else. The superior cousin: a direct sponsorship buy on
  NewAgTalk or a farm publication, same eyeballs, no middleman, native trust.
- **The list = the free channel.** Teardown PDF, expiry reminder, day-4 and day-30
  sends. Every farmer's second moment costs zero ad dollars. This is the channel
  that eventually makes the other two optional.
- **Seasonality:** October through December is the real volume window (post-harvest
  buying, Section 179). The first $500 is calibration for that flight, not the flight.

## Meta — test flight

- Objective: Sales/Conversions, optimizing on the `Decode` CAPI event, which is
  the shipped event name and the only event Meta ever hears (spec.md §10, one
  event not three). Accept learning-limited delivery at test scale; the seed
  data is part of what the $500 buys.
- ONE campaign, ONE ad set, THREE creatives. Never split audiences at this budget;
  fragmenting $500 starves learning. Test hooks, not audiences.
- Audience: US, 25-65, interest stack loose (John Deere, Case IH, Farm Journal,
  Successful Farming, AgWeb, tractor pulling, FFA). Let the conversion event narrow.
- Placements: automatic. Budget: $70/day x 7 days.
- Landing: the tool, with UTM per creative. No brochure page.

### Creative A — the moment (grease pencil)
- Image: REAL photographed quote on a truck seat, amber grease pencil circling
  "0% FINANCING." Phone camera. Never AI-generated, never stock, never staged-slick.
- Primary text: `That $3,000 "cash discount" you give up to get the 0%? That's the
  interest, wearing a different hat. Free tool reads your quote and shows the real
  rate. Takes about a minute. If the deal's good, we'll tell you that too.`
- Headline: `0% financing isn't 0%`
- Description: `See what it really costs.` CTA button: Learn more

### Creative B — before the desk
- Image: same photo, different crop (vertical for Reels).
- Primary text: `Before you sign that equipment deal, know the number the dealer
  didn't print. Type four numbers off the quote, or take a photo of it. Free,
  about a minute, and your numbers stay yours.`
- Headline: `Did the dealer tell you the real rate?`

### Creative C — the old quote (widens the moment ~20x)
- Image: quote sticking out of a glovebox or clipped in a visor.
- Primary text: `Got an equipment quote this year? Most farm financing never shows
  an APR. It isn't required to. Run the paper through Hank and see what your deal
  actually cost. Free.`
- Headline: `What did your 0% really cost?`

Copy law applies to ads same as product: sentence case, no em dashes, no
exclamation marks, no staccato triads, no invented urgency. Real deadlines only
(the quote's own expiry date may appear in retargeting copy later, never a timer).

## Headline bank

The ad test is the headline test: the page's H1 follows the winning hook once
the test has spoken, and the page never runs its own test (design.md §5).
Approved hooks:

1. `0% isn't 0%. Snap the quote and see the real rate.` **← live on the page as the H1** (owner ruling 2026-08-17, set as the starting hook, not as a test result)
2. `That "0%" has a price. Your phone can find it in about a minute.`
3. `We ran a "0% for 60 months" offer through the math. It cost 2.94%.`
4. `The 0% deal isn't free. See what yours really costs.`

**Scent rule:** whichever hook is winning is the hook on the page. An ad that
promises one thing and a landing page that opens with another breaks the scent
at the most expensive moment, and the decode rate pays for it. When the test
speaks, the H1 moves with it, in the same commit as the ads.md change.

The 2.94% in hook 3 is canon (design.md §2¾ example A, engine-recomputed by
tests/design-canon.test.ts). If canon moves, the hook moves with it.

## Google Search — the moment channel

- Campaign: Search, US, manual CPC (no conversion feed to smart-bid on yet;
  we judge by UTM-tagged decodes in our own events table).
- Budget: $10/day, runs alongside the Meta test, same landing.
- Exact-match keywords (volumes/CPCs from the audit):
  `[farm loan calculator]` 2,400/mo $3.38 · `[equipment loan calculator]` 1,300/mo
  $2.99 · `[tractor payment calculator]` · `[tractor loan calculator]` ·
  `[farm equipment financing calculator]` · `[farm equipment loan rates]`
- Negative keywords, non-negotiable: mortgage, car, auto, truck, personal, student,
  payday, india, simulator, fs25, fs22, game, mod.
- Ad copy: `The number the dealer didn't print. Free tool reads a farm equipment
  quote and shows the real rate against paying cash. About a minute. No login.`
  Headlines rotate from the same three hooks as Meta.
- Image assets attached to every ad (the grease-pencil photo) for Images-placement
  eligibility at no extra cost.

## Google Display — whitelist only, kill-fast

- Campaign: Display, **managed placements exclusively**. Placement whitelist:
  agweb.com, dtnpf.com (Progressive Farmer), agriculture.com (Successful Farming),
  farmjournal properties, agupdate.com. Add sites only by name, never by topic,
  audience, or "optimized targeting" (turn optimized targeting OFF; it silently
  re-broadens to junk).
- Creative: responsive display ads built from the REAL photo assets and the three
  hook headlines. Same copy law. No animation.
- Budget: $10/day cap, third cell. Gate below; expect it to lose to Search and be
  ready to kill without sentiment. If it dies, the same dollars go to a DIRECT
  sponsorship inquiry at NewAgTalk (talk.newagtalk.com) and one farm publication,
  which is the better version of this channel anyway.
- Exclusions: all mobile apps, all games categories, parked domains, below-the-fold
  only if controllable. Frequency cap 2/day/person.

## Measurement

- Source of truth: our events table. Every landing URL carries
  `utm_source/utm_medium/utm_campaign/utm_content` (creative-level), stored on the
  decode row's events. Platform dashboards are for delivery health only.
- Meta gets the `Decode` event via server-side CAPI, and nothing else (spec.md
  §10, one event not three). No pixel, no third-party cookies, no banner. Google
  gets nothing back v1; offline conversion upload is a later decision.

## Gates — written before spend, judged after, feelings don't vote

| channel | metric | good | workable | kill |
|---|---|---|---|---|
| Meta | cost per completed decode | ≤ $12 | ≤ $25 | > $40 |
| Search | cost per completed decode | ≤ $12 | ≤ $20 | > $35 |
| Display (whitelist) | cost per completed decode | ≤ $15 | ≤ $30 | > $45 |
| both | decode → email | ≥ 20% | ≥ 10% | < 8% |

- Cost per lead is NOT judged until $2-3k total spend; at $500 the interest-yes
  count is noise (n of 3-10). Anyone reading a CPL off the test is reading static.
- The click→decode gate was calibrated on the four-field typed path. The camera
  hero may legitimately land lower while producing richer, verdict-capable rows
  (spec.md §7.1 calibration note). Events split hero, disclosure, and recovery
  decodes and carry photo count, so read the split before judging the gate.
- Kill = stop that channel/creative, diagnose, fix one thing, retest once. Two
  kills on the same hook = the hook is wrong, rotate in a new one from the
  headline bank. No new strategy hunts between tests.
- Weekly ritual while ads run: write 5 new headlines, kill the worst performer,
  ship the best new one. Headlines are 80% of the work; button colors are 0%.

## Standing prohibitions

- No AI-generated imagery anywhere, ever. This audience spots it and it is brand death.
- Landing page is the tool. No interstitials, no popups, no countdown anything.
- No lookalike audiences before ~100 decode events exist (below that they model noise).
- No retargeting v1 (no pixel by doctrine; CAPI-based audiences revisited at scale).
- October-December flight is the prize; nothing about the August test's scale is
  a verdict on the product. The test judges the machine, the season judges the market.
