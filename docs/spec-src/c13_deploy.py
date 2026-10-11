from kit import *
from reportlab.platypus import PageBreak


def deploy():
    s = []
    s += H1("Deployment on AWS (S3, CloudFront, ECS)")
    s += H2("Environments")
    s += table([
        ["Environment", "URL pattern", "Purpose", "Deploys"],
        ["dev", "*.dev.example.com", "Developer integration", "Every merge to develop"],
        ["staging", "*.staging.example.com", "QA, UAT with client, demo", "Release branch"],
        ["production", "*.example.com + custom domains", "Live hospitals",
         "Tagged release, manual approval"],
    ], widths=[0.15, 0.3, 0.3, 0.25])

    s += H2("One-time AWS setup")
    s += numbered([
        "Create three AWS accounts (dev, staging, prod) under AWS Organizations; enable "
        "CloudTrail, GuardDuty and AWS Config in all.",
        "Register domain in Route 53. Request a wildcard ACM certificate for "
        "*.example.com in <b>us-east-1</b> (required by CloudFront) and one in ap-south-1 "
        "for the ALB.",
        "Apply Terraform in infra/ to create: VPC (2 public, 2 private subnets), S3 web "
        "buckets, S3 documents bucket with KMS key, CloudFront distributions with OAC, "
        "ALB, ECS cluster and services, ECR repositories, ElastiCache Redis, Secrets "
        "Manager entries, IAM roles, CloudWatch alarms, WAF.",
        "Create the MongoDB Atlas project in Mumbai, an M30 cluster, PrivateLink endpoint "
        "into the VPC, database user with least privilege, continuous backup on.",
        "Store secrets (Mongo URI, JWT keys, SMS and payment keys) in Secrets Manager; ECS "
        "injects them as environment variables at task start.",
        "Create a GitHub OIDC role per account so GitHub Actions deploys without long-lived "
        "AWS keys.",
    ])

    s += H2("React app on S3 and CloudFront")
    s += code("""
# Build
pnpm --filter web build                 # outputs apps/web/dist (index.html + hashed assets)

# Upload hashed assets with long cache, then index.html with no cache
aws s3 sync apps/web/dist s3://hms-web-prod \\
  --delete --exclude index.html \\
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp apps/web/dist/index.html s3://hms-web-prod/index.html \\
  --cache-control "no-cache,no-store,must-revalidate" --content-type text/html

# Only index.html needs invalidation because assets have content hashes
aws cloudfront create-invalidation --distribution-id E1ABCDEF2GHIJK --paths "/index.html"
""", "Manual deployment commands")
    s += code("""
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontOAC",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::hms-web-prod/*",
    "Condition": { "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/E1ABCDEF2GHIJK" } }
  }]
}
""", "S3 bucket policy: only CloudFront can read (bucket stays private)")
    s += table([
        ["CloudFront setting", "Value"],
        ["Origins", "S3 web bucket (OAC); ALB (HTTPS only, custom header secret so ALB "
                    "rejects direct traffic)"],
        ["Default behaviour", "S3, CachingOptimized, redirect HTTP to HTTPS, compress"],
        ["/api/*", "ALB, CachingDisabled, origin request policy AllViewer (forwards Host "
                   "header for tenant resolution), all HTTP methods"],
        ["/socket.io/*", "ALB, CachingDisabled, WebSocket allowed"],
        ["Custom errors", "403 and 404 from S3 return /index.html with 200 so React "
                          "Router deep links work"],
        ["Security headers", "Response headers policy: HSTS, CSP, X-Frame-Options DENY, "
                             "Referrer-Policy"],
        ["Alternate names", "*.example.com plus each hospital's custom domain"],
        ["WAF", "AWS managed core rule set, SQLi, known bad inputs, IP rate limiting"],
    ], widths=[0.25, 0.75], first_col_bold=True)

    s += H2("API and worker containers")
    s += code("""
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter api build && pnpm --filter api deploy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /out .
USER app
EXPOSE 4000
HEALTHCHECK CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "dist/server.js"]        # worker task overrides with dist/worker.js
""", "apps/api/Dockerfile")

    s += H2("CI/CD with GitHub Actions")
    s += code("""
name: deploy-web
on:
  push:
    branches: [main]
    paths: ['apps/web/**', 'packages/**']
permissions: { id-token: write, contents: read }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production                 # requires manual approval in GitHub
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter web lint && pnpm --filter web test -- --run
      - run: pnpm --filter web build
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-deploy-web
          aws-region: ap-south-1
      - run: |
          aws s3 sync apps/web/dist s3://${{ vars.WEB_BUCKET }} --delete \\
            --exclude index.html --cache-control "public,max-age=31536000,immutable"
          aws s3 cp apps/web/dist/index.html s3://${{ vars.WEB_BUCKET }}/index.html \\
            --cache-control "no-cache,no-store,must-revalidate"
          aws cloudfront create-invalidation \\
            --distribution-id ${{ vars.CF_DISTRIBUTION_ID }} --paths "/index.html"
""", ".github/workflows/deploy-web.yml")
    s += code("""
name: deploy-api
on:
  push:
    branches: [main]
    paths: ['apps/api/**', 'packages/**']
permissions: { id-token: write, contents: read }
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mongo: { image: 'mongo:8', ports: ['27017:27017'], options: '--replSet rs0' }
      redis: { image: 'redis:7', ports: ['6379:6379'] }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: docker exec $(docker ps -qf ancestor=mongo:8) mongosh --eval 'rs.initiate()'
      - run: pnpm --filter api lint && pnpm --filter api typecheck
      - run: pnpm --filter api test -- --run
  deploy:
    needs: test
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-deploy-api
          aws-region: ap-south-1
      - id: ecr
        uses: aws-actions/amazon-ecr-login@v2
      - run: |
          IMAGE=${{ steps.ecr.outputs.registry }}/hms-api:${{ github.sha }}
          docker build -f apps/api/Dockerfile -t $IMAGE .
          docker push $IMAGE
          echo "IMAGE=$IMAGE" >> $GITHUB_ENV
      - run: pnpm --filter api migrate:up      # idempotent index + data migrations
      - run: |
          for svc in api worker; do
            ./infra/scripts/ecs-deploy.sh hms-prod hms-$svc "$IMAGE"
          done                                  # rolling update, circuit breaker rollback
""", ".github/workflows/deploy-api.yml")

    s += H2("Environment variables")
    s += table([
        ["Variable", "Example / source", "Notes"],
        ["NODE_ENV", "production", ""],
        ["MONGO_URI", "Secrets Manager", "Atlas PrivateLink SRV string"],
        ["REDIS_URL", "rediss://...:6379", "TLS"],
        ["JWT_PRIVATE_KEY / JWT_PUBLIC_KEY", "Secrets Manager", "RS256, rotated yearly"],
        ["S3_DOCS_BUCKET", "hms-docs-prod", "Access via ECS task role"],
        ["ROOT_DOMAIN", "example.com", "Tenant resolution"],
        ["SMS_PROVIDER, SMS_API_KEY", "msg91 / Secrets Manager", "DLT templates in DB"],
        ["SES_FROM", "no-reply@example.com", "Verified domain"],
        ["RAZORPAY_KEY_ID / SECRET", "Secrets Manager", "Patient and SaaS payments"],
        ["SENTRY_DSN", "Secrets Manager", "Error tracking"],
        ["VITE_SENTRY_DSN, VITE_APP_VERSION", "Build-time (web)", "No secrets in web build"],
    ], widths=[0.33, 0.3, 0.37], mono_cols=(0,))

    s += H2("Release and rollback")
    s += bullets([
        "Database changes are backwards compatible (expand, then contract), so the old API "
        "version can run against the new schema during rolling deploys.",
        "ECS deployment circuit breaker rolls back automatically if new tasks fail health "
        "checks.",
        "Web rollback: re-run the deploy job for the previous Git tag; S3 versioning also "
        "allows restoring the previous index.html in seconds.",
        "Feature flags per tenant allow releasing to one pilot hospital first.",
        "Production deploys happen in a low-traffic window (02:00-05:00 IST) with a "
        "status page notice for planned downtime, which should be zero for normal releases.",
    ])
    return s


