# Implementation plan: from design to production code

This plan turns the Phase 1 specification (`docs/Hospital_Management_System_Phase1_Specification.pdf`),
the module deep dives (`docs/modules/*.md`) and the UI design (`docs/ui-design/`) into a working,
production-ready product.

- **Frontend:** React, Tailwind CSS
- **Backend:** Node.js, Express
- **Database:** MongoDB
- **Hosting:** web app on AWS S3 + CloudFront; API and worker on ECS Fargate

The design canvas is now frozen as the reference. From here on, changes are made in code.

---

## 1. Principles

1. **Build one module at a time, top to bottom.** A module is built through the database, API,
   screens, print templates, reports and tests, and only counts as done when it passes the
   checklist in section 9.
   - We never build "all the APIs first, then all the screens".
2. **Build the shared kernel and the UI kit first.** Tenancy, auth, permissions, approvals,
   audit, numbering, events and printing are built once in `core/`. The patient banner, data
   table, status badge, menu and form fields are built once in `packages/ui`.
   - Modules only combine these pieces; they never re-create them.
3. **The same Zod schema validates on both sides.** It checks the request in the API, checks
   the form in the browser, and generates the OpenAPI docs. It lives in `packages/shared`.
4. **Modules don't reach into each other's data.** Module A never reads module B's
   collections. It calls B's service interface or reacts to B's domain events.
   - This keeps the system a *modular monolith*: one deployable app that can be split later.
5. **The UI/UX review fixes are built in from day one.** They are not polished in afterwards
   (see section 7.3).
6. **Code from the start of each module:**
   - Every screen handles all 11 screen states from the "States" board.
   - Every money or stock write is idempotent: repeating the request doesn't double-charge.
   - Every change is audited.

---

## 2. Technology stack

The stack follows the spec, with one change: the UI kit is **Tailwind CSS** instead of MUI.

| Layer | Choice | Notes |
|---|---|---|
| Language | **JavaScript** (ES modules, Node 22+) everywhere | Zod schemas in `packages/shared` give runtime validation on both sides; JSDoc comments document shapes where helpful |
| Web build | React 19 + Vite | Static output for S3; each route's code loads only when opened |
| Styling | **Tailwind CSS v4** | Design tokens in CSS variables (`@theme`), dark mode and high-contrast themes from the same tokens, `prettier-plugin-tailwindcss` for class order |
| Accessible primitives | Radix UI (Dialog, Popover, DropdownMenu, Tabs, Tooltip, Select) | Unstyled, keyboard- and screen-reader-ready; we style them with Tailwind |
| Data tables | TanStack Table + TanStack Virtual | Server-side paging, sorting and filters; sticky header; column chooser; density toggle; virtual scrolling for long lists |
| Server state | Redux Toolkit + RTK Query | As in the spec: caching and refetching; Socket.IO pushes update the cache |
| Forms | React Hook Form + Zod (`@hookform/resolvers`) | Same schema as the API |
| Routing | React Router (data routers, lazy routes) | Each module's routes load only when needed |
| Command palette | `cmdk` | Ctrl+K: jump to any screen, patient or bill |
| Language support | i18next + react-i18next | English and Hindi in Phase 1; translation files per module |
| Charts | Recharts | Analytics screens; colours from tokens |
| Dates | date-fns + date-fns-tz | Stored in UTC, shown in IST |
| Real-time | Socket.IO (client + Redis adapter) | Bed board, queue TV, approvals, critical alerts |
| API | Node.js 24 LTS, Express 5 | |
| Database | MongoDB 8 (Atlas, replica set) + Mongoose 8 | Transactions require a replica set; local development uses a one-node replica set in Docker |
| Cache and jobs | Redis 7 + BullMQ | Rate limits, token blacklist, outbox relay, PDF/SMS/report jobs |
| PDFs | pdfmake (server) | A4, A5 and 80 mm thermal templates |
| Auth | JWT RS256 in httpOnly cookie + refresh rotation, Argon2id, TOTP 2FA | |
| API docs | OpenAPI 3.1 from Zod (`@asteasolutions/zod-to-openapi`) | Swagger UI at `/api/docs` |
| Tests | Vitest, Supertest, Playwright, axe-core, k6 | |
| Monorepo | pnpm workspaces + Turborepo | Cached builds and tests per package |
| Quality | ESLint (flat config), Prettier, Husky + lint-staged, commitlint | |
| CI/CD | GitHub Actions | |
| Infra | Terraform (S3, CloudFront, WAF, ALB, ECS, ElastiCache, IAM, Secrets Manager) | |
| Monitoring | Pino logs to CloudWatch, Sentry (web + API), OpenTelemetry traces | |

Pin versions to the latest stable release at scaffold time. After that, Renovate updates them
through reviewed PRs.

---

## 3. Repository layout

```
hospitalManagement/
├─ apps/
│  ├─ web/            React + Tailwind: hospital staff app (all 28 role panels)
│  ├─ portal/         React + Tailwind: patient portal + public booking (mobile first)
│  ├─ console/        React + Tailwind: platform owner console (tenants, plans, billing)
│  └─ api/            Node + Express: REST API, Socket.IO, BullMQ worker
├─ packages/
│  ├─ shared/         Zod schemas, enums, module codes, permission keys, money/date utils
│  ├─ ui/             Tailwind component library + design tokens (used by all 3 web apps)
│  ├─ i18n/           shared translation files (en, hi) and helpers
│  └─ config/         eslint, prettier, tailwind presets, vitest base config
├─ infra/
│  ├─ terraform/      envs/{dev,staging,prod}, modules/{web,api,redis,network,iam}
│  └─ docker/         api.Dockerfile, docker-compose.yml (mongo replica set, redis, mailpit)
├─ e2e/               Playwright journeys (one spec per journey in the spec PDF)
├─ perf/              k6 load scripts (300-bed hospital profile)
├─ docs/              spec, module deep dives, UI design, this plan, ADRs
├─ .github/workflows/ ci.yml, deploy-web.yml, deploy-api.yml, nightly.yml
├─ turbo.json  pnpm-workspace.yaml  package.json  .nvmrc  .env.example
```

