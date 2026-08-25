-- The master schedule spreadsheet, as reference text for the timetable view.
--
-- Whether a programme runs on A days or B days lives only in that sheet. The
-- calendar shows a class alternating weeks but has no idea which letter the
-- school calls itself, so the app could say "alternating" and no more.
--
-- Kept in its own table, and read nowhere but the schedule display. It is a
-- human-maintained document: nothing schedules, prices or plans against it, so
-- a stale row misleads a reader rather than corrupting a visit. Re-importing the
-- sheet replaces it wholesale.

CREATE TABLE "ProgramScheduleNote" (
  "id"             TEXT NOT NULL,
  "schoolId"       TEXT NOT NULL,
  -- Matched to a Subject by name rather than by id: the sheet is written by
  -- hand and its wording drifts from the calendar's.
  "subjectName"    TEXT NOT NULL,
  "dayPattern"     TEXT,
  "period"         TEXT,
  "timesText"      TEXT,
  "teacherName"    TEXT,
  "scheduleStatus" TEXT,
  "sourceRow"      INTEGER,
  "importedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProgramScheduleNote_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProgramScheduleNote" ADD CONSTRAINT "ProgramScheduleNote_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ProgramScheduleNote_schoolId_idx" ON "ProgramScheduleNote" ("schoolId");
CREATE UNIQUE INDEX "ProgramScheduleNote_schoolId_subjectName_period_key"
  ON "ProgramScheduleNote" ("schoolId", "subjectName", "period");
