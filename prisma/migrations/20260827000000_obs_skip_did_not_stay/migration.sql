-- Every existing reason says the class did not happen. None of them fit the
-- commonest case: the class ran, the RM was there and saw the teacher, but the
-- visit was a drop-off or an administrative errand and there was no staying to
-- watch a lesson.
--
-- Filing that under OTHER lost the distinction that matters when reading the
-- record back — whether a teacher went unobserved because there was nothing to
-- see, or because that visit was never about observing.

ALTER TYPE "ObservationSkipReason" ADD VALUE IF NOT EXISTS 'DID_NOT_STAY';