### 3.1 Backend: `apps/api`

```
apps/api/src/
├─ server.js                 HTTP + Socket.IO bootstrap, graceful shutdown
├─ worker.js                 BullMQ worker entry (same image, different command)
├─ app.js                    Express app and middleware chain (spec section "Request lifecycle")
├─ config/
│  └─ env.js                 Zod-validated env; crash on boot if wrong
├─ core/                     shared kernel: every module depends on it, it depends on no module
│  ├─ tenancy/               context.js (AsyncLocalStorage), tenant.plugin.js, tenantResolver.js, tenant.registry.js
│  ├─ auth/                  login, refresh, logout, 2FA, password policy, sessions, token blacklist
│  ├─ rbac/                  guards.js (requireModule, authorize, scope), permission.cache.js, roles seed
│  ├─ approvals/             maker-checker engine: rules, requests, decide, apply via events
│  ├─ audit/                 audit.plugin.js (auto log on save), audit.service.js, export
│  ├─ sequences/             atomic counters: UHID, bill no., IP no., per tenant/branch/series/year
│  ├─ db/                    connection, withTransaction.js, base.plugin.js (createdBy, version, soft delete)
│  ├─ events/                outbox model, publisher, relay job, subscriber registry
│  ├─ files/                 S3 upload/download with presigned URLs, virus scan hook
│  ├─ notify/                SMS (DLT templates), WhatsApp, e-mail, in-app; provider adapters
│  ├─ print/                 pdfmake engine, shared layouts (A4/A5/80 mm), letterhead, QR/barcode
│  ├─ realtime/              Socket.IO server, rooms per tenant/branch/ward, auth handshake
│  ├─ jobs/                  queue factory, retry/backoff policy, dead-letter
│  ├─ security/              helmet, rate limiter, idempotency middleware, input sanitising
│  ├─ errors/                AppError, error handler (spec error format with requestId)
│  ├─ http/                  validate(), paginate(), response helpers, OpenAPI registry
│  ├─ i18n/                  server-side message keys for SMS and PDFs
│  └─ observability/         pino logger, request id, metrics, OpenTelemetry setup
├─ modules/
│  ├─ index.js               mountModules(): registers every module's router, events, jobs
│  ├─ platform/              tenants, plans, subscriptions, signup, console APIs
│  ├─ setup/                 hospital profile, branches, departments, wards, beds, masters, imports
│  ├─ users/                 users, roles, data scopes, employee login
│  ├─ patients/              registration, duplicates, merge, ABHA link, documents
│  ├─ billing/               charges, bills, payments, refunds, deposits, shifts, corporate, GST
│  ├─ insurance/             payers, TPA, pre-auth, claims, settlements, schemes, packages
│  ├─ opd/                   schedules, slots, appointments, check-in, queue, consultation, e-Rx
│  ├─ ipd/                   admission, beds, transfers, rounds, day care, discharge
│  ├─ nursing/               MAR, vitals, I/O, assessments, care plans, handover, indents
│  ├─ lab/                   orders, samples, results, QC, micro, histo, reports
│  ├─ radiology/             orders, scheduling, reporting, PACS link
│  ├─ pharmacy/              dispensing, FEFO, counter sale, returns, controlled drugs
│  ├─ inventory/             items, stores, indents, PO, GRN, transfers, stock ledger
│  ├─ hr/                    employees, attendance, leave, rosters
│  ├─ payroll/               salary structures, runs, statutory (PF, ESI, PT, TDS), payslips
│  ├─ finance/               chart of accounts, auto-posting, vouchers, statements
│  ├─ mrd/                   records, coding (ICD-10), release of information, registers
│  ├─ diet/                  diet orders, kitchen production, tray labels
│  ├─ facility/              housekeeping, bed cleaning, maintenance tickets, assets
│  ├─ quality/               incidents, indicators, audits, NABH evidence
│  ├─ crm/                   leads, campaigns, feedback, call centre
│  ├─ portal/                patient-facing APIs (booking, reports, payments)
│  ├─ abdm/                  ABHA, HIP/HIU consent flows
│  └─ reports/               cross-module report runner and analytics read models
└─ test/                     test helpers: app factory, tenant/user factories, Mongo memory replset
```

**Inside every backend module.** OPD is shown here; every module follows the same shape.

```
modules/opd/
├─ index.js                  public surface: router, service interface, event handlers, jobs
├─ opd.routes.js             route table: path → requireModule('OPD') → authorize('opd:visit:create') → validate(schema) → controller
├─ controllers/              HTTP in/out only (no business rules)
│  ├─ appointment.controller.js
│  └─ visit.controller.js
├─ services/                 business rules + transactions (unit-tested)
│  ├─ appointment.service.js
│  ├─ queue.service.js
│  └─ consultation.service.js
├─ models/                   Mongoose models with tenant + base + audit plugins and indexes
│  ├─ appointment.model.js
│  └─ visit.model.js
├─ events.js                 events this module publishes and the handlers it subscribes
├─ jobs.js                   background jobs (reminders, no-show marking)
├─ print/                    pdfmake templates (OPD slip, prescription A5)
├─ reports/                  report definitions (queries + columns + permissions)
├─ seed/                     demo data + master defaults for a new tenant
├─ README.md                 what the module owns, its events, its permissions
└─ __tests__/
   ├─ appointment.service.test.js    unit
   ├─ opd.api.test.js                every route: 401, 402, 403, 422, happy path
   ├─ opd.isolation.test.js          another tenant's IDs → 404
   └─ queue.concurrency.test.js      parallel token issue never duplicates
```

