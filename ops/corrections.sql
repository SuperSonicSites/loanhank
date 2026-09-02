/* The extraction flywheel, read out. Every photo decode records which fields
   the farmer corrected against what the model read (extraction_diff). The
   fields corrected most in the last thirty days are the next prompt change
   or the next synthetic fixture (spec.md 7.3). Run with: pnpm corrections */
SELECT
  fields.value                                             AS field,
  COUNT(*)                                                 AS corrections,
  ROUND(100.0 * COUNT(*) / NULLIF(
    (SELECT COUNT(*) FROM events
      WHERE event = 'extraction_diff'
        AND synthetic = 0
        AND ts >= datetime('now', '-30 days')), 0), 1)     AS pct_of_photo_decodes
FROM events, json_each(events.meta_json, '$.corrected_fields') AS fields
WHERE events.event = 'extraction_diff'
  AND events.synthetic = 0
  AND events.ts >= datetime('now', '-30 days')
GROUP BY fields.value
ORDER BY corrections DESC;
