import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Sends a visit's classroom observation to YMU-A, where the teacher sees it
 * under Evaluations (#56, Emilio Medrano, 2026-10-15).
 *
 * Only an observation counts: the visit was in person, the RM met the YMU
 * teacher, answered "Did you see a class?" with "Yes — I observed it", picked
 * which teacher, and rated or wrote something. Nothing else on the visit —
 * who else they met, principal notes, instrument requests, mileage — ever
 * leaves SVP. Anything that is not (or is no longer) such an observation is
 * sent as a delete, so editing a visit to a skip reason, or deleting it,
 * takes the evaluation back off the teacher's screen.
 *
 * Never throws: the visit is already saved, and a teacher's view catching up
 * a little later is better than an RM's save failing.
 */

const YMUA_URL = () => (process.env.YMUA_APP_URL ?? "https://ymu-a-navy.vercel.app").replace(/\/$/, "");

async function post(body: unknown): Promise<string | null> {
  const secret = process.env.APP_FEEDBACK_RELAY_SECRET;
  if (!secret) return "APP_FEEDBACK_RELAY_SECRET is not set.";
  try {
    const res = await fetch(`${YMUA_URL()}/api/teacher-evaluations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ymu-apps-secret": secret },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    return json?.error ?? `HTTP ${res.status}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function syncEvaluationToYmua(
  prisma: PrismaClient,
  visitId: string,
  options: { notify?: boolean } = {},
): Promise<{ sent: "upsert" | "delete"; error: string | null }> {
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: {
      school: { select: { externalId: true, name: true } },
      observedTeacher: { select: { externalId: true, name: true } },
      observedSubject: { select: { name: true } },
      visitedBy: { select: { name: true, email: true } },
    },
  });

  const ratings = visit
    ? {
        planning_prep: visit.obsPlanningPrep,
        culture_management: visit.obsCultureManagement,
        instruction_musicianship: visit.obsInstructionMusicianship,
        engagement_evidence: visit.obsEngagementEvidence,
        professionalism_growth: visit.obsProfessionalismGrowth,
      }
    : null;
  const isObservation =
    !!visit &&
    visit.status === "DONE" &&
    visit.mode === "IN_PERSON" &&
    visit.visitedWith.includes("YMU_TEACHER") &&
    visit.obsSkipReason === null &&
    !!visit.observedTeacher?.externalId &&
    (Object.values(ratings!).some(Boolean) || !!visit.obsNotes?.trim());

  if (!isObservation) {
    const error = await post({ action: "delete", svp_visit_id: visitId });
    if (error) console.error(`evaluation delete ${visitId}:`, error);
    return { sent: "delete", error };
  }

  const error = await post({
    action: "upsert",
    notify: options.notify !== false,
    evaluation: {
      svp_visit_id: visit.id,
      teacher_id: visit.observedTeacher!.externalId,
      school_id: visit.school?.externalId ?? null,
      school_name: visit.school?.name ?? null,
      class_name: visit.observedSubject?.name ?? null,
      observed_at: visit.plannedStartDateTime.toISOString(),
      evaluator_name: visit.visitedBy?.name ?? null,
      evaluator_email: visit.visitedBy?.email ?? null,
      ...ratings,
      notes: visit.obsNotes?.trim() || null,
    },
  });
  if (error) console.error(`evaluation upsert ${visitId}:`, error);
  return { sent: "upsert", error };
}