def security():
    s = []
    s += H1("Security, Compliance and Operations")
    s += H2("Security controls")
    s += table([
        ["Area", "Control"],
        ["Transport", "TLS 1.2+ everywhere, HSTS, internal traffic in private subnets"],
        ["Data at rest", "Atlas encryption, S3 SSE-KMS, encrypted EBS / Redis; field-level "
                         "encryption for Aadhaar, PAN and bank account numbers"],
        ["Application", "OWASP ASVS L2 checklist; Helmet headers; Zod validation on every "
                        "input; Mongo operator injection blocked (sanitize $ keys); output "
                        "encoding in React"],
        ["Authentication", "Argon2id, 2FA, lockout, refresh token rotation with reuse "
                           "detection, session revocation on password change"],
        ["Authorization", "Server-side RBAC on every route; tenant plugin on every query; "
                          "automated tests that try cross-tenant access"],
        ["Files", "Type and size allow-list, antivirus scan (ClamAV Lambda) before file is "
                  "marked available, presigned URLs only"],
        ["Secrets", "Secrets Manager; no secrets in code, images or web build"],
        ["Dependencies", "Dependabot, npm audit in CI, container image scanning in ECR"],
        ["Testing", "Annual third-party penetration test; OWASP ZAP baseline in CI"],
        ["People", "Least-privilege IAM, SSO with MFA for engineers, production access "
                   "via break-glass role with alerts"],
    ], widths=[0.2, 0.8], first_col_bold=True)

    s += H2("Compliance")
    s += bullets([
        "<b>DPDP Act 2023 (India).</b> Consent capture at registration, purpose limitation, "
        "data principal rights (access, correction, erasure where law permits), breach "
        "notification process, data processing agreement with each hospital.",
        "<b>Clinical record retention.</b> Medical records retained per state rules and "
        "hospital policy (commonly 3 years for OPD, longer for IPD and medico-legal cases). "
        "Retention is configurable per record type.",
        "<b>ABDM readiness.</b> ABHA number captured; Phase 1 data model maps to FHIR "
        "resources so ABDM health-record sharing can be added.",
        "<b>NABH support.</b> Audit trails, consent, medication safety checks, critical "
        "value alerts and indicator reports support NABH documentation.",
        "<b>HIPAA-style safeguards.</b> Access logs, minimum necessary access and encryption "
        "make the product suitable for international clients later.",
        "<b>Data residency.</b> All Indian tenant data stays in the Mumbai region.",
    ])

    s += H2("Backup and disaster recovery")
    s += table([
        ["Item", "Policy"],
        ["MongoDB", "Continuous backup with point-in-time restore (last 7 days), daily "
                    "snapshots kept 35 days, monthly kept 1 year; copy to Hyderabad region"],
        ["S3 documents", "Versioning, cross-region replication to ap-south-2, object lock "
                         "for audit exports"],
        ["Targets", "RPO 15 minutes, RTO 4 hours for full region loss; RTO 30 minutes for "
                    "a single-AZ failure (automatic)"],
        ["Restore drills", "Quarterly restore test into staging, documented"],
        ["Tenant export", "Self-service full export for the hospital, any time"],
    ], widths=[0.2, 0.8], first_col_bold=True)

    s += H2("Monitoring and support")
    s += bullets([
        "Structured JSON logs (Pino) with requestId and tenantId to CloudWatch Logs; "
        "PHI is never written to logs.",
        "Alarms: API 5xx above 1%, p95 latency above 800 ms, queue depth, failed jobs, "
        "Mongo CPU and connections, low disk, certificate expiry.",
        "Sentry for front-end and back-end errors with release tracking.",
        "Uptime checks on each region endpoint; public status page.",
        "Support tiers: L1 hospital super user, L2 product support, L3 engineering. "
        "Severity 1 (hospital cannot bill or admit) response in 30 minutes, 24x7.",
    ])
    return s


