-- 0006 — pocket presence.
--
-- The manifest makes the tool installable. Without these two, we cannot tell
-- whether anybody installed it or whether an installed copy is where decodes
-- come from, which is the only reason installability is worth anything: a
-- farmer who launches from the icon is a farmer we did not have to buy twice.
--
-- 0001 through 0005 are not edited. They shipped.

-- Whether this decode was run from an installed copy. Null on the no-JS path,
-- which is not a failure: the typed form works with no JavaScript at all and
-- an unmarked decode is simply one we could not ask about.
ALTER TABLE decodes ADD COLUMN launched_standalone INTEGER
  CHECK (launched_standalone IN (0, 1));

CREATE INDEX decodes_standalone ON decodes (launched_standalone, synthetic);

-- The install funnel itself lives in events, which already carries the
-- synthetic flag: install_prompt_shown, install_accepted, install_dismissed,
-- standalone_launch. No migration needed for those; events takes any name.
