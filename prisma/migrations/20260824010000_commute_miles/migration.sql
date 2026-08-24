-- YMU reimburses on the IRS rule: driving between work locations is business
-- mileage, but the commute at either end of the day is not. Home to the first
-- school, and the last school back home, are the RM's own cost.
--
-- Those legs are still measured — an RM wants to see the whole day, and the
-- distinction is a reimbursement question, not a "did this driving happen" one.
-- This column records how much of a visit's mileage is commute, so the payable
-- figure is (milesDriven + returnMilesDriven - commuteMiles) and the raw totals
-- stay intact for anyone who needs them.
--
-- Held as miles rather than a boolean because one return can be part business
-- and part commute: last school to the office is work, the office to home is not.

ALTER TABLE "Visit" ADD COLUMN "commuteMiles" DECIMAL(6,2);
