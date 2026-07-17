# AI Handoff — Phase 2 Planner Consolidation

**Status: Phase 2 COMPLETE.** Build passes (`next build` clean, `tsc --noEmit` clean), DB migrations applied.

---

## What Was Built (Phase 2)

### Single Planner
Collapsed three parallel planners (legacy `scoringEngine`, `generatePlanWithNewArchitecture`, `proposeVisitsForWeek`) into one. `src/modules/visitPlanner/proposeVisits.ts` is now the only planner.

**Key contract change:** ClassSession existence is no longer required for eligibility. A school in the RM's region that is overdue will appear in the planner every weekday, with or without a Google Calendar class synced. If no class exists on that day, the card shows a red warning ("No class scheduled — admin / catch-up visit") and defaults to 09:00–10:00.

**Scoring:** base score = overdue-ness. Class session on that day adds +20 points and provides the actual class time.

**Constants hardcoded in `proposeVisits.ts` (Phase 3 will make configurable):**
```ts
// TODO Phase 3: make configurable per RM in settings
const DEFAULT_MAX_VISITS_PER_DAY = 4;
const DEFAULT_MAX_VISITS_PER_WEEK = 12;
```

### VisitLog → Visit Migration
`VisitLog` table dropped. `Visit` is now the single source of truth for all visit history. All existing VisitLog rows were migrated to Visit (status=DONE) before the table was dropped. `getVisitHistory`, `getDashboardStats`, `confirmVisit`, `addManualVisit`, `deleteVisitLog`, `editVisitLog` all now operate on `Visit`.

### VisitRule Schema + UI
`VisitRule` gained three fields: `reason String?`, `effectiveFrom DateTime?`, `effectiveTo DateTime?`.

- Active rule = `effectiveTo IS NULL`. Creating a new rule auto-archives the previous one.
- Default frequency when no rule exists: BIWEEKLY (14 days).
- UI at `/schools/[id]/visit-rules` is fully built — form with frequency picker, reason text, effective date. Shows active and past rules. Server actions: `createVisitRule`, `updateVisitRule`, `archiveVisitRule` (all Zod-validated).

### Planner UI
- **Frequency badge** on each planner card (red=WEEKLY, grey=BIWEEKLY, green=EVERY_3_WEEKS, blue=MONTHLY).
- **Red no-class warning** when `noClassWarning=true`.
- **"Visit anyway"** affordance: when a school has no class options in the Add modal, shows a Mon–Fri day picker for a catch-up visit at 09:00.

### School Directory Cleanup
- `School.frequencyTarget` column dropped from DB (migration applied). `VisitRule` is the source of truth.
- "Edit Settings" modal removed from SchoolProfiles. "Visit Rules" link added to each card pointing to `/schools/[id]/visit-rules`.
- `updateSchoolSettings` server action deleted.

### Session: Region Name in JWT
`auth.ts` now fetches `region.name` at sign-in and stores it as `token.regionName`. Sidebar shows the actual region name (e.g. "Central") for RM users instead of the user's display name.

---

## Files Changed (Phase 2)

| File | What |
|---|---|
| `src/modules/visitPlanner/proposeVisits.ts` | Full rewrite — new contract (see contract comment at top of file) |
| `src/modules/visitPlanner/types.ts` | Added `noClassWarning`, `visitRuleFrequency`, `visitRuleNote` to `ProposedVisit`; added `regionId` to options |
| `src/lib/types.ts` | Same 3 fields added to `VisitInfo` |
| `src/lib/visitPlannerAdapter.ts` | Maps new fields through |
| `src/app/actions.ts` | Legacy planner removed; `confirmVisit` in `$transaction`; all history/stats use `Visit`; VisitRule CRUD actions added; `updateSchoolSettings` deleted |
| `src/app/schools/[id]/visit-rules/page.tsx` | Server component shell (fetches school + rules) |
| `src/app/schools/[id]/visit-rules/VisitRulesClient.tsx` | Full interactive form (new file) |
| `src/app/schools/[id]/page.tsx` | Removed `frequencyTarget` from select/display |
| `src/components/WeeklyPlanner.tsx` | Frequency badge, no-class red warning, visit-anyway day picker |
| `src/components/SchoolProfiles.tsx` | Removed modal/button/state; added Visit Rules link; removed `frequencyTarget` badge |
| `src/components/VisitHistory.tsx` | Minor: removed redundant client-side sort |
| `src/components/MapZoneViewImpl.tsx` | Removed `frequencyTarget` from map popup |
| `src/modules/calendarSync/sync.ts` | Removed `frequencyTarget` from school create |
| `scripts/import-schools.ts` | Removed `frequencyTarget` from school create |
| `src/auth.ts` | JWT callback fetches `region.name`; session exposes `regionName` |
| `src/types/next-auth.d.ts` | Added `regionName: string | null` to Session and JWT types |
| `src/app/page.tsx` | Sidebar uses `session.user.regionName` |
| `prisma/schema.prisma` | `VisitLog` model removed; `VisitRule` gets `reason`/`effectiveFrom`/`effectiveTo`; `School.frequencyTarget` removed |
| `prisma/migrations/20260622000000_phase2_visitrule_drop_visitlog/` | Adds VisitRule fields, migrates VisitLog→Visit, drops VisitLog |
| `prisma/migrations/20260622000001_drop_school_frequency_target/` | Drops `School.frequencyTarget` column |

**Deleted:**
- `src/lib/scoringEngine.ts`
- `src/lib/planner/EligibilityEngine.ts`
- `src/lib/planner/ConflictResolution.ts`
- `src/lib/planner/CapacityModel.ts`
- `src/lib/audit/AuditTrail.ts`

---

## Current App State

- **Build:** `next build` clean, `tsc --noEmit` clean
- **DB:** 3 migrations applied to Neon PostgreSQL. VisitLog dropped, frequencyTarget dropped, VisitRule extended.
- **Admin account:** `pedro@ymu.org` / `changeme`
- **Planner:** Uses new single planner. All region schools eligible regardless of ClassSession.
- **VisitRule UI:** Fully functional at `/schools/[id]/visit-rules`
- **Visit history:** Reads from `Visit` table only
- **Region name in sidebar:** Requires sign-out/sign-in to appear (baked into JWT at login)
- **Google OAuth:** Still needs redirect URI configured in Google Cloud Console (email/password works)

---

## Phase 1 Context (Still Relevant)

- Auth: NextAuth v5 JWT strategy, `src/auth.ts`, `src/proxy.ts`
- Roles: `ADMIN | REGIONAL_MANAGER | AFTER_SCHOOL_MANAGER | MENTOR | INTERVENTIONIST`
- Region scoping: `schoolRegionWhere(user)` in `src/lib/auth-helpers.ts` — do not bypass
- 4 regions: North, South, Central, East. West intentionally omitted.
- Admin sees all regions via `?region=<id>` URL param; RMs see only their own region
- Prisma singleton: `src/lib/prisma.ts` — all DB access goes through this
