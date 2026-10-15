-- One visit, several classes watched.
--
-- A visit held exactly one observation: one teacher, one programme, five
-- ratings and a note, all columns on "Visit". Carol City MS and North Dade run
-- two classes at the same time in the same building, and the RM who stands in
-- both could rate only one of them — the form offered "Not recorded" or a
-- single teacher (Eric Levy, 2026-10-15). So the observation moves to its own
-- table, one row per class watched, each with its own ratings and notes. Each
-- teacher then sees only their own evaluation in YMU-A.
--
-- What stays on "Visit": obsSkipReason and obsSkipNotes. "Did you see a
-- class?" is a question about the visit, answered once, not per class.
--
-- The old columns are NOT dropped. Nothing reads or writes them after this,
-- but they are the original record, and a migration that copies data and
-- drops the source in one step leaves nothing to compare against if the copy
-- turns out to be wrong. Dropping them is a later, separate decision.
--
-- THE BACKFILL REUSES THE VISIT'S ID. YMU-A already holds the evaluations SVP
-- sent it, keyed by the SVP visit id. Every visit migrated here becomes
-- exactly one observation, so giving that observation the visit's id keeps
-- every key YMU-A has valid: the next sync of the visit replaces the
-- evaluation it already has instead of orphaning it and creating a twin.
-- Visit and observation ids are both cuids from the same generator, so the
-- two id spaces cannot collide in a way that matters — and each table is its
-- own primary key anyway.
--
-- Copied: any visit that recorded something an observation is made of — a
-- teacher, a programme, any of the five ratings, or a non-blank note. That
-- includes visits the app would no longer store an observation for (a skip
-- reason, no YMU teacher ticked): the programme on those is still a fact
-- somebody recorded, and the relay applies its own rules before anything
-- reaches a teacher. Everything else has nothing to copy, and inventing an
-- empty row for it would read as "observed, rated nothing".

CREATE TABLE "VisitObservation" (
  "id"                         TEXT NOT NULL,
  "visitId"                    TEXT NOT NULL,
  "teacherId"                  TEXT,
  "subjectId"                  TEXT,
  "obsPlanningPrep"            "ObservationRating",
  "obsCultureManagement"       "ObservationRating",
  "obsInstructionMusicianship" "ObservationRating",
  "obsEngagementEvidence"      "ObservationRating",
  "obsProfessionalismGrowth"   "ObservationRating",
  "notes"                      TEXT,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VisitObservation_pkey" PRIMARY KEY ("id")
);

-- Cascade from the visit: an observation is part of the visit and means
-- nothing without it. SetNull from teacher and programme, as on the old
-- columns — removing a teacher must not delete the record of a lesson watched.
ALTER TABLE "VisitObservation" ADD CONSTRAINT "VisitObservation_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitObservation" ADD CONSTRAINT "VisitObservation_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VisitObservation" ADD CONSTRAINT "VisitObservation_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "VisitObservation_visitId_idx" ON "VisitObservation" ("visitId");
CREATE INDEX "VisitObservation_teacherId_idx" ON "VisitObservation" ("teacherId");

-- createdAt/updatedAt carried over from the visit, so the copy does not read
-- as something recorded today. A note that is only whitespace becomes null
-- rather than '' (BTRIM of null is null, so a null note stays null); any
-- other note is copied exactly as typed.
INSERT INTO "VisitObservation" (
  "id", "visitId", "teacherId", "subjectId",
  "obsPlanningPrep", "obsCultureManagement", "obsInstructionMusicianship",
  "obsEngagementEvidence", "obsProfessionalismGrowth",
  "notes", "createdAt", "updatedAt"
)
SELECT
  v."id", v."id", v."observedTeacherId", v."observedSubjectId",
  v."obsPlanningPrep", v."obsCultureManagement", v."obsInstructionMusicianship",
  v."obsEngagementEvidence", v."obsProfessionalismGrowth",
  CASE WHEN BTRIM(v."obsNotes") = '' THEN NULL ELSE v."obsNotes" END,
  v."createdAt", v."updatedAt"
FROM "Visit" v
WHERE v."observedTeacherId" IS NOT NULL
   OR v."observedSubjectId" IS NOT NULL
   OR v."obsPlanningPrep" IS NOT NULL
   OR v."obsCultureManagement" IS NOT NULL
   OR v."obsInstructionMusicianship" IS NOT NULL
   OR v."obsEngagementEvidence" IS NOT NULL
   OR v."obsProfessionalismGrowth" IS NOT NULL
   OR NULLIF(BTRIM(v."obsNotes"), '') IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
