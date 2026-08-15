# LAUNCH GAPS — found on repo inspection, 2026-08-15

Ordered by severity. Check off before ads spend a dollar.


## 2. Not a git repo yet
No `.git`. `git init`, first commit = engine + tests + docs, before any new code. Add `.gitignore` (node_modules, .wrangler, dist, .dev.vars, .env).

## 3. No build scaffolding
Missing: `package.json` (scripts must match CLAUDE.md), `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.dev.vars.example`. Port from x-ray and prune.

## 4. Old-app bloat came along in the copy
- Audit `src/api/server.ts` + `repository.ts` for routes/queries serving the old app; keep only what /extract /decode /email /consent need.

## 5. Schema as migrations, not just TS types
- Create `migrations/0001_init.sql`: decodes (full forage-field schema per master-prompt), emails (+ `consent_text_version`), benchmarks (+ source_url, as_of_date per row).
- Add an `events` table (event, decode_id nullable, ts, meta json) — funnel metrics come from here; "measure or dead" needs somewhere to measure.
- Daily funnel query saved in `ops/funnel.sql` — the 10-minute morning ritual is one query, not a dashboard.

## 6. Backups — the pile is the company
- Nightly D1 export to R2 (scheduled worker). D1 Time Travel covers ~30 days; the pile must outlive any mistake. Test a restore once before launch.

## 7. CI
GitHub Actions: typecheck + tests + `test:eval` gate on PR; deploy on merge to main. The eval gate is what lets extraction prompts change safely.

## 8. Cost + abuse protection on /extract
Each decode calls a vision model = real money per request. Before ads: per-IP rate limit, max upload size (security.ts has bones — verify), Cloudflare Turnstile invisible mode on submit, and a hard monthly spend cap + alert on the LLM provider account. An abuse script hitting /extract is a bill, not an outage.

## 9. Email deliverability — start NOW, has lead time
- Pick provider (Resend/Postmark). Send from `mail.loanhank.com` subdomain.
- SPF + DKIM + DMARC records; DMARC starts p=none, tighten later. DNS propagation + reputation warmup takes days.
- Postal address for CAN-SPAM footer (PO box fine) — need it before first teardown email sends.

## 10. Meta Business setup — start NOW, has lead time
Business Manager + business verification + domain verification on loanhank.com + Conversions API token. Verification can take days-to-weeks; do it while building, not after.

## 11. Eval samples
Plan agreed: mystery-shop 12-15 dealers + forum-posted quote photos + synthetic print-and-photograph pipeline (20 docs × 5 conditions). Golden holdout of 5, never tuned against. Metric #1: false-confidence rate = 0.

## 12. Already carved, still open
- Lawyer stones (broker licensing by state, CCPA sale/share, consent wording) — before consent button goes live.
- USPTO clearance on LoanHank — before hats.
- Real-face photo for /whos-behind-this — real camera.
