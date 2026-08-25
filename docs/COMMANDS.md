# Commands Reference

---

## Dev Server

```bash
npm run dev
```
Starts at `http://localhost:3000`. Login at `/login`.

Admin account: `pedro@ymu.org` / `changeme`

---

## Database

```bash
# Apply pending migrations (use this for all schema changes)
npx prisma migrate deploy

# Regenerate Prisma client after schema changes
npx prisma generate

# Seed 4 regions + admin user (idempotent — safe to re-run)
npm run db:seed

# Open Prisma Studio (GUI for the DB)
npx prisma studio
```

**Do not use `prisma db push`** — proper migrations are in `prisma/migrations/`. Use `migrate deploy` instead.

---

## PWA icons

```bash
# Regenerate public/icons/ from public/brand/ + the route mark
npm run icons
```

Only needed if the branding or the mark changes; the generated PNGs are
committed. `any` and `maskable` are different artwork on purpose — the reasoning
is in `scripts/generate-icons.mjs`, read it before editing either.

Note that PWA behaviour differs between dev and production: serwist's runtime
caching and the `/~offline` fallback are only active in a production build.
To check them, `npm run build` then use the `svp-prod` preview (port 3100).

---

## Build & Type Check

```bash
# Full production build (run this before committing)
npm run build

# Type check only (faster)
npx tsc --noEmit
```

Both should exit with no errors. If either fails, fix before proceeding.

---

## School Import

```bash
# Single CSV
npm run import-schools -- --region=NORTH --file=data/north.csv

# Multiple CSVs merged (South 1 + South 2)
npm run import-schools -- --region=SOUTH --file=data/south1.csv --file=data/south2.csv
```

**CSV formats supported:**
- **Central format:** First column header is "School" — school name is in column 0
- **Standard format:** Active/inactive flag in column 0, school name in column 2

The importer auto-detects the format based on the header row.

**Reconcile behavior:**
- School in CSV but not in DB → **created**
- School in CSV, exists and active → **updated** (name normalized)
- School in CSV, exists but inactive → **reactivated**
- School in DB (for this region) but not in CSV → **deactivated** (`active = false`)

---

## User Management

```bash
npm run create-user -- \
  --email=user@ymu.org \
  --name="Full Name" \
  --role=REGIONAL_MANAGER \
  --region=CENTRAL \
  --password=changeme
```

Roles: `ADMIN | REGIONAL_MANAGER | AFTER_SCHOOL_MANAGER | MENTOR | INTERVENTIONIST`

Region codes: `NORTH | SOUTH | CENTRAL | EAST`

`--region` is only required for `REGIONAL_MANAGER`. Creating a REGIONAL_MANAGER also sets `Region.regionalManagerId`.

After creating or changing a user's role/region, they must sign out and back in for changes to appear in the JWT.

---

## Environment Variables Required

In `.env` (local) or Vercel dashboard (production):

```
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=<random 32+ byte base64 string>
AUTH_TRUST_HOST=true
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_URL=https://your-domain.com   # production only
OPENROUTE_SERVICE_API_KEY=...          # optional — enables travel-time ordering in planner
PLANNER_WORK_START=08:00               # optional — default 08:00
PLANNER_WORK_END=17:00                 # optional — default 17:00
```

Generate a new NEXTAUTH_SECRET: `openssl rand -base64 32`
