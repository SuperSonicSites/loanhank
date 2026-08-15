-- 0002 — correct the benchmark amount bounds.
--
-- 0001 seeded every `amount_min_cents` and `amount_max_cents` a thousand times
-- too large: "$25,000" went in as 2500000000 cents, which is $25,000,000. The
-- published rates, the bands, the terms and the snapshot key were all correct;
-- only the dollars-to-cents conversion on the matching bounds was wrong.
--
-- Consequence while it was live: no real quote could fall inside any band, so
-- the matcher would have found no reference for every deal on earth and every
-- verdict would have abstained. It failed safe and silent, which is the worst
-- way for a thing to be broken, and it is exactly the unit error the `_cents`
-- suffix was adopted to prevent. Naming the column did not save it; a test
-- that reads the band label and checks the number against it does, and that
-- test ships with this migration.
--
-- 0001 is not edited. It shipped.

UPDATE benchmarks SET amount_min_cents =   500000, amount_max_cents =  2499900 WHERE amount_band = '$5,000-$24,999';
UPDATE benchmarks SET amount_min_cents =  2500000, amount_max_cents =  9999900 WHERE amount_band = '$25,000-$99,999';
UPDATE benchmarks SET amount_min_cents = 10000000, amount_max_cents = 24999900 WHERE amount_band = '$100,000-$249,999';
UPDATE benchmarks SET amount_min_cents = 25000000, amount_max_cents =     NULL WHERE amount_band = '$250,000+';
