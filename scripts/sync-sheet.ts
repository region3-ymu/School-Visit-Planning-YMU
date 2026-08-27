/**
 * Push every table in the app into the export spreadsheet.
 *
 *   npm run sync:sheet
 *
 * Needs GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY_BASE64 and SVP_SHEET_ID, and the
 * spreadsheet shared with the service account as an EDITOR (Viewer cannot
 * write, and Google's 403 does not say so).
 *
 * Each tab is cleared and rewritten, so this is an export of the current state
 * and not an append log: a deleted visit disappears instead of living on
 * forever in a sheet somebody is charting from.
 */
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { buildDataset } from "../src/lib/export/dataset";
import { getSheetId, getSheetsServiceAccount, listTabs, writeTab } from "../src/lib/google/sheets";

dotenv.config();
dotenv.config({ path: ".env.local" });

const prisma = new PrismaClient();

async function main() {
  const sa = getSheetsServiceAccount();
  const sheetId = getSheetId();
  console.log(`writing as ${sa.client_email}`);
  console.log(`spreadsheet ${sheetId}\n`);

  const tables = await buildDataset(prisma);
  const tabs = await listTabs(sa, sheetId);

  for (const table of tables) {
    // rows includes the header, so the count of records is one less.
    const records = Math.max(0, table.rows.length - 1);
    await writeTab(sa, sheetId, table.title, table.rows, tabs);
    console.log(`  ${table.title.padEnd(14)} ${String(records).padStart(5)} rows`);
  }

  // Last, so its timestamp is only written once everything else has landed.
  // A sheet that says when it was refreshed is the difference between "the data
  // is wrong" and "the data is from Tuesday".
  const now = new Date();
  await writeTab(
    sa,
    sheetId,
    "Sync info",
    [
      ["Last refreshed (UTC)", now.toISOString()],
      ["Written by", sa.client_email],
      ["Tables", tables.map((t) => t.title).join(", ")],
      ...tables.map((t) => [`Rows — ${t.title}`, Math.max(0, t.rows.length - 1)]),
    ],
    tabs
  );
  console.log(`  Sync info      written`);
  console.log(`\nDone: https://docs.google.com/spreadsheets/d/${sheetId}/edit`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
