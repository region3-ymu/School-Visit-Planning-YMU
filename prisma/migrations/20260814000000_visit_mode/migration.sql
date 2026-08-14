-- Not every visit is a drive. Online and phone visits still record who was met
-- and what came out of it, but there is no route leg to bill as mileage and no
-- class in the room to observe, so those fields stay null for them.

-- CreateEnum
CREATE TYPE "VisitMode" AS ENUM ('IN_PERSON', 'ONLINE', 'PHONE');

-- AlterTable: existing rows are all visits that were driven to.
ALTER TABLE "Visit" ADD COLUMN "mode" "VisitMode" NOT NULL DEFAULT 'IN_PERSON';
