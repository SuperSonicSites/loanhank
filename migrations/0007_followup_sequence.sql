-- 0007 — the follow-up sequence.
--
-- design.md §2½ item 13: the money is in the follow-up. Day 0 the ticket, day
-- 4 a check back on the deal, day 30 the cohort if there is one. One ask per
-- step, and never a step nobody asked for.
--
-- POSTURE. Every send this product makes stays either requested or disclosed
-- at capture (spec.md §10). The teardown is requested. The expiry reminder is
-- opted into on a second screen. These two are disclosed in one plain line
-- beside the email box, before the address is typed, which is the only moment
-- a disclosure can honestly be made.
--
-- CASL, which is the stricter of the two regimes and therefore the floor:
-- asking us for a teardown is an inquiry, and an inquiry carries six months of
-- implied consent. Day 4 and day 30 sit well inside it. Anything past six
-- months needs express consent, which does not exist yet and is not built.
--
-- 0001 through 0006 are not edited. They shipped.

ALTER TABLE emails ADD COLUMN day4_sent_at TEXT;
ALTER TABLE emails ADD COLUMN day30_sent_at TEXT;

-- The disclosure the farmer actually saw, versioned like every other piece of
-- text we hold somebody to. A follow-up sent against a row with no version
-- recorded is a follow-up we cannot prove was disclosed.
ALTER TABLE emails ADD COLUMN followup_text_version TEXT;

CREATE INDEX emails_sequence ON emails (
  synthetic, unsubscribed_at, created_at, day4_sent_at, day30_sent_at
);
