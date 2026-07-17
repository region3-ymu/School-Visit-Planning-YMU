-- Teacher observation fields on Visit (shown in the Confirm Visit modal
-- when visitedWith includes YMU_TEACHER).

CREATE TYPE "ObservationRating" AS ENUM ('NEEDS_SUPPORT', 'DEVELOPING', 'MEETS', 'EXCEEDS');

ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "obsPlanningPrep" "ObservationRating";
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "obsCultureManagement" "ObservationRating";
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "obsInstructionMusicianship" "ObservationRating";
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "obsEngagementEvidence" "ObservationRating";
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "obsProfessionalismGrowth" "ObservationRating";
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "obsNotes" TEXT;
