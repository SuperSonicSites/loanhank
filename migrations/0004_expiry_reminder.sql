-- 0004 — the expiry reminder.
--
-- The only deadline this product will ever use is the one printed on the
-- dealer's own paper. Countdown timers and invented urgency are slop; "your
-- quote expires in nine days, worth knowing what it really costs before then"
-- is the dealer's deadline and our usefulness.
--
-- Opt-in, on the confirmation screen after the teardown is already sent, so it
-- is asked for twice over: once for the email, once for this. Every send this
-- product makes is a send that was requested (spec.md §10).
--
-- 0001, 0002 and 0003 are not edited. They shipped.

ALTER TABLE emails ADD COLUMN reminder_opt_in INTEGER NOT NULL DEFAULT 0
  CHECK (reminder_opt_in IN (0, 1));

-- The date to send on, taken from the quote's own expiry, not from a schedule
-- we invented. Null means there is nothing to remind about.
ALTER TABLE emails ADD COLUMN remind_on TEXT;
ALTER TABLE emails ADD COLUMN reminded_at TEXT;

-- A reminder may not be scheduled without a date to send it on, and an
-- unsubscribed address is never reminded. The second half is enforced in the
-- query that picks them up; this half is enforced here so a row cannot exist
-- claiming a reminder it has no date for.
CREATE INDEX emails_reminders ON emails (reminder_opt_in, remind_on, reminded_at, unsubscribed_at);
