# Architecture Decisions

Key decisions made during Phases 1 and 2. Do not reverse without understanding the reasoning.

---

## `prisma migrate deploy` (not `db push`) going forward

**Decision:** All schema changes from Phase 2 onward use proper migration files in `prisma/migrations/`.

**Why:** Phase 1 used `db push --accept-data-loss`. Phase 2 switched to explicit migration SQL files applied via `npx prisma migrate deploy`. The migration history now exists and is reliable. Do not use `db push` for schema changes anymore — write a migration file.

**Migrations applied:**
1. `20250316000000_add_calendar_visit_models` — original Phase 1 schema
2. `20260622000000_phase2_visitrule_drop_visitlog` — adds VisitRule fields, migrates VisitLog→Visit, drops VisitLog
3. `20260622000001_drop_school_frequency_target` — drops `School.frequencyTarget`

---

## Visit is the source of truth for visit history (VisitLog is gone)

**Decision:** `VisitLog` table was dropped in Phase 2. All visit history lives in `Visit` (status=DONE).

**Why:** `Visit` has richer status tracking (PLANNED/DONE/CANCELLED/SKIPPED), timestamps, and is already scoped to schools. `VisitLog` was a subset with no additional value. Migrated before dropping.

**Do not restore VisitLog** — if you need to add fields to visit records, add them to `Visit`.

---

## VisitRule is the source of truth for visit frequency

**Decision:** `School.frequencyTarget` column dropped. `VisitRule` (with `frequencyType`, `reason`, `effectiveFrom`, `effectiveTo`) is the single source of truth for how often each school should be visited.

**Active rule:** `effectiveTo IS NULL`. Creating a new rule auto-archives the previous one (sets `effectiveTo = now`).

**Default:** BIWEEKLY (14 days) when no VisitRule exists for a school.

**Do not restore `frequencyTarget`** — the column is gone from the DB.

---

## ClassSession gates scoring, not eligibility

**Decision:** A school in the RM's region that is overdue will appear in the planner regardless of whether a ClassSession is synced for that day. ClassSession provides precise times and a score bonus (+20) but is not required.

**Why:** Emilio needs to be able to visit for admin, paperwork, and catch-up even when no class is scheduled. The old behavior (ClassSession required) was a bug.

**Implementation:** `noClassWarning=true` on the ProposedVisit when no class exists. Displayed as a red inline badge in the planner card.

---

## planner constants hardcoded, Phase 3 will expose them

**Decision:** `DEFAULT_MAX_VISITS_PER_DAY = 4` and `DEFAULT_MAX_VISITS_PER_WEEK = 12` are module-level constants in `proposeVisits.ts`, not UI settings.

**Why:** Phase 3 will build a proper operational settings hub. For now these defaults cover Emilio's use case. The existing "Target Visits" dropdown in the planner header still overrides `maxVisitsPerWeek` via the options parameter.

**See:** `// TODO Phase 3: make configurable per RM in settings` comments in `proposeVisits.ts`.

---

## `src/proxy.ts` not `src/middleware.ts`

**Decision:** Route protection lives in `src/proxy.ts`.

**Why:** Next.js 16 changed the convention from `middleware.ts` to `proxy.ts`. Do not rename back.

---

## NextAuth JWT strategy (not database sessions)

**Decision:** `strategy: "jwt"` in `src/auth.ts`.

**Why:** No DB hit on every request. JWT contains `userId`, `role`, `regionId`, and `regionName`.

**Implication:** Role/region changes require sign-out and back in. Region name in the sidebar only appears after signing in after the auth.ts change was deployed.

---

## CalendarDay / A/B day logic: gone

**Decision:** Dropped in Phase 1. Do not restore.

**Why:** The A/B calendar required manual import from a PDF each year. Weekday-based rules (Monday/Tuesday/etc.) are simpler and sufficient.

---

## Admin region filter via URL param (`?region=<id>`)

**Decision:** Admin's selected region is stored in the URL and threaded as `regionFilter` prop to all child components.

**Why:** URL persistence — refreshing keeps the filter. All 4 data components independently re-fetch on `regionFilter` change.

---

## Named Prisma relations on User↔Region

**Decision:** Two named relations: `"UserRegion"` (User.region) and `"RegionManager"` (Region.manager).

**Why:** Prisma requires named relations when two FKs point to the same table. **Do not remove the relation names** — the schema won't compile.

---

## West region intentionally omitted

**Decision:** Only 4 regions: North, South, Central, East. Do not add West until explicitly requested.

---

## Zustand merge callback for stale-pin cleanup

**Decision:** `merge` callback in `plannerStore` persist config drops `manualOverrides` older than 14 days on hydration.

**Why:** Without this, old pinned overrides persist forever and cause stale scheduling. **Do not remove the merge callback.**
