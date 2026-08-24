-- The commute at the end of the day needs its own column, separate from the one
-- at the start.
--
-- A single visit row can carry both: the day's only stop is reached from home in
-- the morning and left for home in the evening. Sharing one column would mean
-- closing the day had to read back, and correctly re-derive, the morning's share
-- before overwriting — and re-closing a day would quietly corrupt it. Each column
-- now has exactly one writer.
--
-- A return can also be part business and part commute: last school to the office
-- is work, office to home is not. Only the home-bound share lands here.

ALTER TABLE "Visit" ADD COLUMN "returnCommuteMiles" DECIMAL(6,2);
