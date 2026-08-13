-- Keys for importing the school roster from the YMU-A app.
--
-- School.externalId  — schools.id in YMU-A's Supabase. The re-sync key: without
--                      it a second import has to reconcile by name, and fuzzy
--                      name matching on this roster merges different schools.
-- School.geocodeSource — where lat/lng came from, so rows imported already
--                      geocoded are never re-geocoded.
-- CalendarSyncIssue.candidates — JSON [{name, score}] of the schools the
--                      matcher rejected, so an unresolved row is actionable.
--
-- NOTE: the unique index on School.googleCalendarId fails if the table already
-- holds two schools pinned to the same calendar. NULLs do not conflict in
-- Postgres, so only real duplicates are affected — dedupe them first if it
-- errors. The constraint is the point: two schools sharing a calendar silently
-- duplicate every ClassSession that calendar produces.

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "geocodeSource" TEXT;

-- AlterTable
ALTER TABLE "CalendarSyncIssue" ADD COLUMN     "candidates" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "School_externalId_key" ON "School"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "School_googleCalendarId_key" ON "School"("googleCalendarId");
