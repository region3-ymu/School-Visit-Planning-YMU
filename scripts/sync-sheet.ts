/**
 * Push every table in the app into the export spreadsheet.
 *
 *   npm run sync:sheet
 *
 * Needs GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY_BASE64 and SVP_SHEET_ID, and the
 * spreadsheet shared with the service account as an EDITOR (Viewer cannot
 * write, and Google's 403 does not say so).
 *
 * Runs automatically too, once a day via /api/cron/sync-sheet — this script
 * and that route both call the same syncDatasetToSheet, so a manual run for
 * "I need it right now" and the cron never disagree about what a sync does.
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { syncDatasetToSheet } from "../src/lib/export/syncSheet";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

async function main() {
  const result = await syncDatasetToSheet(prisma);
  console.log(`spreadsheet ${result.sheetId}\n`);
  for (const t of result.tables) {
    console.log(`  ${t.title.padEnd(14)} ${String(t.rows).padStart(5)} rows`);
  }
  console.log(`  Sync info      written`);
  console.log(`\nDone: https://docs.google.com/spreadsheets/d/${result.sheetId}/edit`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
