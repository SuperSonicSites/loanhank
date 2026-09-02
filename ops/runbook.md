# Runbook

## Restore the pile from a backup

**Tested end to end on 2026-08-16.** Original and restore matched on every table count and on row content including `real_rate_all_in_bps` and `verdict_ref_id`. Re-test after any migration that changes a table's shape.

The nightly cron writes a replayable SQL dump to `loanhank-backups` at `d1/loanhank-YYYY-MM-DD.sql`. It is plain `INSERT` statements on purpose: it restores with one command and it can be read with an eye, which matters at three in the morning when the clever format needs the tool that is also broken.

**The dump carries data only, never schema.** Migrations build the schema; the dump refills it. That way a restore lands on the schema the code expects rather than on whatever shape the database had the night it broke.

```bash
# 1. What have we got?
wrangler r2 object get loanhank-backups/d1/loanhank-2026-08-16.sql --file restore.sql --remote

# 2. Somewhere to put it. Never restore over the live database to "check"
#    something. Make a scratch one and look at that.
wrangler d1 create loanhank-restore-test

# 3. Schema first, from the migrations, in order.
for m in migrations/*.sql; do
  wrangler d1 execute loanhank-restore-test --remote --file "$m"
done

# 4. Then the data.
wrangler d1 execute loanhank-restore-test --remote --file restore.sql

# 5. Prove it, against the original. Counts AND content.
wrangler d1 execute loanhank-restore-test --remote --command \
  "SELECT (SELECT COUNT(*) FROM benchmarks) b, (SELECT COUNT(*) FROM decodes) d,
          (SELECT COUNT(*) FROM emails) e, (SELECT COUNT(*) FROM events) v"

# 6. Delete the scratch database when you are done. A second copy of the pile
#    sitting around is a second thing that can leak.
wrangler d1 delete loanhank-restore-test
```

### If the live database is the one that is gone

Same steps, except step 2 is `wrangler d1 create loanhank` and step 6 is updating `database_id` in `wrangler.jsonc` and deploying. Expect to lose everything since the last nightly export, which runs at 07:00 UTC.

D1 Time Travel covers roughly thirty days and is faster for an accident noticed quickly. The R2 export is what outlives an accident nobody noticed, an account problem, or a database deleted by somebody who meant to delete a different one.

## Daily

```bash
pnpm funnel          # production, one query, reads synthetic = 0 only
pnpm funnel --local  # the dev database
```

Wall numbers to read it against are in spec.md §7.1. Round one is judged at cost per completed decode; cost per lead is not judged until $2,000 to $3,000 has run.

## Benchmarks

AgDirect republishes monthly and the worker reads it itself: the daily 07:00 UTC cron fetches the page, and so does the first ledger decode after a card lapses (once an hour at most). A card that parses, passes the seed guards, and moves no cell more than 300 bps from the card it replaces is archived to `loanhank-snapshots` and appended to `benchmarks`; every outcome lands as a `benchmark_*` event and in the ops digest. Nothing is ever edited in place: a past verdict has to stay checkable against what the card said on the day.

When the digest reports `benchmark_refused`, a person reads `benchmarks/agdirect/refused-<date>.html` in the snapshot bucket. Either the page was redesigned (fix the parser in `src/api/benchmarks.ts`, with the new page as a fixture) or the card genuinely jumped further than the guard allows (confirm it against the printed card, then add the rows as a migration the old way). Until then the verdict path abstains with `benchmark_lapsed`, which is the gate working.

## Infrastructure

```bash
pnpm infra:r2        # apply the R2 lifecycle rules and read them back
pnpm infra:verify    # read them back without applying
```

Quote photos are never written to R2 at all. The one-day rule on `loanhank-quotes` is a backstop for a future path that writes one; today nothing does.