Request and response schemas for OPD do not live here. They live in
`packages/shared/src/modules/opd/`, so the web app uses the same ones.

**Layering rules.** These are enforced with ESLint `no-restricted-imports` and `dependency-cruiser` in CI.

- `controllers` call only `services`; `services` call their own `models` and other modules'
  `index.js` service interfaces.
- No module imports another module's `models/`.
- `core/` never imports from `modules/`.

### 3.2 Frontend: `apps/web`

```
apps/web/src/
├─ main.jsx                  bootstrap: providers, i18n, Sentry
├─ app/
│  ├─ router.jsx             builds routes from the module registry, filtered by subscription + permission
│  ├─ store.js               Redux store, RTK Query base API (cookie auth, x-branch-id, 401 → refresh)
│  ├─ providers.jsx          theme, i18n, toasts, socket, query error boundary
│  ├─ shell/                 AppShell, Sidebar (search, collapsible groups, favourites), TopBar,
│  │                         BranchSwitcher, RoleSwitcher, CommandPalette, ApprovalsBell, AlertsTray
│  └─ registry.js            list of modules: code, routes, menu items, permissions, shortcuts
├─ modules/
│  ├─ auth/  setup/  users/  patients/  billing/  insurance/  opd/  ipd/  nursing/  lab/
│  ├─ radiology/  pharmacy/  inventory/  hr/  payroll/  finance/  mrd/  diet/  facility/
│  └─ quality/  crm/  reports/  approvals/  audit/  myspace/  queue-tv/
├─ lib/                      socket.js, hotkeys.js, print.js, format (₹, dates, UHID), storage (draft autosave)
└─ styles/
   └─ app.css                @import "tailwindcss"; @import "@hms/ui/tokens.css";
```

**Inside every frontend module.** OPD again:

```
modules/opd/
├─ index.js                  module manifest: routes, menu entries, permissions, hotkeys, home widgets
├─ routes.jsx                lazy routes: /opd/appointments, /opd/check-in, /opd/consult/:visitId …
├─ api.js                    RTK Query endpoints (injectEndpoints) + socket cache updates
├─ pages/                    one file per screen in docs/ui-design/screens.md
│  ├─ AppointmentsPage.jsx
│  ├─ CheckInPage.jsx
│  ├─ TriagePage.jsx
│  └─ ConsultationPage.jsx
├─ components/               module-only pieces (SlotGrid, TokenSlip, PrescriptionPad)
├─ hooks/                    useQueue, useConsultationDraft …
├─ i18n/                     en.json, hi.json
└─ __tests__/                component tests (Vitest + Testing Library + axe)
```

**Naming:**
- Pages are named `XxxPage.jsx`, and each page's URL matches the route in `screens.md`.
- Tabs are kept in the URL (`?tab=gst`), so links and the browser back button work.

### 3.3 Shared packages

```
packages/shared/src/
├─ modules.js                module codes + labels + dependencies (IPD needs CORE …)
├─ permissions.js            every permission key as a constant, grouped by module
├─ enums/                    statuses (bed, bill, sample …) with label keys and badge tone
├─ money.js                  paise helpers, GST split, rounding, Indian number format
├─ ids.js                    UHID / bill no. formats, ABHA validation, mobile/PIN/IFSC checks
└─ modules/<module>/         Zod schemas for requests, responses and forms

packages/ui/src/
├─ tokens.css                Tailwind v4 @theme: colours, type scale, radius, spacing, shadows; dark + high-contrast
├─ primitives/               Button, IconButton, Input, Select, Combobox, Checkbox, Radio, Switch,
│                            DatePicker, Textarea, FormField, Dialog, Drawer, Popover, Tooltip, Tabs, Toast
├─ data/                     DataTable, Pagination, FilterBar, EmptyState, Skeleton, StatTile, Timeline, Kanban
├─ clinical/                 PatientBanner, AllergyChip, VitalsStrip, CriticalAlert (acknowledge + escalate),
│                            BedTile, MarGrid, TokenDisplay, SoundAlikeFlag
├─ feedback/                 StatusBadge, ApprovalBanner, StateViews (403, 402, error, offline, session-expired,
│                            conflict-409, device-not-connected), ConfirmDialog (reason required)
├─ layout/                   Page, PageHeader, Card, SplitView, Stepper, PrintFrame
└─ index.js
```

`packages/ui` has a Storybook (or Ladle) catalogue. Every component has a story with all its
states and an automatic axe accessibility check.

---

## 4. Design tokens in Tailwind

The tokens come from `docs/ui-design/tokens.json`. The review fixes (section 7.3) are applied:
- a type scale that starts at 14 px
- a separate accent colour so the brand colour no longer looks like a status
- red used only for "act now"

```css
/* packages/ui/src/tokens.css */
@import "tailwindcss";

@theme {
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --color-ground: #F4F6F8;   --color-surface: #FFFFFF;
  --color-ink: #142130;      --color-muted: #5B6878;   --color-line: #DDE2E8;
  --color-menu: #13263F;     --color-primary: #1D3557;
  --color-accent: #0F6E78;   /* teal brand accent, no longer the same as "due" orange */

  --color-success: #1A6B44;  --color-success-bg: #E3F3EA;
  --color-warning: #7A4E00;  --color-warning-bg: #FFF1D6;
  --color-critical: #A3201A; --color-critical-bg: #FDECEA;   /* act-now only */
  --color-info: #1F5FAD;     --color-info-bg: #E6EEF9;
  --color-neutral: #46505C;  --color-neutral-bg: #E9EDF1;    /* occupied bed, draft, closed */

  --text-xs: 12px;  --text-sm: 13px;  --text-base: 14px;  --text-md: 15px;
  --text-lg: 17px;  --text-xl: 20px;  --text-2xl: 24px;  --text-3xl: 32px;

  --radius-control: 8px; --radius-card: 10px; --radius-dialog: 12px;
}

[data-theme="dark"] { --color-ground: #0E1621; --color-surface: #16202C; --color-ink: #E7ECF2; /* … */ }
[data-theme="contrast"] { --color-muted: #2E3A47; --color-line: #8A96A3; /* … */ }

@layer base {
  :focus-visible { outline: 2px solid var(--color-info); outline-offset: 2px; }
}
```