def quality():
    s = []
    s += H1("Non-Functional Requirements and Testing")
    s += H2("Non-functional requirements")
    s += table([
        ["Category", "Requirement"],
        ["Availability", "99.9% monthly for production (about 43 minutes downtime a month)"],
        ["Performance", "p95 API under 300 ms for reads and 600 ms for writes at 200 "
                        "concurrent users per tenant; patient search under 500 ms on 1 "
                        "million patients; bed board update under 1 s"],
        ["Scalability", "500 tenants and 20,000 concurrent users on the shared cluster by "
                        "scaling ECS tasks and Atlas tier; no code change"],
        ["Front-end", "First load under 3 s on 4G; route chunks lazy-loaded; works on "
                      "Chrome, Edge, Firefox, Safari (last 2 versions); tablet 768 px+"],
        ["Usability", "Common counter tasks in 3 clicks or fewer; full keyboard use for "
                      "billing and pharmacy; English and Hindi"],
        ["Accessibility", "WCAG 2.1 AA for colour contrast and keyboard navigation"],
        ["Printing", "Bills and receipts print in under 2 s; thermal and A4 supported"],
        ["Offline", "Short network drops tolerated: forms keep unsaved data locally and "
                    "retry; full offline mode is not in Phase 1"],
        ["Auditability", "100% of create, update, approve, print and export actions logged"],
    ], widths=[0.18, 0.82], first_col_bold=True)

    s += H2("Testing strategy")
    s += table([
        ["Level", "Tool", "Scope and target"],
        ["Unit", "Vitest", "Services and pure functions (payroll, pricing, FEFO, tax): "
                           "80% line coverage on services"],
        ["API integration", "Supertest + Mongo replica set in Docker", "Every route: auth, "
                                                                        "permission, module "
                                                                        "gate, validation, "
                                                                        "happy path"],
        ["Tenant isolation", "Custom suite", "Every endpoint called with another tenant's "
                                             "IDs must return 404"],
        ["Concurrency", "Custom suite", "Parallel bed allocation, stock sale and counter "
                                        "increment never double-allocate"],
        ["End-to-end", "Playwright", f"The journeys in Section {sec('journeys')} run on every release "
                                     "candidate"],
        ["Performance", "k6", "Load profile of a 300-bed hospital at 2x peak"],
        ["Security", "OWASP ZAP, npm audit, pen test", "No high findings open at release"],
        ["UAT", "Pilot hospital", "Signed test scripts per module with client users"],
    ], widths=[0.17, 0.27, 0.56], first_col_bold=True)
    return s


