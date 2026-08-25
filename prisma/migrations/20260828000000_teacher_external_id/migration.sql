-- Teachers came from the calendar sync, which names a Teacher after the calendar
-- it found — and YMU's calendars are named after schools. The result is 53
-- "teachers" that are mostly school names, with the handful of real people
-- carrying no classes at all.
--
-- YMU-A already knows who actually teaches each class. Matching on the Google
-- event id lines its events up with ours at 99.6%, so the real teacher can be
-- attached to each session. This column is what makes that import repeatable
-- rather than a one-off that duplicates everyone on a second run.

ALTER TABLE "Teacher" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Teacher_externalId_key" ON "Teacher" ("externalId");
