import { google } from "googleapis";

/**
 * Creates an authenticated Google Calendar API client using OAuth2 refresh token.
 * Requires in .env: GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN
 */
export function getGoogleCalendarClient() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google Calendar env: GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN"
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "https://developers.google.com/oauthplayground" // redirect not used when only refresh_token
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

export type CalendarListEntry = {
  id: string;
  summary: string | null;
};

/**
 * List all calendars the authenticated account can see.
 */
export async function listCalendars(): Promise<CalendarListEntry[]> {
  const calendar = getGoogleCalendarClient();
  const res = await calendar.calendarList.list();
  const items = res.data.items ?? [];
  return items.map((item) => ({
    id: item.id!,
    summary: item.summary ?? null,
  }));
}
