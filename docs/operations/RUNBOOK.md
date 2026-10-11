# HMS operations runbook

For whoever runs the production system: the API on Render (`api/`), the web app on Vercel
(`web/`), MongoDB (Atlas or another replica set) and Redis (Render Key Value).

## 1. What runs where

| Piece | Host | Notes |
|---|---|---|
| Web app | Vercel, root directory `web` | `web/vercel.json`: forwards `/api` and `/socket.io` to the API, security headers (CSP) |
| API and background jobs | Render web service `hms-api`, root `api` | `api/render.yaml`; `RUN_WORKER=true` runs the outbox relay and scheduled jobs in the same process |
| Database | MongoDB replica set | Transactions need a replica set. HMS uses about 180 collections; the Atlas free tier allows 500 per cluster, shared by every database on it |
| Cache, queues, rate limits, sockets | Redis (Render Key Value, `noeviction`) | Losing it loses queued jobs not yet run and signs nobody out (sessions are in MongoDB) |
| Files | MongoDB GridFS (`STORAGE_DRIVER=mongo`) or S3 | GridFS counts against the database size |

Health check: `GET /api/health` answers 200 `{ status: "ok", db: true, cache: true }`, or 503
when MongoDB or Redis is unreachable. Render restarts the service when it fails.

## 2. Deploying

1. CI must be green on `main` (both jobs: `api` and `web`).
2. **API first**, then web: the web app tolerates an older API for a few minutes, not the
   reverse. Render deploys on push; watch the log for `API listening` and `Indexes checked`
   with `failed: 0`.
3. Web: Vercel deploys on push. Open the site and sign in; check the browser console for CSP
   errors.
4. A change to `api/packages/shared` must be copied to the web: `cd web && npm run sync:shared`
   (CI fails until it is).

**Indexes.** In production the API builds missing indexes at start and never drops one. If the
log shows `Index build failed` for a model, usually duplicate data blocks a new unique index:
find the duplicates, fix them, run `npm run db:indexes` (with that database's `MONGO_URI`).

## 3. Rolling back

- **Web:** Vercel > Deployments > the previous good one > Promote to Production. Instant.
- **API:** Render > hms-api > Events > the previous deploy > Rollback. Takes a minute or two.
- Database changes are additive (new fields and indexes), so a rollback needs no data change.
  If a release ever needs a data migration, its notes say how to undo it before it ships.

## 4. Secrets

| Secret | Where | Rotating it |
|---|---|---|
| `MONGODB_URI` | Render env | Create a new database user in Atlas, update Render, redeploy, delete the old user |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Render env | Generate a new RS256 pair; after the deploy everyone signs in again (sessions are invalidated) |
| `DATA_ENCRYPTION_KEY` | Render env | **Do not rotate casually**: it encrypts two-factor secrets at rest. Rotation needs a re-encryption script; until then users would have to set up two-factor again |
| `RAZORPAY_WEBHOOK_SECRET`, SMS keys | Render env | Rotate in the provider dashboard, then Render |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | Render / Vercel env | Not secret, but keep to the team |

Never commit a secret. `api/.env*` and `api/.keys/` are git-ignored. If one leaks, rotate it
first and investigate after.

## 5. Backups and restore

- **Atlas paid tiers:** continuous backup with point-in-time restore. Turn it on (Project >
  Backup) and keep 30 days.
- **Any host, including free tiers:** a logical backup every night, kept off the server:
  `MONGO_URI=... npm run db:backup -- --out /secure/backups/hms-$(date +%F)`
  The files hold patient data: store them encrypted, in India (DPDP), with access limited.
- **Restore** (only into an empty database; the script refuses anything else):
  `RESTORE_URI=mongodb://.../hms_restored npm run db:restore -- <backup folder>`, then
  `npm run db:indexes` against it, point the API at it, check, and switch over.
- **Restore drill**: every month, and before go-live:
  `npm run db:restore-drill` backs up, restores into `<db>_restore_drill`, compares every
  collection's count, then drops the drill database. Record the timings. Last local run
  (2026-10-11): 177 collections, 3,749 documents; backup 18 s, restore 33 s, all matched.

## 6. When something goes wrong

1. **Is it down?** `GET /api/health`. 503 with `db: false`: MongoDB (Atlas status, network
   access list, credentials). `cache: false`: Redis (Render Key Value status).
2. **Errors for one user:** ask for the request id shown on the error message and search the
   Render log (and Sentry) for it.
3. **Slow:** Render metrics (CPU, memory). The free instance has a fraction of a CPU and sleeps
   when idle; a hospital needs a paid instance (see section 8). Atlas > Performance Advisor for
   missing indexes.
4. **Jobs not running** (SMS not sent, finance postings missing, midnight census not posted):
   the outbox relay runs inside the API (`RUN_WORKER=true`). A sleeping free instance runs no
   jobs; on a paid instance check the log for `Worker started`.
5. **Locked out:** a user locked by wrong passwords unlocks after 15 minutes, or an admin
   unlocks them or resets the password (Users). A lost two-factor phone: a Super Admin uses
   Users > Reset two-factor (with a reason; audited). If the only Super Admin lost theirs,
   support verifies them through the hospital's registered contact and runs
   `npm run support:reset-2fa -- <subdomain> <username> "<reason, ticket>"`.
   Advise every hospital to keep two Super Admins.
6. **Data looks wrong:** never edit the database by hand. Find the record's history in the
   audit log; corrections go through the screens (which keep the audit trail and approvals).

Severity and response:

| Level | Example | Respond within |
|---|---|---|
| 1 | Nobody can sign in; billing or pharmacy down | 15 minutes, all hands, update the hospital every 30 minutes |
| 2 | One module down; jobs stalled | 1 hour |
| 3 | A screen error with a workaround | Next working day |

After a level 1 or 2: a short written note (what happened, impact, cause, fix, what changes).

## 7. Routine checks

| When | Check |
|---|---|
| Daily | Health check green; Sentry new issues; backup ran |
| Weekly | Atlas storage and collection count; Render CPU and memory; `npm audit` in both folders |
| Monthly | Restore drill; review Super Admin and privileged users; rotate any shared credentials |
| Before go-live | Load test on a staging copy (`npm run load`); restore drill; secrets set; two-factor on for privileged roles; ABDM, SMS and payment gateway keys in place |

## 8. Capacity

Local load test (2026-10-11, one Node process on a busy laptop, 10 connections continuously):
every main read had p97.5 under 300 ms except an unstable reading of the lightest endpoint;
at 20 connections the busiest reads crossed it. The laptop was shared with other servers, so
treat these as a floor. For a 300-bed hospital run `npm run load` against a staging copy on
the planned instance size, and size up until reads stay under 300 ms at 2x the expected
concurrent users. Render's free instance is for demos only.
