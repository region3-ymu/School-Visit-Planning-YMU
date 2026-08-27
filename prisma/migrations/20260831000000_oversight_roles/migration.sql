-- The oversight roles: CPO, Operations Manager, Academic Manager.
--
-- They see every region and plan nothing. Adding them to the enum rather than
-- treating them all as ADMIN keeps two things straight that were about to be
-- conflated: ADMIN administers the app (calendar sync, accounts, correcting bad
-- data) while these three read it, and a mileage report has to be able to say
-- which of them it was for.
--
-- Mirrors YMU-A's app_role, where cpo / operations_manager / academic_manager /
-- administrator are likewise separate values with one shared permission set.
--
-- Additive only: no existing row changes, and Postgres appends enum values
-- without rewriting the table.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CPO';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OPERATIONS_MANAGER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACADEMIC_MANAGER';
