-- Google Calendar incremental sync + review queue, mileage tracking, and
-- the Confirm Visit form fields.

-- New enums
CREATE TYPE "VisitOutcome" AS ENUM ('GOOD', 'REGULAR');
CREATE TYPE "VisitedWithOption" AS ENUM ('PRINCIPAL', 'MAIN_OFFICE', 'INSCHOOL_MUSIC_TEACHER', 'YMU_TEACHER');

-- User: saved home location
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "homeAddress" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "homeLat" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "homeLng" DOUBLE PRECISION;

-- School: incremental calendar sync bookkeeping
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "calendarSyncToken" TEXT;
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "calendarLastSyncedAt" TIMESTAMP(3);

-- Visit: confirmation form + mileage + geofence fields
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "visitedById" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "milesDriven" DECIMAL(6,2);
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "originLabel" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "outcome" "VisitOutcome";
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "outcomeNotes" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "visitedWith" "VisitedWithOption"[] NOT NULL DEFAULT ARRAY[]::"VisitedWithOption"[];
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "principalNotes" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "hasInstrumentRequest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "instrumentRequestDetails" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "instrumentRequestSyncedToYMPA" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "geofenceDistanceM" DOUBLE PRECISION;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "geofenceOverridden" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "Visit" ADD CONSTRAINT "Visit_visitedById_fkey" FOREIGN KEY ("visitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Visit_visitedById_idx" ON "Visit"("visitedById");

-- CalendarSyncIssue: unmatched-calendar review queue
CREATE TABLE IF NOT EXISTS "CalendarSyncIssue" (
  "id" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL,
  "calendarSummary" TEXT,
  "reason" TEXT NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "CalendarSyncIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CalendarSyncIssue_resolvedAt_idx" ON "CalendarSyncIssue"("resolvedAt");

-- Quarter: 9-week reporting periods
CREATE TABLE IF NOT EXISTS "Quarter" (
  "id" TEXT NOT NULL,
  "schoolYear" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Quarter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Quarter_schoolYear_label_key" ON "Quarter"("schoolYear", "label");
