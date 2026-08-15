# LoanHank — Quote Decoder

One Cloudflare Worker. A free web tool that reads farm-equipment dealer quotes and shows the real rate; consented leads are the business. No accounts, no app.

Product law lives in three docs — read the relevant one before deciding, don't improvise doctrine:
- `docs/master-prompt.md` — spec, funnel, data engine, legal pages, do-not list
- `docs/design.md` — visual system, Hank voice, sales copy rules, canonical microcopy
- `docs/rate-verdict-law.md` — rate definition of record, deal ledger, verdict rules, benchmark hierarchy. **Wins on conflict with the other two.**

## Commands

Keep these true in package.json; if you rename a script, update this file in the same commit.

- `pnpm dev` — wrangler dev, local worker + D1
- `pnpm test` — vitest, full suite
- `pnpm test:eval` — extraction eval against golden fixtures (must pass before deploy)
- `pnpm typecheck` — tsc --noEmit
- `pnpm deploy` — wrangler deploy; only from main with tests green

## Architecture

- `src/finance/` — THE ENGINE. Pure functions only: no fetch, no DB, no Date.now inside math. Every money figure a user ever sees is computed here and nowhere else.
- `src/api/` — Hono routes, thin, call the engine. `security.ts` gates uploads; `reaper.ts` enforces retention.
- `src/shared/schema.ts` — types and validation, single source of truth for field shapes.
- `src/web/` — the one public page. No login. UI does ZERO arithmetic; it renders engine output.
- `migrations/` — D1 SQL migrations, append-only. Never edit a shipped migration; add a new one.
- `tests/` — engine tests, api tests, extraction fixtures. Ported from the x-ray repo; they encode years of edge cases. Guard them.

## Money-math rules (non-negotiable)

- Any change in `src/finance/` starts with a failing test.
- If a finance test fails, assume the code is wrong, not the test. Changing an expected value requires a comment explaining why the old value was incorrect.
- Extraction never guesses. Unreadable field → null + flagged for the farmer to type. A confidently-wrong extracted number is the one fatal bug class; abstaining is success.
- Longer amortization is never labeled "savings."
- Peer stats render only when cohort n ≥ 20, and n is always printed. Below 20, show published benchmarks and say so. Only `reconciled = true` decodes feed published statistics.
- Worst verdict is amber. No red exists in this product — not in errors, not in charts.
- The headline rate is `real_rate_all_in` per rate-verdict-law.md. No stamp without a reconciled ledger and a matched tier-1 benchmark; abstention ("no verdict yet") renders stampless.

## Data rules

- `decodes` rows: no PII, no dealer names, no account numbers, ever. Quote photos are deleted after extraction (reaper + R2 lifecycle rule, belt and suspenders).
- A lead never moves without a consent row: timestamp + `consent_text_version` of the exact text shown.
- Aggregate outputs only, n ≥ 20; row-level data never leaves the system.

## Copy rules (user-facing text)

- Hank voice per `docs/design.md` §2–2½. Sentence case. No em dashes. No exclamation marks. No staccato triads.
- Every external figure carries source + date. Exact numbers over round ones.
- Canonical microcopy table in design.md is the source of truth; don't paraphrase it.

## Workflow

- Typecheck + full tests before every commit. Main is always deployable.
- New real quote format encountered → add an anonymized fixture to `tests/fixtures/` in the same PR.
- Do not add: accounts/login, native app, CMS, hosted forms, tracking cookies, third fonts, new colors, SMS. These are carved in the docs; a feature idea that needs one goes back to the docs first.

## Gotchas

- The engine supports Canadian semi-annual compounding (Interest Act s.6). Benchmarks are US-only v1. Don't strip the Canada math; it's tested and it's the expansion path.
- Fed benchmark table is hand-entered quarterly in `migrations/` seed data; sources and dates live with the values.
- The old app (x-ray repo) is the ancestor. Its portfolio/watch/alert modules are deliberately NOT here — do not port them without a docs change first.
