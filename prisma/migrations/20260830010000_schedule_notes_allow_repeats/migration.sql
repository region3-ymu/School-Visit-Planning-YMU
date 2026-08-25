-- Elementary programmes repeat the same line for each day they run: Arcola Lake
-- lists P+R on Tuesdays, Thursdays and Fridays, all with no period. A unique key
-- on (school, subject, period) collapsed those into one and dropped the days,
-- which is the very thing this table exists to carry.
--
-- Nothing keys off these rows — they are replaced wholesale per school on each
-- import and read only for display — so uniqueness buys nothing and costs data.

DROP INDEX IF EXISTS "ProgramScheduleNote_schoolId_subjectName_period_key";