**Rules:**
- **Colours come from tokens only.** A lint rule bans hex colours in components.
- **Badges** are 13 px semibold and always show colour plus a label, and an icon where
  colour alone would carry the meaning.
- **Tap targets** are at least 40 px on desktop and 44 px on tablet and phone.
- **Screen sizes:** layouts are tested at 1366 × 768 (the usual hospital PC), at 1440, and
  at 768 px for tablets.

---

## 5. Cross-cutting features

Each of these is built once in `core/` (API) or `packages/ui` (web). Modules only configure them.

| Concern | How it works | Built in |
|---|---|---|
| Tenancy | Hospital found from the sub-domain; `tenantId` filter added to every query automatically; cross-tenant queries blocked | Phase 0 |
| Auth | Cookie JWT, refresh rotation, 2FA for privileged roles, lockout after 5 failed logins, 15 min idle timeout, mobile OTP login | Phase 0 |
| Permissions | `module:resource:action` keys; data scopes (own, department, ward, branch, all); the menu and routes are built from the same keys | Phase 0 |
| Module gating | `requireModule()` returns 402; web hides unsubscribed modules and shows the 402 screen on direct links | Phase 0 |
| Approvals (maker-checker) | Rules per action (discount above limit, refund, cancellation …); 202 APPROVAL_PENDING; `approval.decided` event | Phase 0 |
| Audit | Mongoose plugin logs every create, update, delete, approve, print and export with before/after values | Phase 0 |
| Numbering | Atomic counters per tenant, branch, series and financial year | Phase 0 |
| Concurrency | `version` field; 409 VERSION_CONFLICT; UI shows the conflict state with "reload and merge" | Phase 0 |
| Idempotency | `Idempotency-Key` on money and stock POSTs, stored for 24 h in Redis | Phase 0 |
| Events | Transactional outbox, then a relay job, then BullMQ subscribers; retries and a dead-letter queue | Phase 0 |
| Files | S3 with tenant prefix, presigned URLs (5 min), size/type limits | Phase 0 |
| Print | pdfmake templates per module; print preview in a PrintFrame; thermal 80 mm and A4/A5 | Phase 0 (engine), each module (templates) |
| Notifications | SMS (DLT templates), WhatsApp, e-mail, in-app; message in the patient's preferred language | Phase 0 (engine) |
| Real-time | Socket.IO rooms per tenant/branch/ward; Redis adapter for multiple API tasks | Phase 0 |
| i18n | Every visible string is a translation key; English + Hindi; patient-facing text in the patient's language | Phase 0 |
| Keyboard | Global hotkeys (Ctrl+K palette, F2 new patient, F4 new bill, Alt+S save, Esc close); each module registers its own | Phase 0 |
| Drafts | Long forms autosave to the browser and restore after a network drop or session timeout | Phase 0 |
| Reports | Report runner: query, column list, filters, permission; CSV/XLSX/PDF export (audited) | Phase 1 |
| Observability | requestId on every log line and error; Sentry; CloudWatch alarms on 5xx, latency, queue depth | Phase 0 |

---

## 6. API conventions (from the spec, enforced by shared helpers)

- **Base path:** `/api/v1`, same origin as the web app. Money is stored as integer paise and
  dates in ISO 8601 UTC.
- **Lists:** `?page=&limit=` (max 100), returning `{ items, page, limit, total }`. Sorting
  with `?sort=-createdAt`.
- **Errors:** `{ error: { code, message, details[], requestId } }`, using the codes and
  statuses in the spec (401, 402, 403, 404, 409, 422, 202, 429, 500).
- **Every route declares four things:**
  - the module it belongs to
  - the permission it needs
  - its Zod schema
  - its audit action
- A test fails the build if any route is missing one of them.

---

## 7. Phases

Each phase ends with a demo on staging and its exit check. A module inside a phase is merged
only when it meets the checklist in section 9.

The spec's four-week commercial plan assumes seven parallel squads. With a smaller team the
order stays the same and the calendar stretches. The rough effort per phase is in brackets
(squad-weeks).

### Phase 0: Foundation (1.5)
- **Repo:** monorepo, Turborepo, lint/format/commit hooks, CI pipeline (section 10),
  docker-compose for local Mongo replica set + Redis.
- **Infra:** Terraform for dev and staging; S3 + CloudFront for web; ECS for API and worker;
  Atlas project; Secrets Manager.
- **API kernel:** everything in `core/` listed in section 5, plus a health check, OpenAPI docs
  and the test helpers.
- **UI kit:**
  - tokens, primitives, DataTable, StatusBadge, PatientBanner, StateViews, ConfirmDialog
  - AppShell with the new Sidebar (search, groups, favourites), CommandPalette and
    keyboard shortcuts
  - Storybook catalogue
- **Web:** login (password, OTP, 2FA), forgot password, session expiry, branch and role
  switch, a module registry with permission-filtered routes and menu.
- **Exit check:** a test hospital signs in and sees an empty dashboard. Its menu only shows
  subscribed modules. A direct link to an unsubscribed module shows 402. CI is green and
  deploys to staging.

### Phase 1: Platform and core (2)
- **Platform:** signup, tenant creation, plans and modules, subscription billing,
  read-only and suspended modes, console app.
