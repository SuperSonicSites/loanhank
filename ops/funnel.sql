WITH windowed AS (
  SELECT event FROM events
   WHERE ts >= datetime('now', '-7 days')
     AND synthetic = 0
)
SELECT
  (SELECT COUNT(*) FROM windowed WHERE event = 'page_view')          AS page_views,
  (SELECT COUNT(*) FROM windowed WHERE event = 'decode')             AS decodes,
  /* Form friction and abstention, watched beside the funnel: a form we could
     not read and a deal we would not price are different failures and want
     different fixes. */
  (SELECT COUNT(*) FROM windowed WHERE event = 'decode_rejected')    AS decodes_rejected,
  (SELECT COUNT(*) FROM windowed WHERE event = 'decode_unpriceable') AS decodes_unpriceable,
  /* The two failure modes that kill the funnel silently. A reader that
     started failing every photo, or a mail provider refusing every send,
     used to look like a soft ad day from here. */
  (SELECT COUNT(*) FROM windowed WHERE event = 'extract_failed')     AS extracts_failed,
  (SELECT COUNT(*) FROM windowed
    WHERE event IN ('email_failed', 'day4_failed', 'day30_failed'))  AS emails_failed,
  (SELECT COUNT(*) FROM windowed WHERE event = 'email')              AS emails,
  (SELECT COUNT(*) FROM windowed WHERE event = 'interest_yes')       AS interest_yes,
  ROUND(100.0
    * (SELECT COUNT(*) FROM windowed WHERE event = 'decode')
    / NULLIF((SELECT COUNT(*) FROM windowed WHERE event = 'page_view'), 0), 1) AS pct_click_to_decode,
  ROUND(100.0
    * (SELECT COUNT(*) FROM windowed WHERE event = 'email')
    / NULLIF((SELECT COUNT(*) FROM windowed WHERE event = 'decode'), 0), 1)    AS pct_decode_to_email,
  ROUND(100.0
    * (SELECT COUNT(*) FROM windowed WHERE event = 'interest_yes')
    / NULLIF((SELECT COUNT(*) FROM windowed WHERE event = 'email'), 0), 1)     AS pct_email_to_interest,
  /* The pile, all time, and how much of it is honest enough to publish. Only
     reconciled rows ever feed a median or a percentile (spec.md 9). */
  (SELECT COUNT(*) FROM decodes WHERE synthetic = 0)      AS pile_total,
  (SELECT COALESCE(SUM(reconciled), 0) FROM decodes
     WHERE synthetic = 0 AND out_of_bounds = 0)          AS pile_reconciled,
  (SELECT COUNT(*) FROM decodes
     WHERE verdict <> 'none' AND synthetic = 0)         AS pile_with_verdict,
  /* The backup alarm. A dead nightly cron looks exactly like a healthy one
     from the outside, so the ritual asks the only question that settles it:
     how long since the pile was last written somewhere it can be restored
     from. Anything above 1 is a cron that stopped. NULL means never. */
  (SELECT CAST(julianday('now') - julianday(MAX(ts)) AS INT)
     FROM events WHERE event = 'backup_completed')       AS days_since_backup,
  (SELECT json_extract(meta_json, '$.rows') FROM events
     WHERE event = 'backup_completed'
     ORDER BY ts DESC LIMIT 1)                           AS last_backup_rows,
  /* The card clock. Zero or negative means the tier-1 card has lapsed and
     every decode is abstaining with benchmark_lapsed until the next card is
     entered. NULL means no dated card. */
  (SELECT CAST(julianday(MAX(valid_through)) - julianday('now') AS INT)
     FROM benchmarks WHERE tier = 1)                     AS days_until_benchmark_expiry;
