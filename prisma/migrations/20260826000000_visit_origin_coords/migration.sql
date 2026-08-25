-- Where a day started, kept as coordinates rather than only as a label.
--
-- Mileage chains each stop from the one before it, so the whole day hangs off
-- the first leg. That leg was recorded as a distance and a name ("Home") with no
-- coordinates, which meant a day could never be recalculated: remembering a stop
-- in the wrong order, or remembering one late, left every following figure wrong
-- with no way to fix it short of deleting the day and retyping it.
--
-- With the origin stored, a day can be reordered and its mileage recomputed from
-- the same starting point it actually had.

ALTER TABLE "Visit" ADD COLUMN "originLat" DOUBLE PRECISION;
ALTER TABLE "Visit" ADD COLUMN "originLng" DOUBLE PRECISION;
