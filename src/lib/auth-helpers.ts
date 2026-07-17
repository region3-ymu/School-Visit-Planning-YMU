import { Session } from "next-auth";
import { Role } from "@prisma/client";

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
 *   ADMIN                  → undefined  (see everything)
 *   RM / MENTOR with region → user.regionId  (see own region)
 *   any role, no region    → undefined  (no accidental IS-NULL filter)
 */
export function scopeToRegion(user: SessionUser): string | undefined {
  if (user.role === "ADMIN") return undefined;
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
