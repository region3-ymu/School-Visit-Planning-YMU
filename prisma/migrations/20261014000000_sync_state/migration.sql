-- Where a background sync left off (#53): the cursor into YMU-A's class
-- feed, which replaced reading every school calendar from Google once a day.
CREATE TABLE "SyncState" (
    "key" TEXT NOT NULL,
    "cursor" TEXT,
    "windowEnd" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("key")
);