- **Setup:**
  - hospital profile, branches, departments, wards and beds
  - masters: services and tariffs, doctors, payers
  - Excel import with validation report
- **Users and roles:** 39 roles from the spec, data scopes, approval rules editor.
- **Patients:**
  - quick and full registration with the duplicate check
  - photo, ABHA verify, allergies, preferred language
  - regional-script name, relation (S/o, D/o, W/o), guardian for minors
  - UHID card print
- **Billing engine:**
  - charges, bills, payments (cash, UPI, card, cheque, bank transfer, payment link)
  - receipts, deposits, refunds and cancellations via approvals
  - cashier shift open and close, GST rules
- **Exit check:** "Register a patient and print a bill on staging" (spec week 1 check).

### Phase 2: OPD and front office (2)
- **OPD:** doctor schedules, slots, appointments, walk-in, check-in with token, queue +
  Queue TV (bilingual, voice call), triage, consultation (SOAP, templates), e-prescription,
  follow-up rules, tele-consult link.
- **Front office, patient portal booking, clinic one-screen mode.**
- OPD reports and analytics.
- **Exit check:** an OPD journey from booking through consultation, prescription, bill and
  SMS works, including the alternate flows in `docs/modules/OPD.md`.

### Phase 3: IPD, nursing and insurance (3)
- **IPD:** admission with payer segment, live bed board, bed requests and transfers,
  rounds, orders, day care and packages, discharge with summary, death and LAMA flows.
- **Nursing:**
  - MAR with a current-time line, separate infusion and PRN/stat sections, barcode scan
  - vitals with NEWS2, I/O, assessments, care plans, ISBAR handover, indents
- **Insurance/TPA:** pre-auth, enhancement, final approval tracking (IRDAI 1 h and 3 h
  timers), claims, settlements, payer split on the IP bill.
- IPD reports and analytics.
- **Exit check:** "Full OPD and IPD patient journey on staging" (spec week 2 check).

### Phase 4: Diagnostics and stock (3)
- **Laboratory:**
  - orders, sample collection with barcode labels, phlebotomy phone screens
  - results and validation, critical-value call-back with acknowledgement
  - QC (Westgard), microbiology, histopathology, NABL report
- **Radiology:** orders, scheduling, reporting, templates, PACS/viewer link.
- **Pharmacy:**
  - dispensing with FEFO, substitution with consent, counter sale, returns
  - Schedule H/H1/X registers
  - weight-based check for children
  - GST on medicines at current rates (most at 5% and listed life-saving drugs at 0% since
    22 September 2025)
- **Inventory:** items, stores, indents, PO, GRN with approval, transfers, stock ledger,
  dead stock and expiry reports.
- **Exit check:** orders from OPD/IPD reach the lab, radiology and pharmacy worklists; results
  return to the doctor; stock and the bill update in one transaction.

### Phase 5: People and money (2.5)
- **HR:** employee master, attendance (biometric import), leave, rosters and swaps.
- **Payroll:** salary structures, monthly run with approval and lock, PF/ESI/PT/TDS,
  payslips, bank file.
- **Finance:** chart of accounts, auto-posting from every money event, vouchers, day book,
  trial balance, P&L, balance sheet, GST reports.
- **Exit check:** payroll matches manual calculation for 50 sample employees, and the trial
  balance balances after a test month (spec acceptance criteria).

### Phase 6: Support modules and analytics (2)
- **Support modules:**
  - MRD: records, ICD-10 coding, release of information, birth and death registers
  - Diet: orders, kitchen production, tray labels
  - Facility: housekeeping, bed cleaning linked to the bed board, maintenance, assets
  - Quality: incidents, indicators, audits, NABH evidence
  - CRM: leads, campaigns, feedback
- **Patient portal:** reports, bills, payments, stay view.
- **My Space:** employee self-service.
- **Reports:** cross-module reports and management dashboards.
- **Exit check:** feature complete; demo to the pilot hospital with its masters loaded (spec
  week 3 check).

### Phase 7: Hardening and go-live (1.5)
- **Performance:** k6 at 2× peak for a 300-bed hospital; meet the spec targets (p95 under
  300 ms for reads and 600 ms for writes).
- **Security:** OWASP ZAP, dependency audit, external pen test; no high findings open.
- **Production setup:**
  - Terraform prod, WAF, alarms
  - backups and a restore drill
  - runbooks and on-call
- **Pilot hospital:** UAT with signed test scripts per module, data migration, training,
  2–3 day parallel run for billing and pharmacy, go-live, 30 days of hyper-care.

### Module dependencies (build order)

```
core ─┬─ platform ─ setup ─ users ─ patients ─ billing ─┬─ opd ──────┐
      │                                                 ├─ ipd ─ nursing ─ insurance
      │                                                 ├─ lab, radiology (need opd/ipd orders)
      │                                                 └─ pharmacy ─ inventory
      ├─ hr ─ payroll ─ finance (posts from billing, pharmacy, inventory, payroll)
      └─ mrd, diet, facility, quality, crm, portal (consume events from the above)
```

### 7.3 UI/UX review fixes and where they are built

