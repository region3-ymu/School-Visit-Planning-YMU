/**
 * Test script for calendar sync. Do NOT use in production.
 * Requires .env or .env.local: DATABASE_URL, GOOGLE_CALENDAR_* (client id, secret, refresh token)
 *
 * Run: npm run sync-calendars:test
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import {
  syncAllSchoolCalendars,
  getDefaultSyncRange,
} from "../src/modules/calendarSync";

// Load .env first, then .env.local so local overrides (and has Google credentials)
dotenv.config();
dotenv.config({ path: ".env.local" });

async function main() {
  const prisma = new PrismaClient();
  const { start, end } = getDefaultSyncRange();
  console.log("Sync range:", start.toISOString(), "->", end.toISOString());

  if (!process.env.GOOGLE_CALENDAR_REFRESH_TOKEN) {
    console.error("Missing GOOGLE_CALENDAR_REFRESH_TOKEN in .env or .env.local");
    process.exit(1);
  }
  console.log("Listing calendars from Google...");
  const result = await syncAllSchoolCalendars(prisma, start, end, {
    createSchoolIfMissing: false,
  });
  console.log("Result:", JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
