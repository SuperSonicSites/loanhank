-- 0008 — where the farmer came from.
--
-- A decode with no origin is a decode that cannot be attributed, and the wall
-- numbers in spec.md 7.1 are cost per completed decode. Without this, spend
-- and decodes are two numbers that never meet.
--
-- The referring PAGE only, never the query string. A referrer can carry a
-- click id, an email address, or whatever the sending site chose to put in
-- it, and none of that is ours. Origin plus path, nothing after the "?".
--
-- 0001 through 0007 are not edited. They shipped.

ALTER TABLE decodes ADD COLUMN referrer TEXT;

CREATE INDEX decodes_referrer ON decodes (referrer, synthetic);
