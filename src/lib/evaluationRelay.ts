import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Sends a visit's classroom observations to YMU-A, where each teacher sees
 * their own under Evaluations (#56, Emilio Medrano, 2026-10-15).
 *
 * ONE REQUEST PER VISIT, carrying the visit's whole list. A visit can watch
 * more than one class — two run at the same time in the same building at
 * Carol City MS and North Dade (Eric Levy, 2026-10-15) — and each class is its
 * own evaluation, for its own teacher, keyed by the observation's id. Sending
 * the list as one "replace_visit" lets YMU-A make its rows for this visit
 * exactly this list: an observation dropped in an edit disappears from that
 * teacher's screen in the same step the others are updated, with no window in
 * which a stale one lingers and no per-row deletes to get out of order. An
 * empty list is how a deleted visit, or one edited to a skip reason, takes
 * every evaluation it had back off the teachers' screens.
 *
 * Only an observation counts: the visit was in person, the RM met the YMU
 * teacher, answered "Did you see a class?" with "Yes — I observed it", the
 * class names a teacher YMU-A knows, and the RM rated or wrote something.
 * Nothing else on the visit — who else they met, principal notes, instrument
 * requests, mileage — ever leaves SVP, and no teacher is sent another
 * teacher's ratings: each evaluation carries one observation and one teacher.
 *
 * Observations migrated from the old single-observation columns kept their
 * visit's id, which is the key YMU-A filed them under before, so the first
 * replace after the migration updates those rows instead of duplicating them.
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
): Promise<{ sent: number; error: string | null }> {
  let evaluations: Record<string, unknown>[] = [];
  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        school: { select: { externalId: true, name: true } },
        visitedBy: { select: { name: true, email: true } },
        observations: {
          include: {
            teacher: { select: { externalId: true } },
            subject: { select: { name: true } },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });

    // The visit-level conditions: anything short of these and the visit holds
    // no evaluation at all, whatever rows it carries (a migrated programme on a
    // visit that never met the teacher, say).
    const isObservationVisit =
      !!visit &&
      visit.status === "DONE" &&
      visit.mode === "IN_PERSON" &&
      visit.visitedWith.includes("YMU_TEACHER") &&
      visit.obsSkipReason === null;

    if (visit && isObservationVisit) {
      evaluations = visit.observations.flatMap((obs) => {
        const ratings = {
          planning_prep: obs.obsPlanningPrep,
          culture_management: obs.obsCultureManagement,
          instruction_musicianship: obs.obsInstructionMusicianship,
          engagement_evidence: obs.obsEngagementEvidence,
          professionalism_growth: obs.obsProfessionalismGrowth,
        };
        const notes = obs.notes?.trim() || null;
        // A class with nobody YMU-A knows on it has no one to show it to, and
        // a ticked box with nothing rated or written is not an evaluation.
        if (!obs.teacher?.externalId) return [];
        if (!Object.values(ratings).some(Boolean) && !notes) return [];
        return [
          {
            svp_observation_id: obs.id,
            teacher_id: obs.teacher.externalId,
            school_id: visit.school?.externalId ?? null,
            school_name: visit.school?.name ?? null,
            class_name: obs.subject?.name ?? null,
            observed_at: visit.plannedStartDateTime.toISOString(),
            evaluator_name: visit.visitedBy?.name ?? null,
            evaluator_email: visit.visitedBy?.email ?? null,
            ...ratings,
            notes,
          },
        ];
      });
    }
  } catch (err) {
    // Reading the visit failed, so what YMU-A should hold is unknown. Sending
    // an empty list here would wipe evaluations that are still true; better to
    // leave them and let the next save of this visit put things right.
    const error = err instanceof Error ? err.message : String(err);
    console.error(`evaluation replace ${visitId} (read):`, error);
    return { sent: 0, error };
  }

  const error = await post({
    action: "replace_visit",
    svp_visit_id: visitId,
    notify: options.notify !== false,
    evaluations,
  });
  if (error) console.error(`evaluation replace ${visitId}:`, error);
  return { sent: evaluations.length, error };
}
