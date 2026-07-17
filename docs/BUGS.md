# Known Bugs & Risks

---

## ACTIVE ISSUES

### 1. Google OAuth: redirect_uri_mismatch
**Severity:** High — blocks all Google sign-in

**Cause:** Callback URL not registered in Google Cloud Console.

**Fix:** Add `http://localhost:3000/api/auth/callback/google` (and production URL) to Authorized redirect URIs in Google Cloud Console → Credentials → OAuth 2.0 Client ID `969189057517-8uucl44odqv7t4dodcjvj4reudvs59vq`.

Email/password login works fine in the meantime.

---

### 2. Region name in sidebar requires re-login to appear
**Severity:** Low — cosmetic, self-resolving

**Cause:** `regionName` is baked into the JWT at sign-in. Users who were already logged in before the Phase 2 auth.ts change will still see the old display until they sign out and back in.

**Fix:** Sign out and sign back in.

---

### 3. Map markers jitter on every render
**Severity:** Low — cosmetic

**Location:** `src/components/MapZoneViewImpl.tsx` — random jitter applied to lat/lng coordinates on every render.

**Fix:** Memoize the jitter by school ID (e.g. `useMemo`). Planned for Phase 2b map work.

---

### 4. Dashboard stats are still placeholders
**Severity:** Low — informational only

**Location:** `src/app/actions.ts → getDashboardStats`

**Symptom:** "Due This Week" is `Math.floor(totalSchools / 3)`. "Overdue" and "Recent Cancellations" are hardcoded to 0.

**Fix:** Compute from `Visit` + `VisitRule` data. Planned for Phase 3.

---

### 5. Legacy availability rules (dayType-only) silently skipped
**Severity:** Low — only affects manually-entered old data

**Cause:** A/B day system removed in Phase 1. Rules with only `dayType` and no `weekday` field are ignored by the planner.

**Impact:** Schools with only dayType rules won't appear in the planner. These are rare — most schools have weekday rules or rely on Google Calendar ClassSessions.

**Fix:** Edit the school's availability JSON to use weekday rules instead, or just create a VisitRule to make the school eligible regardless of ClassSessions.

---

## RISKS

### R1. `.env` may contain production secrets in git
Verify `.env` is in `.gitignore` before pushing to any public repo:
```bash
git check-ignore -v .env
```
If not excluded, add it and rotate all secrets immediately.

### R2. After-School Manager has no actual permissions
`AFTER_SCHOOL_MANAGER` is in the Role enum but behaves like Mentor (no special scoping). Do not grant to real users expecting special behavior until Phase 3.

### R3. JWT role/region changes require re-login
Changing a user's role or region in the DB does not take effect until they sign out and back in. There is no session invalidation mechanism. This is acceptable for the current use case but worth noting if roles change frequently.

### R4. `confirmVisit` uses local time for 09:00–10:00 slot
When confirming a visit without a specific time, `plannedStartDateTime` is set using `setHours(9, 0, 0, 0)` on a local Date object. If the server runs in a different timezone than the user, the stored time will be off. Low risk for a single-tenant app, but worth fixing before multi-timezone use.
