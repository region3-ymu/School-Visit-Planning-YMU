-- #64 (Emilio Medrano, 2026-10-15): a school can be ON HOLD or INACTIVE.
--
-- Eric's planner kept saying "Never visited" about schools where YMU has no
-- classes yet, and counting them in his stats. ON_HOLD is temporary — ours,
-- but nothing to visit yet: not proposed, not counted, no "Never visited", a
-- visit can still be logged by hand. INACTIVE is for schools we no longer
-- work with or that closed: hidden everywhere except history.
--
-- A new column, not School.active: that flag already means "merged duplicate"
-- and the nightly YMU-A roster import sets it back to true every night.
-- Admin, Operations and the region's Regional Manager change it from the
-- school's page; the dashboard suggests a hold when a school has had no
-- class in the calendar for weeks.
CREATE TYPE "SchoolStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'INACTIVE');

ALTER TABLE "School"
  ADD COLUMN "status" "SchoolStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "statusChangedById" TEXT,
  ADD COLUMN "activeSince" TIMESTAMP(3),
  ADD COLUMN "holdSuggestionSnoozedUntil" TIMESTAMP(3);

CREATE INDEX "School_status_idx" ON "School"("status");
