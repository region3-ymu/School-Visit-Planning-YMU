-- One VisitRule has the empty string as its primary key.
--
-- Little River K-8's rule, from an early seed that handed Prisma an explicit
-- id of "" instead of letting @default(cuid()) do it. Postgres accepts it —
-- TEXT is TEXT and "" is a value like any other — so it has sat there working
-- well enough to be invisible: the rule applies, the planner reads it, the
-- school's cadence is right.
--
-- What it breaks is the export. "Rule ID" is one of the join keys added on
-- 20260916 so the Academic Manager can point a lookup at a row, and this row
-- is the one that cannot be pointed at; it reads as a rule with no id, which
-- looks like the export dropping data rather than the data being odd.
--
-- Safe to rewrite: nothing has a foreign key onto VisitRule. The id is
-- literal rather than generated, because a migration that produces a
-- different value every time it runs is not a migration.
UPDATE "VisitRule"
   SET "id" = 'cmu4kpmly8cei0zg51trxqkbh'
 WHERE "id" = '';
