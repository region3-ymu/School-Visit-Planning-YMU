-- The YMU office is a real place an RM drives from, drives to, and stops at, so
-- mileage has to reach it the same way it reaches a school. Modelling it as a
-- School row is what lets Visit, the chaining logic and the mileage report treat
-- it without any of them learning a second kind of destination.
--
-- The flag is what keeps it out of everywhere a *school* is meant: dashboard
-- counts, the planner's candidate list, the visit dropdowns, and — importantly —
-- the roster importers, which deactivate or delete any row missing from their
-- source file and would otherwise quietly remove the office on the next run.

ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "isOffice" BOOLEAN NOT NULL DEFAULT false;

-- Partial index: every "real schools only" query filters on this.
CREATE INDEX IF NOT EXISTS "School_isOffice_idx" ON "School" ("isOffice");
