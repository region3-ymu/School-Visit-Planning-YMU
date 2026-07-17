-- Phase 2: add override fields to VisitRule, migrate VisitLog → Visit, drop VisitLog

-- 1. Add override fields to VisitRule
ALTER TABLE "VisitRule" ADD COLUMN "reason" TEXT;
ALTER TABLE "VisitRule" ADD COLUMN "effectiveFrom" TIMESTAMP(3);
ALTER TABLE "VisitRule" ADD COLUMN "effectiveTo" TIMESTAMP(3);

-- 2. Copy all VisitLog rows into Visit as DONE records
--    Use the log date at 09:00–10:00 UTC so times are consistent with confirmVisit behaviour.
INSERT INTO "Visit" (id, "schoolId", "plannedStartDateTime", "plannedEndDateTime", status, reason, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "schoolId",
  date_trunc('day', date AT TIME ZONE 'UTC') + INTERVAL '9 hours',
  date_trunc('day', date AT TIME ZONE 'UTC') + INTERVAL '10 hours',
  'DONE',
  COALESCE(notes, 'Imported from visit log'),
  "createdAt",
  NOW()
FROM "VisitLog";

-- 3. Drop VisitLog (data is now in Visit)
DROP TABLE "VisitLog";
