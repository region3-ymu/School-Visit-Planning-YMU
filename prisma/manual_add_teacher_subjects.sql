-- Manual patch for existing database (non-empty migration history).
-- Adds the `subjects` column used by /schools/[id]/teachers CRUD.
--
-- Run:
--   npx prisma db execute --file prisma/manual_add_teacher_subjects.sql

ALTER TABLE "Teacher"
ADD COLUMN IF NOT EXISTS "subjects" TEXT;

