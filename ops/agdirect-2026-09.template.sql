-- TEMPLATE, not a migration. The September AgDirect card, awaiting its rates.
--
-- Why this lives in ops/ and not migrations/: D1 and the test helper record a
-- migration as applied by filename. A placeholder applied empty would never
-- re-run once filled in, and the seed guards would go green against fake
-- rates. So the values are transcribed HERE first, verified by a person
-- looking at the printed card, and only then does this file get copied to
-- migrations/0011_agdirect_2026_09.sql.
--
-- The ritual, in order:
--   1. Open https://www.agdirect.com/rates and photograph or save the page.
--   2. Archive the saved page to R2 at benchmarks/agdirect/2026-09-01.html
--      (the snapshot_key below must point at a real object).
--   3. Transcribe every rate by hand. The bounds are CENTS of the printed
--      label: $25,000 is 2500000000 in amount_min_cents terms only if the
--      label says so. The 1000x typo has happened once (migration 0002);
--      assume it can happen again and read the numbers twice.
--   4. Replace every VERIFY comment with the printed value.
--   5. Copy to migrations/0011_agdirect_2026_09.sql and run the suite. The
--      seed guards check band labels against bounds, term labels against
--      months, and rate sanity.
--
-- Every column follows the 0001 seed conventions: id pattern
-- agdirect-2026-09-01-{band}-{term}-{kind}, as_of_date the first of the
-- month, valid_through the last printed day of validity.

INSERT INTO benchmarks (id, source, source_url, as_of_date, snapshot_key, amount_band, amount_min_cents, amount_max_cents, term_band, term_min_months, term_max_months, rate_bps, rate_kind, tier, country, valid_through) VALUES
('agdirect-2026-09-01-250k-2to3y-fixed', 'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$250,000+',          25000000000, NULL,        '2-3 years', 24, 36, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-250k-4y-fixed',    'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$250,000+',          25000000000, NULL,        '4 years',   48, 48, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-250k-5y-fixed',    'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$250,000+',          25000000000, NULL,        '5 years',   60, 60, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-250k-6to7y-fixed', 'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$250,000+',          25000000000, NULL,        '6-7 years', 72, 84, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-250k-2to3y-var',   'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$250,000+',          25000000000, NULL,        '2-3 years', 24, 36, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-250k-4y-var',      'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$250,000+',          25000000000, NULL,        '4 years',   48, 48, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-250k-5y-var',      'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$250,000+',          25000000000, NULL,        '5 years',   60, 60, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-250k-6to7y-var',   'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$250,000+',          25000000000, NULL,        '6-7 years', 72, 84, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-100k-2to3y-fixed', 'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$100,000-$249,999', 10000000000, 24999900000, '2-3 years', 24, 36, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-100k-4y-fixed',    'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$100,000-$249,999', 10000000000, 24999900000, '4 years',   48, 48, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-100k-5y-fixed',    'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$100,000-$249,999', 10000000000, 24999900000, '5 years',   60, 60, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-100k-6to7y-fixed', 'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$100,000-$249,999', 10000000000, 24999900000, '6-7 years', 72, 84, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-100k-2to3y-var',   'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$100,000-$249,999', 10000000000, 24999900000, '2-3 years', 24, 36, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-100k-4y-var',      'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$100,000-$249,999', 10000000000, 24999900000, '4 years',   48, 48, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-100k-5y-var',      'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$100,000-$249,999', 10000000000, 24999900000, '5 years',   60, 60, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-100k-6to7y-var',   'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$100,000-$249,999', 10000000000, 24999900000, '6-7 years', 72, 84, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-25k-2to3y-fixed',  'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$25,000-$99,999',    2500000000,  9999900000, '2-3 years', 24, 36, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-25k-4y-fixed',     'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$25,000-$99,999',    2500000000,  9999900000, '4 years',   48, 48, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-25k-5y-fixed',     'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$25,000-$99,999',    2500000000,  9999900000, '5 years',   60, 60, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-25k-6to7y-fixed',  'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$25,000-$99,999',    2500000000,  9999900000, '6-7 years', 72, 84, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-25k-2to3y-var',    'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$25,000-$99,999',    2500000000,  9999900000, '2-3 years', 24, 36, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-25k-4y-var',       'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$25,000-$99,999',    2500000000,  9999900000, '4 years',   48, 48, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-25k-5y-var',       'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$25,000-$99,999',    2500000000,  9999900000, '5 years',   60, 60, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-25k-6to7y-var',    'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$25,000-$99,999',    2500000000,  9999900000, '6-7 years', 72, 84, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-5k-2to3y-fixed',   'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$5,000-$24,999',      500000000,  2499900000, '2-3 years', 24, 36, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-5k-4y-fixed',      'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$5,000-$24,999',      500000000,  2499900000, '4 years',   48, 48, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-5k-5y-fixed',      'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$5,000-$24,999',      500000000,  2499900000, '5 years',   60, 60, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-5k-6to7y-fixed',   'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$5,000-$24,999',      500000000,  2499900000, '6-7 years', 72, 84, 0 /* VERIFY against the printed card */, 'fixed',    1, 'US', '2026-09-30'),
('agdirect-2026-09-01-5k-2to3y-var',     'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$5,000-$24,999',      500000000,  2499900000, '2-3 years', 24, 36, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-5k-4y-var',        'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$5,000-$24,999',      500000000,  2499900000, '4 years',   48, 48, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-5k-5y-var',        'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$5,000-$24,999',      500000000,  2499900000, '5 years',   60, 60, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30'),
('agdirect-2026-09-01-5k-6to7y-var',     'AgDirect', 'https://www.agdirect.com/rates', '2026-09-01', 'benchmarks/agdirect/2026-09-01.html', '$5,000-$24,999',      500000000,  2499900000, '6-7 years', 72, 84, 0 /* VERIFY against the printed card */, 'variable', 1, 'US', '2026-09-30');
