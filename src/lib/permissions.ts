import type { Role } from "@prisma/client";

/**
 * Who can do what, in one place.
 *
 * Before this, "can they?" was answered by `user.role === "ADMIN"` written out
 * fifteen times across actions.ts, two API routes and the nav. That works while
 * there are two kinds of user and stops working the moment there are seven: the
 * question is never really "are they an admin", it is "do they see every region"
 * or "are they allowed to change this", and those are different questions that
 * happened to have the same answer.
 *
 * YMU-A learned the same lesson the expensive way — twenty-one RLS policies each
 * naming the global roles by hand, which had drifted so that "sees everything"
 * meant different things on different tables (its migration 0072). One function
 * per question, and every caller asks it.
 */

/**
 * Oversight: the CPO, Operations, Academic Manager and the app Admin.
 *
 * They read the whole organisation and plan none of it. Three of them are the
 * same permission set under three names because that is the org chart; kept as
 * distinct roles so a report can say whose login it was.
 */
export const OVERSIGHT_ROLES: Role[] = ["ADMIN", "CPO", "OPERATIONS_MANAGER", "ACADEMIC_MANAGER"];

/** The roles that actually go out and visit schools. */
export const FIELD_ROLES: Role[] = ["REGIONAL_MANAGER", "AFTER_SCHOOL_MANAGER"];

/**
 * Sees every region rather than just their own.
 *
 * AFTER_SCHOOL_MANAGER is in here and is NOT oversight: they run afterschool
 * programmes in every region, so they need the whole map and they do their own
 * planning. That is why the role exists instead of a regional manager with a
 * null region — null means "not assigned yet", and a query cannot tell the two
 * apart.
 */
export function seesAllRegions(role: Role): boolean {
  return OVERSIGHT_ROLES.includes(role) || role === "AFTER_SCHOOL_MANAGER";
}

/** Reads the region filter on the dashboard, history and reports. */
export function canFilterByRegion(role: Role): boolean {
  return seesAllRegions(role);
}

/**
 * Plans and records visits: the weekly planner, the zone map, confirming a
 * visit, logging one by hand, reordering a day.
 *
 * Oversight roles are deliberately excluded. They can see every plan and every
 * visit; what they must not do is change somebody else's week — a CPO
 * confirming a visit they did not make would put miles on an RM's
 * reimbursement.
 */
export function canPlanVisits(role: Role): boolean {
  return FIELD_ROLES.includes(role);
}

/**
 * The parts of a user these checks need. Taking an object rather than a bare
 * role because administering the app is a flag on the person, not a job title —
 * YMU's CPO administers it and the app still has to call him the CPO.
 */
export type Principal = { role: Role; isAppAdmin?: boolean | null };

/** Administers the app: calendar sync, accounts, correcting other people's records. */
export function canAdministerApp(user: Principal): boolean {
  return Boolean(user.isAppAdmin) || user.role === "ADMIN";
}

/**
 * Edits school-level records: teachers and visit rules.
 *
 * An app administrator is included because keeping the roster right is
 * administration, not planning. The other oversight roles are not.
 */
export function canManageSchoolData(user: Principal): boolean {
  return canPlanVisits(user.role) || canAdministerApp(user);
}

/**
 * Corrects or deletes a visit somebody else recorded.
 *
 * Administrators only, and it is not the same permission as planning: fixing a
 * visit logged against the wrong school is the job, creating one is not.
 */
export function canEditOthersVisits(user: Principal): boolean {
  return canAdministerApp(user);
}

/** Sees other people's mileage, not only their own. */
export function canSeeOthersReports(role: Role): boolean {
  return seesAllRegions(role) || role === "REGIONAL_MANAGER";
}

/**
 * Which programmes this role plans and reports on.
 *
 * The Afterschool Manager owns every afterschool class in every region and
 * nothing else, so their whole job is the set of classes the app was dropping.
 * Everyone else plans the school day, which is the behaviour that was hardcoded
 * in three places before this.
 */
export function programmeScopeFor(role: Role): "exclude-afterschool" | "only-afterschool" {
  return role === "AFTER_SCHOOL_MANAGER" ? "only-afterschool" : "exclude-afterschool";
}

/**
 * The working day a plan is built against, or undefined for the app default
 * (PLANNER_WORK_START/END, 08:00–17:00).
 *
 * The planner only proposes a class that fits ENTIRELY inside this window, and
 * the afterschool programme at Norland runs 16:00–18:00 Miami — an hour past
 * the default end. That alone made the Afterschool Manager's plan come back
 * empty even after the programme filter was fixed: every class it was looking
 * for was out of hours by definition, which is what "afterschool" means.
 */
export function workWindowFor(role: Role): { start: string; end: string } | undefined {
  // 19:30, from the data rather than a guess: across YMU-A's 3,908 afterschool
  // events the latest any class ends is 18:30 (Little River), and the planner
  // only proposes a class that fits ENTIRELY inside the window — so an end of
  // 17:00 or even 18:00 silently drops the longest programmes. The margin
  // costs nothing: widening this role's day cannot pull a school-hours class
  // into their plan, because the programme filter already decided that.
  if (role === "AFTER_SCHOOL_MANAGER") return { start: "08:00", end: "19:30" };
  return undefined;
}

export const TAB_IDS = ["dashboard", "planner", "history", "profiles", "map", "reports"] as const;
export type TabId = (typeof TAB_IDS)[number];

/**
 * The tabs a role gets, in the order they appear.
 *
 * Oversight roles have no Weekly Planner and no Zone Map. That is YMU's own
 * call (2026-08-31): those two screens exist to decide and drive somebody's
 * week, and nobody who is not driving it should be in there. What they need
 * instead is Visit History — the report — and mileage, so those come first.
 */
export function tabsForRole(role: Role): TabId[] {
  if (canPlanVisits(role)) {
    return ["dashboard", "planner", "history", "profiles", "map", "reports"];
  }
  if (OVERSIGHT_ROLES.includes(role)) {
    return ["dashboard", "history", "reports", "profiles"];
  }
  // MENTOR / INTERVENTIONIST: read the schools they work with and their own
  // history. Both are stubs with no workflow of their own yet.
  return ["dashboard", "history", "profiles"];
}

/** Human labels, for the account list and for telling somebody what they are. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "App Administrator",
  REGIONAL_MANAGER: "Regional Manager",
  AFTER_SCHOOL_MANAGER: "Afterschool Manager",
  CPO: "Chief Program Officer",
  OPERATIONS_MANAGER: "Operations Manager",
  ACADEMIC_MANAGER: "Academic Manager",
  MENTOR: "Mentor",
  INTERVENTIONIST: "Interventionist",
};
