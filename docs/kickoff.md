# KICKOFF — SESSION 1 BRIEF (delete this file when done)

You are the first build agent in this repo. Your job this session is NOT features. It is a clean, tested, deployable skeleton with the doc set consolidated and every architectural choice recorded. The output of this session is the repo itself; this file gets deleted at the end.

Read first, in order: `CLAUDE.md` → `docs/rate-verdict-law.md` → `docs/master-prompt.md` → skim `docs/design.md` → `docs/launch-gaps.md`. These are settled law from months of research and review. Do not re-litigate them. If something seems wrong, propose a doc change and stop — never silently diverge.

---

## PHASE 1 — git first, before touching anything

1. `git init`. Add `.gitignore` (node_modules, dist, .wrangler, .dev.vars, .env, *.local).
2. **Commit 1: the repo exactly as received.** Provenance matters — later commits show what session 1 changed.

## PHASE 2 — consolidate docs (target: 3 living docs, not 6)

End state:

```
CLAUDE.md                  ← behavioral, <200 lines, updated references
docs/spec.md               ← master-prompt.md + rate-verdict-law.md MERGED
docs/design.md             ← unchanged
docs/archive/              ← Research.md, Research-full-*, launch-gaps.md when spent,
                             plus the two pre-merge originals for provenance
```

Merge rules:
- `rate-verdict-law.md` declared itself the winner on conflict. A precedence note is a patch, not a permanent state — **resolve the conflicts in the merge and delete the superseded text.** One schema (the amended one). One funnel table (interest-yes version). One verdict section. No "this supersedes that" language may survive.
- Fold `launch-gaps.md` open items into a `## Launch checklist` section at the end of spec.md; move the original to archive.
- Add a `## Decisions` section to spec.md (see Phase 5). Do NOT create a separate decisions file.
- Update CLAUDE.md's doc references to spec.md + design.md and remove its precedence line.
- Create no new doc files beyond this tree. Ever. A fourth living doc requires a spec.md change explaining why.

## PHASE 3 — scaffolding

`package.json` (pnpm; scripts EXACTLY as CLAUDE.md lists them), `wrangler.jsonc` (worker + D1 binding + R2 binding + scheduled trigger for reaper/backup), `tsconfig.json` (strict), `vitest.config.ts`, `.dev.vars.example` (every secret named, none valued). Commit.

## PHASE 4 — port the tests, prove the spear survived

From the sibling repo `../x-ray` copy into `tests/`:
- `finance.test.ts`, `finance.calendar.test.ts`, `finance.portfolio.test.ts` (engine math)
- `extraction-fixtures.test.ts`, `extraction-security.test.ts`, `openai-privacy.test.ts` + `tests/fixtures/`
- `standalone/canada.test.ts` (it tests engine math; rename to `finance.canada.test.ts`)

Leave behind: alerts, watches, report, pwa, bundle, ops tests (old-app concerns) and `api.integration.test.ts` (old routes; new routes get new tests later).

**Definition of done for this phase: `pnpm test` green against the copied engine, before any engine edit.** If a ported test fails, the port is wrong or an import path is wrong — the engine does not get "fixed" to satisfy a broken port. Commit: "tests ported, green."

## PHASE 5 — prune the old-app bloat (delete, never comment out; git is the archive)

- DELETE `src/web/app.tsx`, `src/web/styles.css`, `src/web/api.ts`, `src/web/main.tsx` — old multi-screen app UI. The decoder page is built fresh per design.md later.
- DELETE `src/mcp/`.
- AUDIT `src/api/`: keep `security.ts`, `reaper.ts`, `extractor.ts`, `env.ts`, `schema` imports. Strip `server.ts`, `repository.ts`, `analysis.ts`, `storage.ts`, `public-rates.ts` down to what the five routes need: `GET /`, `POST /extract`, `POST /decode`, `POST /email`, `POST /interest`. Anything serving the old portfolio/watch/account app goes. If unsure whether the engine uses it, the tests answer — they're green now, keep them green.
- `pnpm test` + `pnpm typecheck` green after pruning. Commit.

## PHASE 6 — record the choices (spec.md `## Decisions`)

Defaults below are chosen. Deviate only with a strong reason, recorded in the same section:

| # | Decision | Default | Why |
|---|---|---|---|
| 1 | Database | **D1** (drop all Supabase code/refs) | one vendor, one worker, pile is SQLite-scale for years |
| 2 | Page delivery | **Server-rendered HTML from the worker, no client framework.** Form works as a plain POST; photo path is the only JS | 150KB budget, no-JS fallback is law, rural LTE |
| 3 | Router | Hono | already in the code, fine |
| 4 | Migrations | `wrangler d1 migrations`, `migrations/0001_init.sql` implements spec.md schema (the amended one: ledger fields, fees_json flags, real_rate_all_in, promo_price_rate, reconciled, verdict, benchmarks with as_of_date + snapshot_key, events) | append-only law |
| 5 | Extraction model | one vision-capable model behind a thin interface in `extractor.ts`; provider key via secret; hard monthly spend cap set at the provider | swappable, cost-capped |
| 6 | Email | Resend (or Postmark if deliverability testing says so), from `mail.loanhank.com` | CAN-SPAM plumbing per spec |
| 7 | Anti-abuse | Turnstile invisible on submit + per-IP rate limit on /extract + max upload size | each decode costs real money |
| 8 | Analytics | the `events` table + `ops/funnel.sql`. No third-party analytics, no pixel; Meta via server-side CAPI later | measure-or-dead without tracking cookies |

## PHASE 7 — deployable skeleton

`GET /` serving a placeholder page (correct fonts, paper/ink palette, wordmark — design.md §3-4-7) + `pnpm deploy` succeeding to a workers.dev URL. No decoder logic yet. Commit: "skeleton deployed."

---

## SESSION 1 IS DONE WHEN

- 3 living docs, conflicts resolved, CLAUDE.md accurate
- git history: as-received → consolidated → scaffolded → tests green → pruned → skeleton deployed
- `pnpm test`, `pnpm typecheck`, `pnpm deploy` all work
- Decisions table filled in spec.md
- This file deleted

## DO NOT (session 1)

- Do not rewrite, "improve," or reformat `src/finance/` — green tests are the only permitted proof it works
- Do not build the decoder UI, the PDF, or the email flow (session 2+)
- Do not add frameworks, ORMs, or a CMS
- Do not port anything from x-ray that isn't listed in Phase 4
- Do not rename schema fields casually — names in spec.md §schema are contracts
- Do not leave TODOs in docs; open questions go in the Decisions table with a "pending" mark