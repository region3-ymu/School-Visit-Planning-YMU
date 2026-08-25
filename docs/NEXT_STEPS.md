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

## Cross-app: the YMU hub (SVP + YMU-A + YMU-I)

The goal is a Zoho-style launcher: one place with an icon per app, ideally one
login. SVP is now installable on its own (see DECISIONS.md), which is step one.
The rest is ordered by what unblocks what.

### 1. Custom domains — DO THIS FIRST (needs DNS access to ymu.org, not yet available)

Put every app on a subdomain of one parent: `svp.ymu.org`, `a.ymu.org`,
`hub.ymu.org`. Vercel side is a few minutes per app; the DNS records are the
part that needs access nobody has yet.

**Why it comes first:** a shared session across apps needs a cookie on
`.ymu.org`, which every subdomain can read. Today SVP and YMU-A are on separate
`*.vercel.app` hostnames — different origins, so cookies cannot be shared even
in principle. No amount of app code works around this. Everything below is
blocked on it.

When it lands, also update: `NEXTAUTH_URL`, the Google OAuth redirect URI (see
BLOCKERS above), and YMU-A's Supabase redirect URLs.

### 2. Google sign-in for YMU-A

YMU-A signs in with Supabase email+password today, and it is the source of
friction. Enable Supabase's Google provider instead.

**The domain check cannot be `@ymu.org` here** — most YMU-A users are teachers
on personal Gmail addresses (`scripts/onboard-real-users.ts` in YMU-A is the
list). Gate on the user record instead: the sign-in succeeds only if that email
already exists in YMU-A's users table, which is the invite-only model already in
place. That is the difference from SVP, where every user is staff and the
`hd=ymu.org` + `signIn` domain check in `src/auth.config.ts` is correct.

### 3. Cross-links between apps

Cheap and useful once the domains exist: a "SVP" item in YMU-A's nav
(`navForRole()` in YMU-A's `src/lib/auth/roles.ts`), shown only to
`regional_manager`, and a link back from SVP.

**Do not oversell it as the hub** — it is a link, so it lands on the other
app's login, and on iOS a link from an installed PWA opens Safari rather than
the other installed app.

### 4. The hub itself, and only then real SSO

`hub.ymu.org` as a small PWA with three icons is easy once the domains are
real, and gives one home-screen icon for everything.

True SSO — one session, no second login — means one auth system for all staff:
either SVP moves to Supabase Auth or YMU-A moves to Auth.js. That is a project,
not an afternoon, and it is worth doing when YMU-I exists rather than before.

**Do not unify the two user directories yet.** SVP's users live in Neon with
their own region model; YMU-A's live in Supabase with RLS policies hanging off
them. Merging them now puts both apps at risk at once, for no gain until there
is a third app.

---

## Do Not Do (decided against, do not revisit without discussion)

- **Do not restore `VisitLog`** — `Visit` is the source of truth. The migration is applied and the table is gone.
- **Do not restore `School.frequencyTarget`** — `VisitRule` is the source of truth. The column is dropped.
- **Do not restore the "Edit Settings" modal** — `VisitRule` UI handles frequency; there are no other settings worth a modal.
- **Do not restore the legacy scoringEngine or EligibilityEngine** — deleted in Phase 2. The single planner in `proposeVisits.ts` handles all cases.
- **Do not add `CalendarDay` / A/B day logic back** — removed in Phase 1, confirmed unnecessary.
- **Do not add West region** — not yet active.
