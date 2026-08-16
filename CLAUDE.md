# LoanHank — Quote Decoder

One Cloudflare Worker. A free web tool that reads farm-equipment dealer quotes and shows the real rate; consented leads are the business. No accounts, no app.

Product law lives in two docs — read the relevant one before deciding, don't improvise doctrine:
- `docs/spec.md` — rate definition of record, deal ledger, verdict rules, benchmark hierarchy, schema, funnel, data engine, legal pages, decisions, launch checklist
- `docs/design.md` — visual system, Hank voice, sales copy rules, canonical microcopy

`docs/archive/` is history, not law. Never cite it and never create a third living doc.

## Commands

Keep these true in package.json; if you rename a script, update this file in the same commit.

- `pnpm dev` — wrangler dev, local worker + D1
- `pnpm test` — vitest, full suite
- `pnpm test:eval` — extraction eval against golden fixtures (must pass before deploy)
- `pnpm typecheck` — tsc --noEmit
- `pnpm deploy` — wrangler deploy; only from main with tests green
- `pnpm infra:r2` — apply the R2 lifecycle rules from `infra/*.json` and read them back
- `pnpm funnel` — the morning ritual, one query against production (`--local` for the dev database)

## Architecture

- `src/finance/` — THE ENGINE. Pure functions only: no fetch, no DB, no Date.now inside math. Every money figure a user ever sees is computed here and nowhere else.
- `src/api/` — Hono routes, thin, call the engine. `security.ts` gates uploads; `reaper.ts` enforces retention.
- `src/shared/schema.ts` — types and validation, single source of truth for field shapes.
- `src/web/` — the one public page. No login. UI does ZERO arithmetic; it renders engine output.
- `migrations/` — D1 SQL migrations, append-only. Never edit a shipped migration; add a new one.
- `tests/` — engine tests, api tests, extraction fixtures. Ported from the x-ray repo; they encode years of edge cases. Guard them.

## Money-math rules (non-negotiable)

- Any change in `src/finance/` starts with a failing test.
- Every abstention path needs a companion canary proving the positive path is reachable. A canary that abstains fails the build (spec.md §7.3).
- No promise without a sender: any future-tense commitment in product copy needs a test proving the mechanism fires, negative paths included, registered in `tests/promises.test.ts` (spec.md §7.3).
- Verification traffic against production is flagged synthetic in the same session that creates it. Flagging needs no sign-off; deletion always does (spec.md §7.2).
- If a finance test fails, assume the code is wrong, not the test. Changing an expected value requires a comment explaining why the old value was incorrect.
- Extraction never guesses. Unreadable field → null + flagged for the farmer to type. A confidently-wrong extracted number is the one fatal bug class; abstaining is success.
- Longer amortization is never labeled "savings."
- Peer stats render only when cohort n ≥ 20, and n is always printed. Below 20, show published benchmarks and say so. Only `reconciled = true` decodes feed published statistics.
- Worst verdict is amber. No red exists in this product — not in errors, not in charts.
- The headline rate is `real_rate_all_in` per `docs/spec.md` §2. No stamp without a reconciled ledger and a matched tier-1 benchmark; abstention ("no verdict yet") renders stampless.

## Data rules

- `decodes` rows: no PII, no dealer names, no account numbers, ever. Quote photos are never written down: the bytes go from the request to the reader and are gone. The `loanhank-quotes` bucket and its one-day rule are a backstop for a future path that writes one; the happy path never touches it.
- A lead never moves without a consent row: timestamp + `consent_text_version` of the exact text shown.
- The verdict and the business are firewalled both ways (spec.md §3.1). No verdict screen, stamp or canonical line references partners, refinancing or the interest question; the interest question and any consent flow never reference the verdict; and the question renders the same whatever the verdict said.
- Lead compensation is flat fee or retainer only. Success-contingent or funded-deal-contingent pricing requires a signed broker-of-record agreement on file (spec.md §8.1), and none exists.
- Nothing in this product may have a field capable of holding an SSN, EIN, tax document, credit application, bank statement, or account or routing number (spec.md §8.2, §9.5). Schema law, tested.
- Aggregate outputs only, n ≥ 20; row-level data never leaves the system.

## Copy rules (user-facing text)

- Hank voice per `docs/design.md` §2–2½. Sentence case. No em dashes. No exclamation marks. No staccato triads.
- Every external figure carries source + date. Exact numbers over round ones.
- Canonical microcopy table in design.md is the source of truth; don't paraphrase it.

## Workflow

- Typecheck + full tests before every commit. Main is always deployable.
- A farmer photo never becomes a fixture; it is never stored in the first place. Extraction improvement comes from the extracted-versus-confirmed field diff, text only. New quote shapes get a synthetic fixture via `tests/fixtures/make-synthetic-quote.py`.
- Do not add: accounts/login, native app, CMS, hosted forms, tracking cookies, third fonts, new colors, SMS. These are carved in the docs; a feature idea that needs one goes back to the docs first.

## Gotchas

- The engine supports Canadian semi-annual compounding (Interest Act s.6). Benchmarks are US-only v1. Don't strip the Canada math; it's tested and it's the expansion path.
- The benchmark table is hand-entered quarterly in `migrations/` seed data; sources and dates live with the values. Only tier-1 published equipment rate cards can back a verdict (spec.md §4); Fed survey rates are context lines, never the comparison.
- The old app (x-ray repo) is the ancestor. Its portfolio/watch/alert modules are deliberately NOT here — do not port them without a docs change first.