def plan():
    s = []
    s += H1("Phase 1 Delivery Plan, Commercials and Acceptance")
    s += H2("Delivery summary")
    s += kv([
        ["Scope", f"Everything in Sections {sec('product')} to {sec('plan')} of this document: "
                  "all Phase 1 modules, the SaaS platform and console, API, AWS deployment"],
        ["Delivery time", "1 month (4 weeks) from kickoff to production go-live"],
        ["Price", "INR 1,00,000 one-time for Phase 1 delivery, plus GST"],
        ["Go-live", "Production on AWS with the first hospital live at the end of week 4"],
        ["Support", "30 days of post go-live support (hyper-care) included"],
    ])

    s += H2("Delivery squads")
    s.append(P("Work runs in parallel squads that build on the shared Core from week 1. "
               "Each squad owns its modules end to end: API, screens, tests and reports."))
    s += table([
        ["Squad", "Owns"],
        ["Platform", "SaaS platform and console, tenancy, auth, roles, approvals, audit, "
                     "subscription billing, AWS, CI/CD"],
        ["Core and Front Office", "Hospital setup, departments, masters, registration, "
                                  "billing engine, printing, front office, patient portal, "
                                  "CRM"],
        ["Clinical", "OPD, IPD and beds, nursing, doctor scheduling, rosters, diet, medical "
                     "records"],
        ["Diagnostics and Stock", "Laboratory, radiology, pharmacy, inventory and purchase"],
        ["People and Money", "HR, attendance, leave, payroll, finance and accounts"],
        ["Support and Quality", "Housekeeping and facility, quality and incidents"],
        ["QA and Release", "Test automation from day 1, performance, security, UAT, "
                           "deployment"],
    ], widths=[0.24, 0.76], first_col_bold=True)

    s += H2("Four-week plan")
    s += table([
        ["Week", "Days", "Deliverables", "Exit check"],
        ["1", "1-7", "Kickoff and scope freeze; AWS, domain, CI/CD, staging live; design "
                     "system; SaaS tenancy, signup, auth, roles, maker-checker, audit; "
                     "hospital setup, departments, masters with Excel import; patient "
                     "registration; billing engine and printing",
         "Register a patient and print a bill on staging"],
        ["2", "8-14", "OPD scheduling, queue, consultation, e-prescription, specialty "
                      "templates; IPD admission, transfer, discharge, live bed board, insurance and TPA desk, packages and day care; "
                      "nursing station; laboratory; radiology; pharmacy with FEFO; "
                      "inventory and purchase",
         "Full OPD and IPD patient journey on staging"],
        ["3", "15-21", "HR, rosters, attendance, leave; payroll with statutory outputs; "
                       "finance auto-posting and statements; medical records; diet; "
                       "housekeeping and facility; quality; CRM; patient portal; "
                       "subscription billing; all module reports; OPD and IPD analytics",
         "Feature complete; demo to hospital; masters loaded"],
        ["4", "22-30", "UAT with hospital super users; bug fixing; performance and "
                       "security tests; production setup and restore drill; training; data "
                       "migration; go-live and hyper-care start",
         "Acceptance criteria met; hospital live"],
    ], widths=[0.07, 0.08, 0.6, 0.25])
    s += flow([
        ("Day 1", "Kickoff, scope freeze, accounts requested"),
        ("Day 7", "Core, billing and SaaS platform on staging"),
        ("Day 14", "Patient journeys and diagnostics working"),
        ("Day 21", "All modules complete; client demo"),
        ("Day 26", "UAT sign-off; production ready"),
        ("Day 28", "Training complete; data migrated"),
        ("Day 30", "Go-live"),
        ("Day 30-60", "Hyper-care support"),
    ], title="Milestones")

    s += H2("Delivery assumptions")
    s.append(P("The one-month timeline holds when the following are in place. Delays on "
               "these items move the go-live date by the same number of days."))
    s += numbered([
        "Scope is frozen at kickoff as described in this document. New requests are logged "
        "and delivered after go-live as change requests.",
        "The hospital fills the Excel import templates (tariffs, drugs and items with "
        "opening stock, employees and salaries, chart of accounts, opening balances) by "
        "day 10.",
        "One decision-maker on the hospital side answers questions and approves designs "
        "within 24 hours.",
        "Accounts are opened in week 1: AWS, domain, MongoDB Atlas, SMS provider with DLT "
        "template registration, WhatsApp Business, payment gateway, and video provider if "
        "tele-consultation is used. DLT and WhatsApp approvals can take several days, so "
        "they start on day 1.",
        "Hospital super users are available for UAT and training in week 4.",
        "Hardware (printers, barcode scanners, biometric devices, queue TVs) is installed "
        "on site by day 21.",
    ])

    s += H2("Commercials")
    s += table([
        ["Item", "Terms"],
        ["Phase 1 price", "INR 1,00,000 one-time, plus GST at 18%"],
        ["Included", "Design, development, testing, AWS setup, deployment, data import of "
                     "masters, training of super users, documentation, 30 days hyper-care"],
        ["Not included (paid at actuals)", "AWS hosting, MongoDB Atlas, domain, SMS and "
                                           "WhatsApp messages, payment gateway fees, video "
                                           "provider, licensed drug-interaction database, "
                                           "hardware"],
        ["Payment milestones", "40% at kickoff, 30% at week 3 demo, 30% at go-live"],
        ["Change requests", "Estimated and quoted separately; scheduled after go-live"],
        ["After hyper-care", "Annual maintenance and support on a separate agreement, or "
                             "covered by the SaaS subscription for hosted hospitals"],
    ], widths=[0.28, 0.72], first_col_bold=True)

    s += H2("Go-live checklist for each hospital")
    s += numbered([
        "Tenant created with plan, modules, limits and Super Admins.",
        "Hospital profile, branches, departments, wards and beds configured.",
        "Masters imported: services and tariffs, drugs and items with opening stock, "
        "employees, salary structures, chart of accounts with opening balances.",
        "Users created, roles assigned, 2FA enrolled for privileged users.",
        "Print templates and SMS templates approved by the hospital.",
        "Printers, barcode scanners, biometric devices and TV queue screens tested.",
        "Role-wise training completed, with sign-off; super users identified per department.",
        "Parallel run of 2-3 days for billing and pharmacy if migrating from old software.",
        "Go-live day support on site; hyper-care for 30 days.",
    ])

    s += H2("Phase 1 acceptance criteria")
    s += bullets([
        f"Every user flow in Sections {sec('saas')} to {sec('journeys')} runs end to end on staging with the pilot "
        "hospital's own masters.",
        "A module that is not subscribed is invisible in the menu and its API returns 402.",
        f"No maker can approve their own request; all rules in Section {sec('roles')} are enforced.",
        "Bills, receipts, lab reports, discharge summaries and payslips print correctly on "
        "A4 and, where specified, thermal printers.",
        "Payroll for one month matches the hospital's manual calculation for a sample of "
        "50 employees, including PF, ESI, PT and TDS.",
        "Trial balance balances after a full test month of transactions.",
        f"Performance targets in Section {sec('quality')} met; no open high-severity security findings.",
        "Production on AWS with web on S3 + CloudFront, automated deploys, backups and "
        "alarms verified by a restore drill.",
    ])

    s += H2("Glossary")
    s += table([
        ["Term", "Meaning"],
        ["UHID", "Unique Health ID, the hospital's permanent patient number"],
        ["OPD / IPD", "Out-patient department / in-patient department"],
        ["ADT", "Admission, discharge and transfer"],
        ["MAR", "Medication administration record"],
        ["LIS / RIS / PACS", "Laboratory, radiology information systems; picture archiving "
                             "and communication system for images"],
        ["FEFO", "First-expiry-first-out stock picking"],
        ["GRN", "Goods receipt note"],
        ["LOP", "Loss of pay (unpaid days)"],
        ["PF / ESI / PT / TDS", "Provident fund, employee state insurance, professional "
                                "tax, tax deducted at source"],
        ["Maker-checker", "Two-person rule: one proposes, another approves"],
        ["Tenant", "One hospital or hospital group using the SaaS"],
        ["OAC", "CloudFront Origin Access Control, lets CloudFront read a private S3 bucket"],
        ["RPO / RTO", "Maximum data loss / maximum downtime after a disaster"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    return s


def story():
    out = deploy() + [PageBreak()] + security() + [PageBreak()] + quality() + \
        [PageBreak()] + plan()
    return out
