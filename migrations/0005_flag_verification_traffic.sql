-- 0005 — every row in production so far is verification traffic. Flag it.
--
-- Seven decodes, two email rows and thirty-two events, all written by an agent
-- proving the pipes work: three curl runs through the quick and ledger paths,
-- one browser run of the synthetic quote photograph, and the end-to-end send
-- that put two teardowns and one expiry reminder into a real inbox.
--
-- The pipes were real. The traffic was not. Three of those decodes are the
-- same $84,500 deal, so leaving them unflagged would seed the first cohort
-- median with an echo of our own test, and the canonical example would arrive
-- in the pile wearing the clothes of a farmer.
--
-- spec.md §7.2, refined in the same commit: flagging verification traffic is
-- mandatory and immediate, in the session that creates it. No sign-off is
-- needed to FLAG, because flagging destroys nothing. Sign-off is only for
-- deletion. The pile's first real row should be the first real farmer.
--
-- 0001 through 0004 are not edited. They shipped.

-- Nothing written before this migration came from a farmer. There have been no
-- ads, no link shared anywhere, and no visitor who was not the agent or the
-- owner.
UPDATE decodes SET synthetic = 1 WHERE synthetic = 0;

-- The emails table needs the same flag for the same reason: decode-to-email is
-- a wall number, and two self-addressed test sends would flatter it forever.
ALTER TABLE emails ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0
  CHECK (synthetic IN (0, 1));
UPDATE emails SET synthetic = 1;

-- Events are the funnel, so they carry the flag as a COLUMN rather than a key
-- inside meta_json. §7.2 originally said meta_json. A column is indexable,
-- type-checked, refused by a CHECK when wrong, and impossible to misspell into
-- silence, and the daily query has to filter on it every single morning. Spec
-- amended to match in this commit rather than leaving the doc describing
-- something better than what shipped.
ALTER TABLE events ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0
  CHECK (synthetic IN (0, 1));
UPDATE events SET synthetic = 1;

CREATE INDEX events_real ON events (synthetic, event, ts);
