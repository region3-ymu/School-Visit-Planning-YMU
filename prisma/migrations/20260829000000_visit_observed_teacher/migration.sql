-- Which teacher a visit's ratings are about.
--
-- A visit recorded the school and nothing narrower, so an observation could only
-- ever be attributed to "whoever teaches here" — and at a school with two, it
-- showed on both their records without either being the one who was watched.
--
-- The app already knows: picking a visit means picking a class slot, and Carrie
-- P. Meek's morning slot is Cristian Perez's Modern Band while the afternoon is
-- Kevin Bodniza's Music Production. That choice just wasn't being kept.
--
-- Nullable, and null for everything logged before now: those visits genuinely
-- didn't record it, and guessing a name onto a rating is worse than leaving it
-- open. SetNull rather than Cascade — removing a teacher must not delete the
-- record of a visit that happened.

ALTER TABLE "Visit" ADD COLUMN "observedTeacherId" TEXT;

ALTER TABLE "Visit" ADD CONSTRAINT "Visit_observedTeacherId_fkey"
  FOREIGN KEY ("observedTeacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Visit_observedTeacherId_idx" ON "Visit" ("observedTeacherId");
