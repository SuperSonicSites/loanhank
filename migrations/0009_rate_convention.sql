-- 0009 — which compounding reading reconciled this ledger.
--
-- A Canadian quote can lawfully be written nominal or semiannual (Interest
-- Act s.6) and the paper never says which. The engine now tries both lawful
-- readings for a Canadian ledger and reports the one the dealer's own
-- arithmetic satisfies, so reconciled = 1 without this column would be a
-- claim with no receipt. Same reproducibility reason verdict_ref_id exists.
-- Null on quick-path rows, which never reconcile.
--
-- 0001 through 0008 are not edited. They shipped.

ALTER TABLE decodes ADD COLUMN rate_convention TEXT
  CHECK (rate_convention IN ('nominal_payment_frequency', 'nominal_semiannual'));
