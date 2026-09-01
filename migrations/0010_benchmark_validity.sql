-- 0010 — the publisher's own printed end of validity, and nothing invented.
--
-- AgDirect prints "Rates effective August 01-31 2026" on the card. A decode
-- run in September against that card is a verdict against a rate nobody is
-- offering, so past valid_through the decode abstains with benchmark_lapsed.
-- The gate reads the printed date, never fetch time. Null means the source
-- printed no end date, and the monthly card ritual is the only guard there.
--
-- 0001 through 0009 are not edited. They shipped.

ALTER TABLE benchmarks ADD COLUMN valid_through TEXT;

-- The seeded August card, per its own printed validity line.
UPDATE benchmarks SET valid_through = '2026-08-31'
 WHERE source = 'AgDirect' AND as_of_date = '2026-08-01';
