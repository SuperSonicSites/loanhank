# infra

Infrastructure that enforces a promise printed on the public site. It lives
here as versioned JSON, applied by `pnpm infra:r2`, never clicked into the
dashboard.

- `r2-lifecycle-quotes.json` — quote photos expire after 1 day. This is the
  suspenders, not the belt. The public promise is "photo deleted after
  reading" (about ten seconds), and the reaper on the 15-minute cron is what
  keeps it. R2 lifecycle rules have day granularity at best, so this rule
  cannot express ten seconds; what it guarantees is that a photo cannot
  outlive a day even if the reaper is broken or never ran.
- `r2-lifecycle-backups.json` — nightly D1 exports expire after 90 days, so
  the backup bucket does not grow forever.

`pnpm infra:r2` applies both and then reads both back. Read the output: a rule
that failed to apply is a promise that silently stopped being true.
