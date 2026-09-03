-- An in-person visit made riding along in someone else's personal car — not
-- the RM's own car, and not YMU's van either. Its miles are recorded and
-- never owed to the RM, same treatment as YMU_VAN, but tracked as its own
-- category rather than folded into "the van" (that would misreport whose
-- fuel it was).

ALTER TYPE "VehicleType" ADD VALUE IF NOT EXISTS 'OTHER_PERSON_CAR';
