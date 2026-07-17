-- VisitRule is now the source of truth for visit frequency.
-- Drop the redundant frequencyTarget column from School.
ALTER TABLE "School" DROP COLUMN "frequencyTarget";
