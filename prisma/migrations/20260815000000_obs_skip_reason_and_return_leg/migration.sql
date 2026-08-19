-- Two gaps this closes.
--
-- 1. Marking "YMU teacher" used to force the observation rubric on screen with
--    no way to say the class never happened. A blank rubric then read as "the
--    RM didn't bother", not "there was nothing to watch". Record the reason.
--
-- 2. Mileage only ever measured the legs *toward* schools. The drive home at
--    the end of the day — routinely the longest single leg — was never billed.
--    It is stored on the day's last visit rather than as its own row, so the
--    mileage report stays one query and a day can only ever have one return.

-- CreateEnum
CREATE TYPE "ObservationSkipReason" AS ENUM (
  'NO_CLASS_TODAY',
  'CLASS_CANCELLED',
  'TEACHER_ABSENT',
  'SCHEDULE_CONFLICT',
  'OTHER'
);

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "obsSkipReason" "ObservationSkipReason";
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "obsSkipNotes" TEXT;

-- AlterTable: the closing leg back to the RM's start point.
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "returnMilesDriven" DECIMAL(6,2);
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "returnLabel" TEXT;
