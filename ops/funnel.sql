WITH windowed AS (
  SELECT event FROM events WHERE ts >= datetime('now', '-7 days')
)
SELECT
  (SELECT COUNT(*) FROM windowed WHERE event = 'page_view')          AS page_views,
  (SELECT COUNT(*) FROM windowed WHERE event = 'decode')             AS decodes,
  /* Form friction and abstention, watched beside the funnel: a form we could
     not read and a deal we would not price are different failures and want
     different fixes. */
  (SELECT COUNT(*) FROM windowed WHERE event = 'decode_rejected')    AS decodes_rejected,
  (SELECT COUNT(*) FROM windowed WHERE event = 'decode_unpriceable') AS decodes_unpriceable,
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
  (SELECT COUNT(*) FROM decodes)                         AS pile_total,
  (SELECT COALESCE(SUM(reconciled), 0) FROM decodes)     AS pile_reconciled,
  (SELECT COUNT(*) FROM decodes WHERE verdict <> 'none') AS pile_with_verdict;
