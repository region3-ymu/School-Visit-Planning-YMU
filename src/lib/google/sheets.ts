import {
  getGoogleAccessToken,
  parseServiceAccount,
  type GoogleServiceAccount,
} from "./calendar";

/**
 * Writing the app's data into a Google Sheet.
 *
 * The Academic Manager builds their own dashboards, and asking them to export a
 * CSV by hand every time is how a dashboard goes stale. Same approach YMU-A
 * takes with its feedback sheet, and the same service-account mechanics — but
 * pointed at its own account, for a reason worth writing down:
 *
 * SVP uses TWO service accounts, and not by accident. Reading the 109 school
 * calendars needs an identity that has been ACL-shared onto every one of them,
 * which is an existing account YMU already set up; sharing a fresh one onto 109
 * calendars is 109 manual operations because Google Calendar has no bulk share.
 * Writing this spreadsheet needs an identity shared onto exactly one file. So
 * the read path keeps the established account and the write path — the one that
 * can actually change something — gets its own, which is where an audit trail
 * and a separate quota are worth having.
 *
 * GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY_BASE64 is therefore the one this file
 * wants. It falls back to GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 so a single-account
 * setup still works, which is the right default for anyone standing this up
 * fresh.
 */

// Narrowest scope that can write cells. drive.file would also work but grants
// access to every file the account creates, which is broader than one sheet.
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export type SheetCell = string | number | boolean | null;

export function getSheetsServiceAccount(): GoogleServiceAccount {
  const encoded =
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY_BASE64 ??
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!encoded) {
    throw new Error(
      "Missing GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY_BASE64 (or GOOGLE_SERVICE_ACCOUNT_KEY_BASE64) — " +
        "base64 of the service-account JSON, with the spreadsheet shared to it as an Editor."
    );
  }
  return parseServiceAccount(encoded);
}

export function getSheetId(): string {
  const id = process.env.SVP_SHEET_ID;
  if (!id) {
    throw new Error(
      "Missing SVP_SHEET_ID — the part of the spreadsheet URL between /d/ and /edit."
    );
  }
  return id;
}

/**
 * A 403 from Sheets has two very different causes and Google's own message is
 * the only way to tell them apart. Guessing "not shared" when the API is simply
 * switched off sends whoever is debugging to the wrong console page. Lifted
 * from YMU-A, which learned it the hard way.
 */
function describe403(body: string, clientEmail: string): string {
  return body.includes("SERVICE_DISABLED") || body.includes("has not been used in project")
    ? "The Google Sheets API is not enabled on the service account's Cloud project. " +
        "Enable it at console.cloud.google.com → APIs & Services → Library → \"Google Sheets API\", then retry."
    : `Google refused access (403). Share the spreadsheet with ${clientEmail} as an Editor.`;
}

/**
 * fetch with the retry Google's own docs ask for.
 *
 * The write quota is 60 requests per minute per user, and a service account is
 * one user — a full export is one request per tab, so a big export can brush
 * against it. 429 and 5xx are retried with exponential backoff plus jitter; 4xx
 * other than 429 is not, because a bad range or a missing tab fails identically
 * however long you wait.
 */
async function sheetsFetch(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const response = await fetch(url, init);
  const retryable = response.status === 429 || response.status >= 500;
  if (!retryable || attempt >= 4) return response;
  const waitMs = 2 ** attempt * 1000 + Math.floor(Math.random() * 250);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return sheetsFetch(url, init, attempt + 1);
}

async function call(
  sa: GoogleServiceAccount,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const token = await getGoogleAccessToken(sa, SHEETS_SCOPE);
  const response = await sheetsFetch(`${SHEETS_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      response.status === 403
        ? describe403(body, sa.client_email)
        : `Sheets API ${response.status}: ${body.slice(0, 300)}`
    );
  }
  return response.json();
}

/** The tabs a spreadsheet already has, by title. */
export async function listTabs(sa: GoogleServiceAccount, sheetId: string): Promise<Set<string>> {
  const meta = (await call(sa, `/${sheetId}?fields=sheets.properties.title`)) as {
    sheets?: { properties: { title: string } }[];
  };
  return new Set((meta.sheets ?? []).map((s) => s.properties.title));
}

/**
 * Replace one tab's contents with `rows`, creating the tab if it is missing.
 *
 * Cleared before writing rather than appended to: this is an export of the
 * current state, so a row that no longer exists must disappear. Appending would
 * accumulate every deleted visit forever and quietly double the data on the
 * second run.
 */
export async function writeTab(
  sa: GoogleServiceAccount,
  sheetId: string,
  title: string,
  rows: SheetCell[][],
  existingTabs?: Set<string>
): Promise<void> {
  const tabs = existingTabs ?? (await listTabs(sa, sheetId));
  if (!tabs.has(title)) {
    await call(sa, `/${sheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    });
    tabs.add(title);
  }

  // Quoted because a tab title with a space is otherwise read as a range.
  const range = `'${title}'`;
  await call(sa, `/${sheetId}/values/${encodeURIComponent(range)}:clear`, { method: "POST" });

  if (rows.length === 0) return;
  await call(
    sa,
    `/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: rows }) }
  );
}