| Review item | Built as | Phase |
|---|---|---|
| Patient banner missing on rounds, pharmacy, MAR; abbreviated names in lists | `PatientBanner` is mandatory in every patient-context page (checked in each module checklist and by Playwright); list cells use `PatientCell` (full name + UHID/age) and `SoundAlikeFlag` | 0, used from 1 |
| Red used for normal states | Status → tone map in `packages/shared/enums`; red only for act-now; occupied bed is neutral | 0 |
| Critical results not acknowledged | `CriticalAlert` component + `alerts` service: acknowledge with who/when, escalate after the timeout | 0, wired in 4 |
| Blood group list missing negatives; age-based discounts | Enums in `shared`; discounts from rules, never hard-coded | 1 |
| MAR layout | `MarGrid` with current-time line, infusion and PRN/stat sections, blank empty cells | 3 |
| Rounds plan not linked to orders | Plan → order suggestions; warning when the plan names a drug with no matching order | 3 |
| 47-item menu | Sidebar with search, collapsible groups, favourites, Ctrl+K palette | 0 |
| No focus style or shortcuts | Global `:focus-visible`, hotkey registry, Enter-to-next-field in counter forms | 0 |
| Small text | Type scale starting at 14 px, badges 13 px | 0 |
| Fixed at 1440 px | Responsive layouts at 1366/1440 and tablet 768 px; nursing and phlebotomy tablet-first | 0 rules, each module |
| Accent looks like a status colour | New accent token | 0 |
| Missing states (409, device offline, stale data, double submit) | `StateViews` + `useMutation` wrapper that disables while saving and sends an idempotency key | 0 |
| Registration gaps | Regional-script name, preferred language, relation, guardian, infant age in months/days | 1 |
| Language | i18n keys from day one; Hindi for staff and patient-facing screens; bilingual Queue TV with voice | 0, 2 |
| Print templates (wristband, consent, sample labels …) | Each module's `print/` folder; listed in its checklist | each module |

---

## 8. Data rules (from the spec, built into base plugins)

- **Plugins:** every tenant-owned model uses `tenantPlugin`, `basePlugin` (createdBy,
  updatedBy, version, isDeleted) and `auditPlugin`.
- **Indexes:** every index starts with `tenantId`, and each module's `models/` declares them.
  A test fails if a model has an index without `tenantId`.
- **Money and transactions:** money is stored in paise (integers). Multi-document writes use
  `withTransaction()`.
- **Snapshots:** printable documents (bills, reports, prescriptions) keep a copy of patient
  and doctor details as they were at that time.
- **Clinical records are never deleted.** Corrections create a new version.
- **Schema changes** use `migrate-mongo` scripts, run by CI before the new API version
  starts. Migrations never break a running older version (expand, then contract).

---

## 9. "Production-ready" checklist (Definition of Done per module)

A module is merged to `main` and shown to the client only when every box is ticked. The
module's README carries a copy of this list.

**API and data**
- [ ] Every route has a module gate, permission, Zod schema, audit action and an OpenAPI entry
- [ ] Indexes defined (starting with `tenantId`) and checked with `explain()` for the main lists and searches
- [ ] Money and stock writes are transactional and idempotent; counters come from `sequences`
- [ ] Approval rules from the spec are wired (202 + approval banner)
- [ ] Events published through the outbox; handlers are idempotent
- [ ] Seed data for a new tenant and the Excel import template (if the module has masters)

**Screens**
- [ ] Every screen in `screens.md` for this module is built; tabs are kept in the URL
- [ ] All 11 states handled: empty, loading, error, 403, 402, subscription banners, confirm, approval pending, toasts/validation, session expired, offline; plus 409 conflict
- [ ] Patient banner on every patient-context screen; full name + second identifier in lists
- [ ] Keyboard: everything reachable by Tab, visible focus, module shortcuts listed in help
- [ ] Works at 1366 × 768, 1440, and tablet 768 px (and phone where the screen is mobile-first)
- [ ] All strings translated (en + hi); numbers in Indian format (₹1,23,456)
- [ ] Print templates for this module render correctly on A4/A5/80 mm

**Tests**
- [ ] Unit tests: 80% line coverage on services
- [ ] API tests for every route: 401, 402, 403, 422, happy path, and 409 where versioned
- [ ] Tenant isolation: another tenant's IDs return 404 on every route
- [ ] Concurrency tests where there is a race (beds, stock, tokens, counters)
- [ ] Playwright journeys for this module from the spec and the module deep dive, including the alternate flows
- [ ] axe: no serious or critical issues on every page
- [ ] Performance: main list and search p95 within the spec targets on 1 million patient seed data

**Operations**
- [ ] Logs carry requestId, tenantId and userId and never contain patient clinical data
- [ ] Alarms for the module's queues and error rate
- [ ] README updated (owns, events, permissions, jobs, config); user guide page for the role
- [ ] UAT script written; signed by a pilot hospital user before go-live

---

## 10. Quality gates and CI/CD

**On every pull request.** Turborepo runs only for packages that changed:
1. Install with a frozen lockfile and cached pnpm store.
2. Lint (ESLint + Tailwind class order + import boundaries), Prettier check.
3. Unit and component tests with coverage thresholds.
4. API integration tests against a Mongo replica set and Redis in services.
5. Build all apps; bundle-size budget for `web` (initial JS under 250 KB gzip).
6. Route contract test: every route declares module, permission, schema and audit.
7. Security: `pnpm audit` (high = fail), secret scan, licence check.

**On merge to `main`:**
- deploy to staging (web to S3 + CloudFront invalidation, API image to ECR, then an ECS rolling deploy)
- run DB migrations
- Playwright smoke run

**Release:**
- A git tag promotes the same images to production after manual approval.
- Rollback means redeploying the previous task definition and the previous web build
  (kept versioned in S3).

**Nightly:** the full Playwright journey suite, the k6 short profile, and OWASP ZAP baseline
against staging.

**Branching:**
- Short-lived feature branches named `feat/<module>-<slice>`; squash merge.
- Conventional commits (`feat(opd): check-in token print`).
- Small PRs: one slice of one module each.

---

## 11. Environments

