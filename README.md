# @hms/api

Node.js + Express 5 + MongoDB (Mongoose 8) API. It is a modular monolith: `src/core/` is the shared kernel and `src/modules/` holds the business modules. See `docs/implementation/PLAN.md` sections 3.1, 5 and 6.

## Commands

| Command                             | What it does                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run dev`        | API on :4000 with reload (`.env` from `.env.example`)                                                   |
| `npm run dev:worker` | Outbox relay and event subscribers                                                                      |
| `npm run seed:dev`   | Demo hospital at `http://demo.localhost:5173`, one user per role panel                                  |
| `npm test`           | Unit tests (need Redis)                                                                                 |
| `npm run test:int`   | Integration tests on a MongoDB replica set: `MONGO_TEST_URI` if set, otherwise an in-memory replica set |

API docs: `http://localhost:4000/api/docs` (Swagger UI), generated from the route definitions.

## Request lifecycle (`src/app.js`)

1. `requestId` and `httpLogger` run first.
2. `/api/health` and `/api/docs` are served without a hospital or sign-in.
3. Every `/api/v1` call then passes through, in order:
   1. `tenantResolver`: finds the hospital from the Host header; 404, or 402 when suspended or read-only.
   2. Sign-in rate limits.
   3. Public auth routes (login and so on).
   4. `authenticate`: checks the token, loads permissions, picks the branch, enforces 2FA enrolment.
   5. API rate limit.
   6. Kernel routes, then module routes.

Within each route, the chain is:

1. `requireModule`: 402 if the module isn't subscribed.
2. `authorize`: 403, audited.
3. `validate`: 422.
4. `idempotency`.
5. The handler.

## Kernel (`src/core`)

| Folder       | Provides                                                                                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenancy/`   | Request context (AsyncLocalStorage), tenant plugin (forces `tenantId` into every query, update, delete and aggregate), tenant registry (Redis-cached), provisioning, Tenant and Branch models                                          |
| `db/`        | `defineModel()` (base + tenant + audit plugins), `withTransaction()`, `updateVersioned()`, soft delete, `version` for optimistic locking                                                                                               |
| `auth/`      | Password (Argon2id) and mobile OTP sign-in, TOTP two-factor and enrolment for privileged roles, lockout (5 attempts / 15 min), RS256 access tokens in httpOnly cookies, rotating refresh tokens with reuse detection, logout blacklist |
| `rbac/`      | `requireModule`, `authorize`, `assertPermission`, permission cache (60 s)                                                                                                                                                              |
| `approvals/` | Maker-checker engine and inbox routes; publishes `approval.requested` / `approval.decided`                                                                                                                                             |
| `audit/`     | Append-only audit log, automatic create/update/delete diffs, audit routes                                                                                                                                                              |
| `sequences/` | Atomic counters: `documentNumber('OP')` → `OP/26-27/000154`, `nextUhid()`                                                                                                                                                              |
| `events/`    | Transactional outbox, relay to BullMQ (one job per subscriber, idempotent job ids), `publish` / `subscribe`                                                                                                                            |
| `http/`      | `defineRoutes()` route contract, validation, pagination, OpenAPI                                                                                                                                                                       |
| `security/`  | Idempotency-Key, rate limits, AES-GCM for secrets at rest                                                                                                                                                                              |
| `notify/`    | SMS templates (DLT) and providers (console in development)                                                                                                                                                                             |
| `realtime/`  | Socket.IO with Redis adapter; rooms per tenant, branch and user                                                                                                                                                                        |

## Adding a module

Create `src/modules/<name>/` with the layout in PLAN section 3.1 and add it to `src/modules/index.js`.

- **Routes:** use `defineRoutes()`. A route without a module, permission, schema, audit action and summary fails at startup.
- **Models:** use `defineModel()`. Every index starts with `tenantId`; an integration test checks this.
- **Writes across documents:** use `withTransaction()`, and publish events inside it.
- **Other modules:** never import another module's `models/` or `services/`. Use its `index.js`; ESLint enforces this.
- **Lists:** use `.lean()`. Documents loaded without lean keep an audit snapshot.

## Deliberate differences from the spec

**Sign-in rate limit.** The spec says 10/min per IP. Hospitals usually reach the API from one NAT address, so that limit would lock out a whole shift change. Instead we allow:

- 10 per minute per IP and account
- 200 per minute per IP in total
