-- 0001_init — spec.md section 5.1.
--
-- Append-only. Never edit this file after it ships; add 0002.
--
-- UNITS ARE IN THE COLUMN NAMES ON PURPOSE. Every money column is integer
-- `_cents` and every rate column is integer `_bps`, because the engine works
-- in cents and basis points end to end and a column called `cash_price`
-- holding 84500 is indistinguishable from one holding 8450000. A confidently
-- wrong number is the one fatal bug class in this product.

-- THE GOLD. One row per decode. No PII, no dealer name, no account numbers.
CREATE TABLE decodes (
  id                    TEXT PRIMARY KEY,
  ts                    TEXT NOT NULL,
  quarter               TEXT NOT NULL,

  -- context
  state                 TEXT,
  region                TEXT,
  equip_category        TEXT,
  new_or_used           TEXT CHECK (new_or_used IN ('new', 'used')),
  structure_type        TEXT CHECK (structure_type IN ('0pct_discount', 'standard', 'lease', 'balloon')),
  lender_type           TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (lender_type IN ('captive', 'bank', 'fcs', 'cu', 'unknown')),

  -- the deal ledger (spec.md section 2.2). Quick-path rows carry only the
  -- four fields the farmer typed; the rest stay null and are declared in
  -- assumptions_json rather than defaulted to zero.
  cash_price_cents      INTEGER,
  finance_price_cents   INTEGER,
  cash_discount_cents   INTEGER,
  trade_allowance_cents INTEGER,
  trade_payoff_cents    INTEGER,
  down_payment_cents    INTEGER,
  tax_cash_cents        INTEGER,
  tax_finance_cents     INTEGER,
  delivery_setup_cents  INTEGER,
  amount_financed_cents INTEGER,
  payment_amount_cents  INTEGER,
  payment_frequency     TEXT CHECK (payment_frequency IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  payment_count         INTEGER,
  balloon_cents         INTEGER,
  term_months           INTEGER,
  stated_rate_bps       INTEGER,

  -- fees (spec.md section 2.1). One JSON array of
  -- { name, amount_cents, required, finance_only, rolled_into_finance, status }.
  fees_json             TEXT NOT NULL DEFAULT '[]',

  -- what the engine computed
  real_rate_all_in_bps  INTEGER,
  promo_price_rate_bps  INTEGER,
  reconciled            INTEGER NOT NULL DEFAULT 0 CHECK (reconciled IN (0, 1)),
  assumptions_json      TEXT NOT NULL DEFAULT '[]',
  verdict               TEXT NOT NULL DEFAULT 'none'
                          CHECK (verdict IN ('checks_out', 'look_closer', 'none')),
  verdict_ref_id        TEXT REFERENCES benchmarks (id),
  benchmark_at_ts       TEXT,
  delta_vs_benchmark_bps INTEGER,

  -- cohort banding
  price_band            TEXT,
  term_band             TEXT,
  down_pct              REAL,

  -- forage fields. Grab if on paper, never require.
  brand                 TEXT,
  model_year            INTEGER,
  hours                 INTEGER,
  list_price_cents      INTEGER,

  -- Stamp law, enforced by the database rather than by remembering to check:
  -- a verdict requires a reconciled ledger AND a matched benchmark row. There
  -- is no way to write a row that claims a verdict it did not earn.
  CHECK (verdict = 'none' OR (reconciled = 1 AND verdict_ref_id IS NOT NULL))
);

-- Cohort reads: equip_category x new_or_used x term_band x price_band x quarter,
-- and only reconciled rows are ever counted (spec.md section 9, pile hygiene).
CREATE INDEX decodes_cohort ON decodes (
  quarter, equip_category, new_or_used, term_band, price_band, reconciled
);
CREATE INDEX decodes_ts ON decodes (ts);

-- Published reference rates. Hand-entered, one row per source x band x date.
-- Every row carries where it came from, what day it describes, and the R2 key
-- of the archived page, so any past verdict stays reproducible after the
-- source is reformatted or pulled (spec.md section 4, snapshot rule).
CREATE TABLE benchmarks (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL,
  source_url        TEXT NOT NULL,
  as_of_date        TEXT NOT NULL,
  snapshot_key      TEXT NOT NULL,

  -- Display label plus the bounds the matcher actually compares against.
  -- A label alone cannot answer "does a $78,500 quote fall in this band".
  amount_band       TEXT NOT NULL,
  amount_min_cents  INTEGER NOT NULL,
  amount_max_cents  INTEGER,
  term_band         TEXT NOT NULL,
  term_min_months   INTEGER NOT NULL,
  term_max_months   INTEGER NOT NULL,

  rate_bps          INTEGER NOT NULL,
  -- A fixed dealer promo compared against a variable benchmark is a wrong
  -- comparison, not a close one.
  rate_kind         TEXT NOT NULL CHECK (rate_kind IN ('fixed', 'variable')),
  -- spec.md section 4: only tier 1 may back a verdict. Tier 2 is a context
  -- line. Tier 3 is never shown beside an equipment quote.
  tier              INTEGER NOT NULL CHECK (tier IN (1, 2, 3))
);

CREATE INDEX benchmarks_match ON benchmarks (tier, rate_kind, as_of_date);

-- Email captured at gate 1. Consent columns exist and stay empty until the
-- lawyer stones clear (spec.md section 8 Phase C); nothing moves before then.
CREATE TABLE emails (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL,
  decode_id             TEXT REFERENCES decodes (id),
  created_at            TEXT NOT NULL,
  consented             INTEGER NOT NULL DEFAULT 0 CHECK (consented IN (0, 1)),
  consent_ts            TEXT,
  -- The exact text version the farmer saw. A consent row without it is not a
  -- receipt, so consent may not be recorded without one.
  consent_text_version  TEXT,
  unsubscribed_at       TEXT,

  CHECK (consented = 0 OR (consent_ts IS NOT NULL AND consent_text_version IS NOT NULL))
);

CREATE INDEX emails_decode ON emails (decode_id);

-- The funnel. Every step writes one row; ops/funnel.sql reads them. This is
-- the whole of analytics, because there are no tracking cookies and no pixel.
CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  event      TEXT NOT NULL,
  decode_id  TEXT REFERENCES decodes (id),
  ts         TEXT NOT NULL,
  meta_json  TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX events_event_ts ON events (event, ts);

-- ---------------------------------------------------------------------------
-- Benchmark seed: AgDirect published equipment rates.
--
-- Source:   https://www.agdirect.com/rates
-- Printed:  "Rates effective August 01-31 2026"
-- Archived: loanhank-snapshots/benchmarks/agdirect/2026-08-01.html
--
-- Transcribed by hand from the card, exactly as published. AgDirect republishes
-- monthly, so this table goes stale monthly, not quarterly.
--
-- The card prints "subject to credit approval" and that caveat rides along with
-- every verdict (spec.md section 3).
-- ---------------------------------------------------------------------------

INSERT INTO benchmarks (id, source, source_url, as_of_date, snapshot_key, amount_band, amount_min_cents, amount_max_cents, term_band, term_min_months, term_max_months, rate_bps, rate_kind, tier) VALUES
-- $250,000+
('agdirect-2026-08-01-250k-2to3y-fixed', 'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$250,000+',            25000000000, NULL,        '2-3 years', 24, 36, 650, 'fixed',    1),
('agdirect-2026-08-01-250k-4y-fixed',    'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$250,000+',            25000000000, NULL,        '4 years',   48, 48, 650, 'fixed',    1),
('agdirect-2026-08-01-250k-5y-fixed',    'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$250,000+',            25000000000, NULL,        '5 years',   60, 60, 650, 'fixed',    1),
('agdirect-2026-08-01-250k-6to7y-fixed', 'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$250,000+',            25000000000, NULL,        '6-7 years', 72, 84, 675, 'fixed',    1),
('agdirect-2026-08-01-250k-2to3y-var',   'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$250,000+',            25000000000, NULL,        '2-3 years', 24, 36, 599, 'variable', 1),
('agdirect-2026-08-01-250k-4y-var',      'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$250,000+',            25000000000, NULL,        '4 years',   48, 48, 599, 'variable', 1),
('agdirect-2026-08-01-250k-5y-var',      'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$250,000+',            25000000000, NULL,        '5 years',   60, 60, 599, 'variable', 1),
('agdirect-2026-08-01-250k-6to7y-var',   'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$250,000+',            25000000000, NULL,        '6-7 years', 72, 84, 599, 'variable', 1),

-- $100,000-$249,999
('agdirect-2026-08-01-100k-2to3y-fixed', 'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$100,000-$249,999',   10000000000, 24999900000, '2-3 years', 24, 36, 675, 'fixed',    1),
('agdirect-2026-08-01-100k-4y-fixed',    'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$100,000-$249,999',   10000000000, 24999900000, '4 years',   48, 48, 675, 'fixed',    1),
('agdirect-2026-08-01-100k-5y-fixed',    'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$100,000-$249,999',   10000000000, 24999900000, '5 years',   60, 60, 675, 'fixed',    1),
('agdirect-2026-08-01-100k-6to7y-fixed', 'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$100,000-$249,999',   10000000000, 24999900000, '6-7 years', 72, 84, 695, 'fixed',    1),
('agdirect-2026-08-01-100k-2to3y-var',   'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$100,000-$249,999',   10000000000, 24999900000, '2-3 years', 24, 36, 599, 'variable', 1),
('agdirect-2026-08-01-100k-4y-var',      'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$100,000-$249,999',   10000000000, 24999900000, '4 years',   48, 48, 599, 'variable', 1),
('agdirect-2026-08-01-100k-5y-var',      'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$100,000-$249,999',   10000000000, 24999900000, '5 years',   60, 60, 599, 'variable', 1),
('agdirect-2026-08-01-100k-6to7y-var',   'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$100,000-$249,999',   10000000000, 24999900000, '6-7 years', 72, 84, 599, 'variable', 1),

-- $25,000-$99,999
('agdirect-2026-08-01-25k-2to3y-fixed',  'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$25,000-$99,999',      2500000000,  9999900000,  '2-3 years', 24, 36, 725, 'fixed',    1),
('agdirect-2026-08-01-25k-4y-fixed',     'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$25,000-$99,999',      2500000000,  9999900000,  '4 years',   48, 48, 725, 'fixed',    1),
('agdirect-2026-08-01-25k-5y-fixed',     'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$25,000-$99,999',      2500000000,  9999900000,  '5 years',   60, 60, 725, 'fixed',    1),
('agdirect-2026-08-01-25k-6to7y-fixed',  'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$25,000-$99,999',      2500000000,  9999900000,  '6-7 years', 72, 84, 750, 'fixed',    1),
('agdirect-2026-08-01-25k-2to3y-var',    'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$25,000-$99,999',      2500000000,  9999900000,  '2-3 years', 24, 36, 599, 'variable', 1),
('agdirect-2026-08-01-25k-4y-var',       'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$25,000-$99,999',      2500000000,  9999900000,  '4 years',   48, 48, 599, 'variable', 1),
('agdirect-2026-08-01-25k-5y-var',       'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$25,000-$99,999',      2500000000,  9999900000,  '5 years',   60, 60, 599, 'variable', 1),
('agdirect-2026-08-01-25k-6to7y-var',    'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$25,000-$99,999',      2500000000,  9999900000,  '6-7 years', 72, 84, 599, 'variable', 1),

-- $5,000-$24,999
('agdirect-2026-08-01-5k-2to3y-fixed',   'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$5,000-$24,999',        500000000,  2499900000,  '2-3 years', 24, 36, 795, 'fixed',    1),
('agdirect-2026-08-01-5k-4y-fixed',      'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$5,000-$24,999',        500000000,  2499900000,  '4 years',   48, 48, 795, 'fixed',    1),
('agdirect-2026-08-01-5k-5y-fixed',      'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$5,000-$24,999',        500000000,  2499900000,  '5 years',   60, 60, 795, 'fixed',    1),
('agdirect-2026-08-01-5k-6to7y-fixed',   'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$5,000-$24,999',        500000000,  2499900000,  '6-7 years', 72, 84, 795, 'fixed',    1),
('agdirect-2026-08-01-5k-2to3y-var',     'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$5,000-$24,999',        500000000,  2499900000,  '2-3 years', 24, 36, 599, 'variable', 1),
('agdirect-2026-08-01-5k-4y-var',        'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$5,000-$24,999',        500000000,  2499900000,  '4 years',   48, 48, 599, 'variable', 1),
('agdirect-2026-08-01-5k-5y-var',        'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$5,000-$24,999',        500000000,  2499900000,  '5 years',   60, 60, 599, 'variable', 1),
('agdirect-2026-08-01-5k-6to7y-var',     'AgDirect', 'https://www.agdirect.com/rates', '2026-08-01', 'benchmarks/agdirect/2026-08-01.html', '$5,000-$24,999',        500000000,  2499900000,  '6-7 years', 72, 84, 599, 'variable', 1);