| Env | Web | API | Data | Purpose |
|---|---|---|---|---|
| local | Vite dev server | `node --watch` | docker-compose Mongo replica set + Redis | Development |
| dev | `*.dev.example.com` | ECS (1 task) | Atlas M10 | Shared integration |
| staging | `*.staging.example.com` | ECS (2 tasks) | Atlas M10 with anonymised seed | Demos, UAT, nightly tests |
| prod | `*.example.com` + custom domains | ECS (2–6 tasks) | Atlas M30+, PITR backups | Live hospitals |

Separate AWS accounts for non-prod and prod. A pilot or small hospital can use the spec's
"starter setup" (single EC2 + PM2) with the same code.

---

## 12. Risks and how we handle them

| Risk | Mitigation |
|---|---|
| Scope too large for the calendar | Build in the dependency order; each phase ends demoable; change requests go after go-live as the spec says |
| Cross-module coupling creeps in | Import-boundary lint in CI; events through the outbox only |
| Tenant data leak | Plugin-enforced filter + the isolation suite on every route + pen test |
| Clinical safety errors | Shared clinical components (banner, alerts, MAR) built and reviewed once; clinical sign-off per module in UAT |
| External approvals (SMS DLT, WhatsApp, payment gateway, ABDM sandbox) | Request on day 1; console providers in dev; adapters behind interfaces |
| Performance at scale | Index review per module, k6 in nightly, read models for analytics |
| Indian rule changes (GST, IRDAI timelines) | Rates and timelines in configuration tables with effective dates, never in code |

---

## 13. First tasks (Phase 0 backlog, in order)

1. Scaffold the monorepo: `apps/{web,portal,console,api}`, `packages/{shared,ui,i18n,config}`,
   Turborepo, pnpm, ESLint/Prettier, Husky.
2. `infra/docker/docker-compose.yml`: Mongo 8 one-node replica set, Redis 7, Mailpit.
3. API: `config/env.js`, `core/errors`, `core/observability`, `core/db`, `core/tenancy` (from the
   reference code in spec chapter "Reference Source Code"), health route, test helpers.
4. API: `core/auth` + `core/rbac` + login/refresh/logout routes + tests (401/403/isolation).
5. UI: `tokens.css`, Button/Input/Select/FormField/Dialog/Tabs/Toast, StatusBadge, DataTable,
   StateViews, Storybook with axe.
6. Web: AppShell (Sidebar with search and groups, TopBar, CommandPalette), module registry,
   login screens, permission-filtered router.
7. API: `core/audit`, `core/sequences`, `core/approvals`, `core/events` (outbox + relay),
   `core/files`, `core/print`, `core/notify` (console provider), `core/realtime`.
8. CI pipeline (section 10) and Terraform for dev + staging; first deploy.

When Phase 0 is green on staging, start Phase 1 with `platform` → `setup` → `users` →
`patients` → `billing`.

---

## 14. Progress

