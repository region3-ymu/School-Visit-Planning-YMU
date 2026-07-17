# Next Steps

Ordered by priority.

---

## BLOCKERS (must do before sharing with other users)

### 1. Configure Google OAuth Redirect URI

In Google Cloud Console → Credentials → OAuth 2.0 Client ID (`969189057517-...`):

Add these **Authorized redirect URIs**:
- `http://localhost:3000/api/auth/callback/google`
- `https://<your-vercel-domain>/api/auth/callback/google`

Email/password login works fine in the meantime.

### 2. Create Regional Manager Users (if not done)

```bash
npm run create-user -- --email=rm.central@ymu.org --name="Central RM" --role=REGIONAL_MANAGER --region=CENTRAL --password=changeme
npm run create-user -- --email=rm.north@ymu.org   --name="North RM"   --role=REGIONAL_MANAGER --region=NORTH   --password=changeme
npm run create-user -- --email=rm.south@ymu.org   --name="South RM"   --role=REGIONAL_MANAGER --region=SOUTH   --password=changeme
npm run create-user -- --email=rm.east@ymu.org    --name="East RM"    --role=REGIONAL_MANAGER --region=EAST    --password=changeme
```

After creating, each RM must sign out and back in for their region name to appear in the sidebar.

---

## Phase 2b — Map View (next development phase)

The map tab exists (`src/components/MapZoneViewImpl.tsx`) but is disconnected from the new planner data. Planned work:
- Connect map markers to the current week's plan (from `Visit`/planner output)
- Show actual routing lines in visit order for each day
- Remove the random jitter applied to coordinates on every render (AUDIT #9 — currently markers move on each re-render; memoize jitter by school id)

**Do not touch:** the map component's Leaflet setup or the `ssr: false` dynamic import — these are working correctly.

---

## Phase 3 — Operational Hub

- Make `maxVisitsPerDay` and `maxVisitsPerWeek` configurable per RM (currently hardcoded constants in `proposeVisits.ts` — see TODO comments)
- Build the visit confirmation form (the questionnaire after a visit — currently visits are confirmed with a single click and no detail is captured)
- Dashboard stats: `dueThisWeek` and `overdue` are still placeholder values — compute from `Visit` + `VisitRule`
- After-School Manager role permissions (currently a stub with no special behavior)

---

## Production Deployment (Vercel)

Add these environment variables in Vercel dashboard:
- `DATABASE_URL` — Neon connection string
- `NEXTAUTH_SECRET`
- `AUTH_TRUST_HOST=true`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_URL` — production URL

---

## Do Not Do (decided against, do not revisit without discussion)

- **Do not restore `VisitLog`** — `Visit` is the source of truth. The migration is applied and the table is gone.
- **Do not restore `School.frequencyTarget`** — `VisitRule` is the source of truth. The column is dropped.
- **Do not restore the "Edit Settings" modal** — `VisitRule` UI handles frequency; there are no other settings worth a modal.
- **Do not restore the legacy scoringEngine or EligibilityEngine** — deleted in Phase 2. The single planner in `proposeVisits.ts` handles all cases.
- **Do not add `CalendarDay` / A/B day logic back** — removed in Phase 1, confirmed unnecessary.
- **Do not add West region** — not yet active.
