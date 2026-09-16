-- Which programme a visit watched.
--
-- A visit recorded the school, and after 20260829 the teacher, but never the
-- thing the observation is actually about. The Academic Manager reads the
-- export and cannot answer "how is Beginning Band going across the region",
-- because no row says a visit was Beginning Band. The app knew all along:
-- picking a visit means picking a class slot, and that slot has a subject.
-- The choice just wasn't kept, exactly as the teacher wasn't before.
--
-- Subject rather than ClassSession, even though the slot is the richer fact.
-- ClassSession rows are disposable: the calendar sync deletes events that get
-- cancelled, and scripts/prune-past-class-sessions.ts drops an entire past
-- school year, both written on the stated assumption that nothing else
-- references them. Pointing visits at those rows would either block the prune
-- or quietly blank the programme on every visit older than a year — which is
-- the one thing this column exists to prevent. Subject is the stable
-- catalogue: unique by name, created by the sync and never deleted by it.
--
-- Nullable, and null for every visit already on record. Those visits did not
-- capture it, and a programme inferred now from a timetable that has since
-- been edited would read as recorded fact. Backfilling from overlapping class
-- sessions is a separate, reviewable step.
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "observedSubjectId" TEXT;

ALTER TABLE "Visit" ADD CONSTRAINT "Visit_observedSubjectId_fkey"
  FOREIGN KEY ("observedSubjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Visit_observedSubjectId_idx" ON "Visit" ("observedSubjectId");
