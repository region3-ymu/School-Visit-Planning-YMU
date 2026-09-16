-- Who plans afterschool as well as the school day, as its own fact.
--
-- programmeScopeFor() answered this from the role alone: the Afterschool
-- Manager got "only-afterschool" and everybody else got "exclude-afterschool".
-- That is right for four of the five Regional Managers and wrong for the
-- fifth — North is accountable for the afterschool programme at Norland Middle
-- School, and the exclusion hid all 52 of its sessions from his planner and
-- from "Add a visit". He reported it as the classes not being there at all.
--
-- A column rather than a branch naming the North region, because YMU was
-- explicit that it is one person for now and expected to change ("solo él ...
-- los otros regional managers hasta ahora no veríamos los afterschool"). That
-- makes flipping it an UPDATE instead of a migration.
--
-- Defaults to false, so no account gains anything by being migrated, and the
-- one that needs it is set explicitly below. Mirrors profiles.sees_afterschool
-- in YMU-A (its migration 0113) — the same decision about the same person, in
-- the app where it is enforced by RLS instead of by a filter.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "seesAfterschool" BOOLEAN NOT NULL DEFAULT false;

-- By email rather than by id, so the statement says who it is about. Matches
-- nothing, and changes nothing, in an environment that has no such account.
UPDATE "User"
   SET "seesAfterschool" = true
 WHERE lower("email") = 'region1@ymu.org'
   AND "role" = 'REGIONAL_MANAGER';
