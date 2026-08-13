import {
  GoogleCalendarClient,
  listAllCalendars,
  parseServiceAccount,
  type GoogleEventsPage,
} from "@/lib/google/calendar";

/**
 * Google Calendar access for the sync module.
 *
 * Backed by a service account (GOOGLE_SERVICE_ACCOUNT_KEY_BASE64) rather than
 * one person's OAuth refresh token: the calendars are ACL-shared with the
 * service account and subscribed to its calendarList, so it sees all of them
 * and there is no token to expire when someone changes their password.
 *
 * The `events.list(...) -> { data }` shape below deliberately mirrors the
 * googleapis client this replaced, so sync.ts did not have to change.
 */

function getServiceAccount() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!encoded) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 — base64 of the service-account JSON shared with the YMU calendars."
    );
  }
  return parseServiceAccount(encoded);
}

export type EventsListParams = {
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
  timeMin?: string;
  timeMax?: string;
  /** Accepted for call-site compatibility; the client always sets it. */
  singleEvents?: boolean;
};

export function getGoogleCalendarClient() {
  const client = new GoogleCalendarClient(getServiceAccount());
  return {
    events: {
      async list(params: EventsListParams): Promise<{ data: GoogleEventsPage }> {
        const data = await client.listEvents({
          calendarId: params.calendarId,
          syncToken: params.syncToken,
          pageToken: params.pageToken,
          timeMin: params.timeMin,
          timeMax: params.timeMax,
        });
        return { data };
      },
    },
  };
}

export type CalendarListEntry = {
  id: string;
  summary: string | null;
};

/**
 * List every calendar the service account is subscribed to, across all pages.
 */
export async function listCalendars(): Promise<CalendarListEntry[]> {
  const client = new GoogleCalendarClient(getServiceAccount());
  const entries = await listAllCalendars(client);
  return entries.map((entry) => ({
    id: entry.id,
    summary: entry.summary ?? null,
  }));
}
