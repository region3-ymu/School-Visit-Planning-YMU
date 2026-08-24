-- Most visits are driven in the RM's own car and are reimbursable. A few — the
-- ones where equipment has to be dropped off or picked up — use the YMU van,
-- where the organisation already owns the fuel and the RM is owed nothing.
--
-- The miles are still measured either way: the van's mileage is worth having on
-- record for the vehicle itself. What changes is which total they land in, so a
-- reimbursement figure never includes driving YMU already paid for.

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('PERSONAL', 'YMU_VAN');

-- AlterTable: everything logged before this was a personal car.
ALTER TABLE "Visit" ADD COLUMN "vehicle" "VehicleType" NOT NULL DEFAULT 'PERSONAL';

CREATE INDEX IF NOT EXISTS "Visit_vehicle_idx" ON "Visit" ("vehicle");
