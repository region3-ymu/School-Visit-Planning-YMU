import "server-only";
import type { Role } from "@prisma/client";

/**
 * Sends a report to YMU-A's backlog, which is where both apps' reports live.
 *
 * One backlog, not two. YMU triages from a single inbox and a single tracker
 * spreadsheet; a second queue over here would be a second place to forget to
 * look, and the report that started all of this sat unread for a month in the
 * one queue that did exist.
 *
 * It posts to a narrow relay route guarded by a shared secret, NOT with
 * YMU-A's service-role key. That key bypasses every RLS policy on a database
 * holding attendance records for minors; the route can do exactly one thing.
 */

const YMUA_URL = (process.env.YMUA_APP_URL ?? "https://ymu-a-navy.vercel.app").replace(/\/$/, "");

/**
 * SVP's roles onto YMU-A's `app_role`, which is what its table stores.
 *
 * MENTOR and INTERVENTIONIST have no counterpart over there, and inventing
 * one would put a job title on the report that the person does not hold. They
 * fall back to the least load-bearing value, and `svp_role` below carries the
 * real one, so nothing is lost even where the enum cannot say it.
 */
const ROLE_MAP: Record<Role, string> = {
  REGIONAL_MANAGER: "regional_manager",
  AFTER_SCHOOL_MANAGER: "afterschool_manager",
  OPERATIONS_MANAGER: "operations_manager",
  ACADEMIC_MANAGER: "academic_manager",
  CPO: "cpo",
  ADMIN: "administrator",
  MENTOR: "teacher",
  INTERVENTIONIST: "teacher",
};

export type RelayInput = {
  email: string;
  name: string | null;
  role: Role;
  kind: "bug" | "request" | "question";
  severity: "blocked" | "hindered" | "cosmetic" | null;
  message: string;
  pagePath: string;
  userAgent: string | null;
  viewport: string | null;
};

export type RelayResult = { ok: true; reportNumber: number | null } | { ok: false; error: string };

export async function relayReport(input: RelayInput): Promise<RelayResult> {
  const secret = process.env.APP_FEEDBACK_RELAY_SECRET;
  if (!secret) {
    // Named plainly rather than swallowed: a report that silently goes
    // nowhere is worse than a button that admits it is not wired up.
    return {
      ok: false,
      error: "Reporting isn't configured on this server yet. Tell an admin — APP_FEEDBACK_RELAY_SECRET is missing.",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${YMUA_URL}/api/app-feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-feedback-secret": secret },
      body: JSON.stringify({
        app: "svp",
        reporter_email: input.email,
        reporter_name: input.name,
        reporter_role: ROLE_MAP[input.role] ?? "teacher",
        page_path: input.pagePath,
        message: input.message,
        kind: input.kind,
        severity: input.severity,
        device_info: {
          userAgent: input.userAgent,
          viewport: input.viewport,
          // The role SVP actually knows them by, since ROLE_MAP above has to
          // flatten two of them.
          svp_role: input.role,
        },
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Couldn't reach YMU-A to file the report. Try again in a moment." };
  }

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; report_number?: number; error?: string }
    | null;

  if (!response.ok || !body?.ok) {
    return { ok: false, error: body?.error ?? `The report was rejected (HTTP ${response.status}).` };
  }
  return { ok: true, reportNumber: body.report_number ?? null };
}
