"use server";

import { auth } from "@/auth";
import { relayReport } from "@/lib/report/relay";

export type ReportState = { ok: true; reportNumber: number | null } | { ok: false; error: string } | undefined;

const KINDS = new Set(["bug", "request", "question"]);
const SEVERITIES = new Set(["blocked", "hindered", "cosmetic"]);

export async function submitReport(_previous: ReportState, formData: FormData): Promise<ReportState> {
  const session = await auth();
  const user = session?.user;
  if (!user?.email) return { ok: false, error: "Sign in again — your session has expired." };

  const message = String(formData.get("message") ?? "").trim();
  if (message.length < 10) {
    return { ok: false, error: "Say a little more about what happened — at least a sentence." };
  }

  const kind = String(formData.get("kind") ?? "bug");
  if (!KINDS.has(kind)) return { ok: false, error: "Pick what kind of report this is." };

  const severityRaw = String(formData.get("severity") ?? "");
  const severity = SEVERITIES.has(severityRaw) ? severityRaw : null;

  return relayReport({
    email: user.email,
    name: user.name ?? null,
    // The reporter cannot choose their own role: it is a fact about them, and
    // the report is read by whoever has to decide whether it blocks someone.
    role: user.role!,
    kind: kind as "bug" | "request" | "question",
    severity: severity as "blocked" | "hindered" | "cosmetic" | null,
    message,
    pagePath: String(formData.get("page_path") ?? "/"),
    userAgent: String(formData.get("user_agent") ?? "") || null,
    viewport: String(formData.get("viewport") ?? "") || null,
  });
}
