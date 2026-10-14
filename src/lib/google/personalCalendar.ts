import "server-only";
import { getGoogleAccessToken, parseServiceAccount, GoogleCalendarError } from "./calendar";

/**
 * Writes a Regional Manager's planned visits into THEIR OWN Google Calendar
 * (FR-043, Eric Levy: "after you plan the visits on the Weekly Planner, export
 * them to your Google Calendar").
 *
 * Done as the YMU calendar service account acting as the user — domain-wide
 * delegation — rather than asking every RM to grant SVP access to their
 * calendar one by one. One authorisation by a Workspace super admin covers
 * every RM, and the same grant is what mentors' calendars and the school
 * calendars (substitutions) need, so it is asked for once.
 *
 * Until that grant exists Google refuses the token with 401
 * unauthorized_client, and the caller says so in plain words. Nothing here
 * can reach anybody's calendar but the signed-in user's own: the address
 * impersonated comes from the session, never from the request.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TIME_ZONE = "America/New_York";

/** Marks the events this app owns, so a re-send only ever touches its own. */
const APP_TAG = "ymu-visit-planner";

export type CalendarVisit = {
  /** schoolId|dayKey|startTime — the identity of a visit across re-sends. */
  key: string;
  dayKey: string; // yyyy-MM-dd, Miami
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  summary: string;
  location: string | null;
  description: string;
};

export type SendResult =
  | { ok: true; created: number; updated: number; removed: number }
  | { ok: false; error: string };

type ExistingEvent = { id: string; extendedProperties?: { private?: Record<string, string> } };

export class CalendarNotAuthorisedError extends Error {}

async function tokenFor(email: string): Promise<string> {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!encoded) throw new Error("Google Calendar isn't configured on this server (no service account).");
  try {
    return await getGoogleAccessToken(parseServiceAccount(encoded), SCOPE, email);
  } catch (e) {
    // 401 unauthorized_client: the service account has not been granted
    // domain-wide delegation for this scope. Not the user's fault, and not
    // something a retry fixes.
    if (e instanceof GoogleCalendarError && (e.status === 401 || e.status === 403)) {
      throw new CalendarNotAuthorisedError(
        "YMU's Google Workspace hasn't allowed the Visit Planner to add events to calendars yet. " +
          "Ask the Workspace admin to authorise it (domain-wide delegation, Calendar events scope).",
      );
    }
    throw e;
  }
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const body = await response.text().catch(() => "");
    throw new GoogleCalendarError(`Google Calendar request failed (${response.status}).`, response.status, body);
  }
  return response;
}

function eventBody(visit: CalendarVisit, weekKey: string) {
  return {
    summary: visit.summary,
    location: visit.location ?? undefined,
    description: visit.description,
    start: { dateTime: `${visit.dayKey}T${visit.startTime}:00`, timeZone: TIME_ZONE },
    end: { dateTime: `${visit.dayKey}T${visit.endTime}:00`, timeZone: TIME_ZONE },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
    extendedProperties: { private: { app: APP_TAG, week: weekKey, key: visit.key } },
  };
}

/**
 * Makes the user's calendar match `visits` for the week starting `weekKey`:
 * new visits are added, ones already sent are updated in place, and ones
 * sent before but no longer in the plan are removed. Only events this app
 * created for that week are ever read, changed or deleted.
 *
 * `removeWithinDays` bounds the removal (FR-043 follow-up: export a whole
 * week, one day, or one visit). The week passes every day; one day passes
 * just that day, so Tuesday's events are never touched by sending Monday;
 * one visit passes an empty set, which only ever adds or updates.
 */
export async function syncWeekToCalendar(
  email: string,
  weekKey: string,
  visits: CalendarVisit[],
  removeWithinDays: ReadonlySet<string>,
): Promise<SendResult> {
  let token: string;
  try {
    token = await tokenFor(email);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Google Calendar." };
  }

  try {
    const existing: ExistingEvent[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ maxResults: "250", showDeleted: "false" });
      params.append("privateExtendedProperty", `app=${APP_TAG}`);
      params.append("privateExtendedProperty", `week=${weekKey}`);
      if (pageToken) params.set("pageToken", pageToken);
      const page = (await (await call(token, `${API}?${params}`)).json()) as {
        items?: ExistingEvent[];
        nextPageToken?: string;
      };
      existing.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    const byKey = new Map(existing.map((e) => [e.extendedProperties?.private?.key ?? "", e]));
    let created = 0;
    let updated = 0;
    let removed = 0;

    for (const visit of visits) {
      const match = byKey.get(visit.key);
      if (match) {
        await call(token, `${API}/${encodeURIComponent(match.id)}`, {
          method: "PATCH",
          body: JSON.stringify(eventBody(visit, weekKey)),
        });
        byKey.delete(visit.key);
        updated += 1;
      } else {
        await call(token, API, { method: "POST", body: JSON.stringify(eventBody(visit, weekKey)) });
        created += 1;
      }
    }

    // Whatever is left was sent before and is no longer planned — within the
    // days this send is about. The key is schoolId|dayKey|startTime.
    for (const [key, stale] of byKey) {
      if (!removeWithinDays.has(key.split("|")[1] ?? "")) continue;
      await call(token, `${API}/${encodeURIComponent(stale.id)}`, { method: "DELETE" });
      removed += 1;
    }

    return { ok: true, created, updated, removed };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof GoogleCalendarError
          ? `Google Calendar refused the change (${e.status}). Nothing after that point was sent.`
          : "Couldn't reach Google Calendar. Try again in a moment.",
    };
  }
}