| Phase | Status | Notes |
|---|---|---|
| 0. Foundation | Mostly built | Done: monorepo, CI, shared package, API kernel (tenancy, auth with 2FA/OTP, RBAC, approvals, audit, numbering, outbox events, realtime, idempotency, rate limits, OpenAPI), S3 file service, PDF print engine, UI kit and web shell. Still to do: Terraform for dev/staging, Sentry/OpenTelemetry, commit hooks, migrations folder |
| 1. Platform and core | Backend built, screens in progress | API done with integration tests: `setup` (hospital, branches, departments, masters, CSV import), `users` (invites, roles, privileged-role approval), `patients` (UHID, duplicates, search, merge, timeline), `billing` (bills, payments, deposits, refunds, credit notes, cashier shifts, PDFs), `platform` (signup and trial, subscription changes with proration, platform GST invoices, console API with 2FA, Razorpay webhook, daily lifecycle job). Screens: setup, users and approvals first; then patients, billing, subscription, signup; then the console app. Deferred: day lock, Hindi PDFs, IGST on inter-state platform invoices, CAPTCHA on signup |
| 2. OPD and front office | Built | API `opd` with integration tests: schedules and slots (fees through the billing tariff and its approval), booking rules R1/R3/R4/R17, check-in with tokens, triage (R12), queue order (R11), consultation with allergy and interaction checks, sign and complete (R13, R14 addenda), referral, admission request, certificates, clinic close-out (bill, payment, receipt), cancellation (R9, rules changed through approval), Queue TV, OPD analytics, patient timeline and merge. Screens: appointments, check-in, triage, consultation, clinic desk, OPD settings, analytics, Queue TV, all on the real API. Front office (tokens, enquiries, passes, locator) and live updates over Socket.IO are in. Still to do: TV display key, voice call-out, patient portal booking |
| 3. IPD, nursing and insurance | Built | API `ipd` with integration tests: bed board and states, admission requests from OPD with estimate and bed hold (R1 to R5), admission, transfer, midnight census room rent on the IP bill, deposit alerts, rounds notes (R10), medicine orders with pharmacist verification (R11) and high-alert second-nurse rule (R12), MAR with wristband check, NEWS2 vitals with RMO alert, intake-output, discharge summary sign and addenda (R14), final bill, discharge with dues approval (R17), death never held (R18), LAMA (R20), housekeeping, cashless pre-auth with the IRDAI reply clocks, enhancement (R9), final approval, claim and settlement, IPD census and indicators. Screens: bed board, admission, bed requests, rounds, nursing station, discharge, insurance desk, IP bills, IPD settings, IPD analytics, all on the real API. ICU over 6 hours on a transfer day is a full ICU day, otherwise each bed is charged by the hour (built after Phase 7); the pharmacy returns check (R15) is now enforced by the pharmacy (Phase 4) |
| 4. Diagnostics and stock | Built | API with integration tests. `lab`: orders from OPD (event), wards and the counter; collection with the wristband check (R1) and pay-first (R2), barcodes per container, receipt and rejection (R3), ranges by sex and age (R6), critical calls with read-back and HOD escalation (R7), delta holds (R8), QC with Westgard rules gating the analyser (R4, R5), two-step release (R9), amendments through approval (R10), TAT (R11), no SMS for sensitive tests (R13); cultures with sensitivity and the antibiogram; histopathology cases; TAT and NABL indicators. `radiology`: study master, slot booking with the preparation SMS, contrast consent and creatinine, PCPNDT Form F and register, template reports with sign-off by another radiologist, addenda, PACS link. `inventory`: item master with GST (5%, 0% for life-saving drugs), stores, vendors, batch stock with FEFO and expired batches blocked, the ledger, POs and GRNs through approval, indents, transfers, counts through approval, reorder, expiry and dead-stock reports. `pharmacy`: queue from OPD prescriptions and ward orders, dispensing with substitution consent, H1/X/narcotic prescriber rules and registers, the child weight check, sales on OP bills at MRP and ward issues on the IP bill, ward returns before the final bill. Screens: lab worklists, collection and receipt, report, QC, settings, analytics, microbiology, histopathology; radiology; pharmacy; inventory; lab and imaging tabs on rounds. Still to do: home collection phone app, send-out labs, analyser and DICOM interfaces, lab and imaging results inside the OPD consultation |
| 5. HR, payroll and finance | Built | API with integration tests (`people-money`: three sample employees paid exactly as calculated by hand; trial balance and balance sheet balance after the test month). `hr`: employee master (Aadhaar never stored, bank masked), leave types and balances, leave with balance, overlap and roster-cover checks, manager or HR approval (not self), biometric punch import, corrections, month lock for payroll (missing days become absent), rosters with cover per shift, swaps, registration expiry alerts, My Space (`/me`). `payroll`: salary structures through approval (HR, then Super Admin), loans and advances, runs from locked attendance with LOP proration, overtime, night allowance, PF (ceiling), ESI (wage limit, rounded up), PT (MH/KA slabs, February), TDS (new and old regime, FY 2025-26, rebate with marginal relief), variance against last month, release through HR then Finance, bank file, PF ECR, payslips for the employee. `finance`: chart of accounts, balanced idempotent journals posted from bills, receipts, deposits, refunds, GRNs, payroll and loan disbursal; vouchers (a manual journal goes for approval); trial balance, P&L, balance sheet, ledgers, GST summary; month close and Super Admin reopen. Screens: HR, Roster, Payroll, Finance, My Space. Fixed on the way: BullMQ job ids may not contain `:` (the outbox relay had stalled). Deferred: Form 16 and 24Q, gratuity and bonus, bank reconciliation, depreciation |
| 6. Support modules and analytics | Built | API with integration tests for each module. `mrd`: completion checklist opened at discharge, deficiencies by doctor, ICD-10 coding that closes the record, physical files, release of information through Medical Superintendent approval with a copy-fee bill, birth, death (MCCD, mortuary, police-only handover in MLC) and MLC registers, monthly statistics. `diet`: default diet on admission, orders, nil-by-mouth windows, production sheet and tray labels, ward delivery, private-room meal charges, missed meals, dietitian notes. `facility`: cleaning rounds with sign-off, linen par and laundry, condemnation through approval, porters, equipment with PM, calibration and AMC, tickets from any user (breakdowns take equipment out of service, downtime recorded), biomedical waste with handover mismatch. `quality`: SMS feedback with a public rating page and NPS, complaints with TAT and escalation, incidents (anonymous allowed) with RCA and CAPA closed through approval, monthly indicators from system data, audits, controlled documents, HAI rates. `crm`: call-centre lookup, leads converted on admission or visit, camps with ROI, consent-aware campaigns, family cards with a wallet billing accepts, referral fee statements. Patient portal (`/my`): OTP sign-in on the registered mobile, family reports, bills, stay and booking. Reports centre: 44 reports registered by their modules, XLSX/PDF exports, schedules, and a live management dashboard on Home. Also fixed: four clashing RTK endpoint names (a test now guards it). Deferred: online payment (needs the gateway), report e-mail (needs a mail service), kitchen stock costing, doctor payouts (MRD destruction and nursing task compliance built after Phase 7), nursing task compliance |
| 7. Hardening and go-live | Built for staging; go-live steps need the hosted setup | Hosting moved off AWS: two folders (`api/` on Render, `web/` on Vercel), Docker and Terraform dropped; the hospital address travels in X-Hms-Host behind the Vercel rewrite, files in MongoDB GridFS, jobs inside the API. Production indexes built at start (`npm run db:indexes`). Security: dependency audit clean in both folders, Content-Security-Policy and HSTS on the web (checked with `vite preview`), API rate limits configurable only for load tests, Super Admin two-factor reset (and a support script for a sole Super Admin). Performance: `npm run load` (autocannon) on the main reads; the home page is cached per user for 20 s; the socket client loads after sign-in (initial JS 237.5 kB). Error tracking with Sentry when a DSN is set, patient data scrubbed. Backups: `db:backup`, `db:restore` (empty databases only), `db:restore-drill` (local: 177 collections matched). Runbook and UAT scripts in `docs/operations/`. Pre-commit hook in `.githooks/`. Still to do on the hosted setup: load test on the staging instance size, external pen test, Atlas backups, on-call rota, pilot UAT and parallel run |

### Decisions (2026-10-11)

- **Queue TV display key:** one key per TV, per branch, created in OPD settings and shown once
  (only its hash is stored); the TV sees tokens and rooms only, with no sign-in. Keys can be
  switched off at once. Voice call-out in English and Hindi.
- **Sales and plans:** platform Sales can view plans and prices and manage subscriptions
  (including negotiated prices), but cannot edit the price book; only the platform Super Admin can.
- **One subscription for all modules:** offered as the "Hospital" plan (every module, one
  monthly price) and "Enterprise" (every module, by quote), alongside module-by-module pricing.
