-- AlterTable: add geocoding coordinates to School (idempotent)
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
