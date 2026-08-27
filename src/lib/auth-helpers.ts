import { Session } from "next-auth";
import { Role } from "@prisma/client";
import { seesAllRegions } from "@/lib/permissions";

type SessionUser = Session["user"];

export function requireUser(
  session: Session | null,
  roles?: Role[]
): SessionUser {
  if (!session?.user?.email) throw new Error("Unauthorized");
  if (roles && !roles.includes(session.user.role)) {
    throw new Error("Forbidden");
  }
  return session.user;
}

/**
 * Returns the effective regionId for scoping queries, or undefined for "no filter".
 *
 * Prisma treats { regionId: null } as WHERE regionId IS NULL, not as "no filter".
 * This helper normalises null → undefined so callers never accidentally scope to
 * the 11 un-assigned seed schools instead of the user's real region.
 *
 * Rules:
 *   sees all regions       → undefined  (see everything)
 *   RM / MENTOR with region → user.regionId  (see own region)
 *   any role, no region    → undefined  (no accidental IS-NULL filter)
 *
 * "Sees all regions" is asked of src/lib/permissions.ts rather than compared
 * against ADMIN here: the oversight roles and the Afterschool Manager all see
 * every region too, and this helper is the one place that decides it for every
 * School query in the app.
 */
export function scopeToRegion(user: SessionUser): string | undefined {
  if (seesAllRegions(user.role)) return undefined;
  return user.regionId ?? undefined;
}

/** Prisma `where` extension for direct School queries. Admins see all. */
export function schoolRegionWhere(
  user: SessionUser
): { regionId?: string } {
  const regionId = scopeToRegion(user);
  return regionId !== undefined ? { regionId } : {};
}

/** Prisma `where` extension for queries on Visit/VisitLog/etc that join through school. */
export function viaSchoolRegionWhere(
  user: SessionUser
): { school?: { regionId: string } } {
  const regionId = scopeToRegion(user);
  return regionId !== undefined ? { school: { regionId } } : {};
}
