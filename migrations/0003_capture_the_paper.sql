-- 0003 — capture everything on the paper, label everything in the pile.
--
-- Data quality is the moat and none of this retrofits onto unlabeled rows, so
-- the columns land before the traffic does. Most stay null for now; an empty
-- column is fine, a lost field is gone forever.
--
-- 0001 and 0002 are not edited. They shipped.

-- ---------------------------------------------------------------------------
-- POLLUTION FLAGS. Three sources, each labeled, none deleted.
--
-- Nothing is thrown away, because a row we refuse to publish is still a row we
-- can learn from. Published statistics read reconciled = 1 AND synthetic = 0
-- AND out_of_bounds = 0, and nothing else ever does.
-- ---------------------------------------------------------------------------
ALTER TABLE decodes ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1));
ALTER TABLE decodes ADD COLUMN out_of_bounds INTEGER NOT NULL DEFAULT 0 CHECK (out_of_bounds IN (0, 1));

-- Every decode written before this migration was an agent test against
-- production: three curl runs and one browser run of the synthetic quote
-- photograph, on 2026-08-15, before any ad had run and before any farmer had
-- seen the page. spec.md 7.2 says test rows never enter production and that a
-- row written there anyway is flagged and excluded. They were not flagged at
-- the time. They are now.
UPDATE decodes SET synthetic = 1;

-- ---------------------------------------------------------------------------
-- COUNTRY. First, because it partitions everything after it.
--
-- The engine has known Canadian semi-annual compounding since the ancestor and
-- it is tested. What does not exist is a published Canadian equipment rate
-- card, so a Canadian deal gets the math and an honest abstention rather than
-- a verdict against an American card. Labeled Canadian rows are the only
-- Canadian equipment-finance benchmark that will ever exist, and they only
-- exist if they are collected from the first day.
-- ---------------------------------------------------------------------------
ALTER TABLE decodes ADD COLUMN country TEXT CHECK (country IN ('US', 'CA'));
ALTER TABLE decodes ADD COLUMN currency TEXT CHECK (currency IN ('USD', 'CAD'));
ALTER TABLE decodes ADD COLUMN province_or_state TEXT;

-- Benchmarks are country-scoped too. A tier-1 match requires the same country,
-- so an American card can never back a Canadian verdict by accident.
ALTER TABLE benchmarks ADD COLUMN country TEXT NOT NULL DEFAULT 'US' CHECK (country IN ('US', 'CA'));

-- ---------------------------------------------------------------------------
-- THE TREASURES. Fields that specific buried datasets starve without.
-- ---------------------------------------------------------------------------

-- Price database: brand already exists; the model is the other half of it.
ALTER TABLE decodes ADD COLUMN model TEXT;

-- Timing intel, and the only honest deadline this product will ever use: the
-- one printed on the dealer's own paper. quote_date also keeps stale paper out
-- of a current-quarter median.
ALTER TABLE decodes ADD COLUMN quote_date TEXT;
ALTER TABLE decodes ADD COLUMN quote_expiry_date TEXT;

-- Subvention depth. A dealer's own discount and a manufacturer's rebate are
-- different money answering different questions: one is a salesperson's room,
-- the other is a factory buying its channel. Rolled into one number the signal
-- is dead, and buydown-depth-by-brand-by-quarter is a flagship treasure.
-- cash_discount_cents stays as the total, because that is what the rate math
-- uses; these two are its parts.
ALTER TABLE decodes ADD COLUMN dealer_discount_cents INTEGER;
ALTER TABLE decodes ADD COLUMN manufacturer_rebate_cents INTEGER;
ALTER TABLE decodes ADD COLUMN promo_name TEXT;

-- Trade values are the other closed dataset. What a dealer will allow on a
-- 2014 combine with 2,300 hours is worth knowing and nobody publishes it.
ALTER TABLE decodes ADD COLUMN trade_brand TEXT;
ALTER TABLE decodes ADD COLUMN trade_model TEXT;
ALTER TABLE decodes ADD COLUMN trade_year INTEGER;
ALTER TABLE decodes ADD COLUMN trade_hours INTEGER;

-- ---------------------------------------------------------------------------
-- STRUCTURES THE ENGINE CANNOT PRICE YET. Flag, then abstain in plain words.
-- ---------------------------------------------------------------------------

-- Seasonal and skip-payment schedules are ordinary on ag paper and the engine
-- prices level annuities. Until it handles irregular schedules, this flag
-- forces an abstention. A monthly approximation of a skip-payment note is a
-- confidently wrong number, which is the one thing this product cannot ship.
ALTER TABLE decodes ADD COLUMN schedule_irregular INTEGER NOT NULL DEFAULT 0 CHECK (schedule_irregular IN (0, 1));

-- One sheet, several offers. Extraction detects it, the farmer picks which one
-- to decode. Same rule as the ancestor's multiple-loans detection: never
-- combine values across offers.
ALTER TABLE decodes ADD COLUMN multi_option INTEGER NOT NULL DEFAULT 0 CHECK (multi_option IN (0, 1));

-- ---------------------------------------------------------------------------
-- PEER SNAPSHOT. Every statistic a farmer was shown, frozen on his row.
--
-- Same discipline as verdict_ref_id: a ticket rendered today has to be
-- reproducible in two years, after the cohort has moved underneath it. The
-- cohort key and n are stored beside the numbers so the claim can be audited,
-- not just repeated.
-- ---------------------------------------------------------------------------
ALTER TABLE decodes ADD COLUMN peer_cohort_key TEXT;
ALTER TABLE decodes ADD COLUMN peer_n INTEGER;
ALTER TABLE decodes ADD COLUMN peer_median_bps INTEGER;
ALTER TABLE decodes ADD COLUMN peer_p25_bps INTEGER;
ALTER TABLE decodes ADD COLUMN peer_p75_bps INTEGER;
ALTER TABLE decodes ADD COLUMN peer_computed_at TEXT;
ALTER TABLE decodes ADD COLUMN peer_policy_version TEXT;

-- Cohort reads are country- and currency-partitioned. CAD and USD are never
-- pooled, converted, or compared, so currency is part of the key rather than a
-- column somebody could forget to filter on.
CREATE INDEX decodes_cohort_v2 ON decodes (
  country, currency, quarter, equip_category, new_or_used, term_band, price_band,
  reconciled, synthetic, out_of_bounds
);

-- The AgDirect seed is American. Explicit rather than relying on the default.
UPDATE benchmarks SET country = 'US' WHERE source = 'AgDirect';
