import type { PrismaClient } from "@prisma/client";
import { buildDataset } from "./dataset";
import { getSheetId, getSheetsServiceAccount, listTabs, writeTab } from "@/lib/google/sheets";

export type SheetSyncResult = {
  sheetId: string;
  tables: { title: string; rows: number }[];
};

/**
 * Push every table in the app into the export spreadsheet — the same work
 * `npm run sync:sheet` does by hand, shared so the daily cron
 * (/api/cron/sync-sheet) can call it too.
 *
 * Each tab is cleared and rewritten, so this is an export of the current
 * state and not an append log: a deleted visit disappears instead of living
 * on forever in a sheet somebody is charting from.
 */
export async function syncDatasetToSheet(prisma: PrismaClient): Promise<SheetSyncResult> {
  const sa = getSheetsServiceAccount();
  const sheetId = getSheetId();
  const tables = await buildDataset(prisma);
  const tabs = await listTabs(sa, sheetId);

  const written: { title: string; rows: number }[] = [];
  for (const table of tables) {
    // rows includes the header, so the count of records is one less.
    const records = Math.max(0, table.rows.length - 1);
    await writeTab(sa, sheetId, table.title, table.rows, tabs);
    written.push({ title: table.title, rows: records });
  }

  // Last, so its timestamp is only written once everything else has landed.
  // A sheet that says when it was refreshed is the difference between "the
  // data is wrong" and "the data is from Tuesday".
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

  return { sheetId, tables: written };
}
