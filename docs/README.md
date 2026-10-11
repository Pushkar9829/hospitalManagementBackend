# Hospital Management System - Phase 1 Specification

`Hospital_Management_System_Phase1_Specification.pdf` is the full Phase 1 product and technical
specification for the multi-tenant SaaS hospital management system. It covers:

- Module catalogue, module-wise subscription plans, pricing model and enforcement rules
- SaaS platform: self-service signup, tenant provisioning, subscription billing with
  proration and GST, metering, custom domains, Platform Console, SaaS metrics, SLAs,
  platform APIs and code
- Roles, permissions, logins, maker-checker and Super Admin approvals
- Every Phase 1 module with features, user flows, business rules and reports:
  Core setup and departments, patient registration, OPD, IPD and real-time beds,
  nursing, doctor scheduling, rosters, laboratory, radiology, pharmacy, billing,
  finance, inventory, HR, recruitment, training, attendance, leave and payroll,
  medical records with birth, death and medico-legal registers, diet and kitchen,
  housekeeping, linen, maintenance, biomedical equipment and waste, quality and
  incidents, infection control, front office and counter tokens, patient portal,
  health check-ups, specialty templates, treatment plans, lab home collection, ICU
  charting, ABDM integration, and patient CRM and outreach
- Delivery plan: 1 month, INR 1,00,000 + GST, with delivery assumptions and milestones
- End-to-end journeys across modules and the screen map
- Architecture (React, Node.js, MongoDB), database design and reference source code
- REST API documentation with request and response examples
- AWS deployment (React on S3 + CloudFront, API on ECS Fargate), CI/CD, security,
  non-functional requirements, testing, delivery plan and acceptance criteria

## Module deep dives

Module-by-module specifications that go deeper than the PDF, with end-to-end and role-wise flows,
rules, settings, notifications, reports, formulas, edge cases, acceptance tests and a competitor
benchmark. Each has matching boards on the design canvas (see `ui-design/README.md`).

- `modules/OPD.md`: OPD and Appointments
- `modules/IPD.md`: IPD, admission to discharge (beds, insurance and TPA, ward care, billing)
- `modules/BILLING.md`: Billing, Payments and Insurance (charge to ledger, cashier shifts, corporate credit, GST)
- `modules/LAB.md`: Laboratory (order to report, sample receipt, QC, microbiology, histopathology, home collection)

## Implementation plan

`implementation/PLAN.md` turns the spec and the UI design into code: the React + Tailwind,
Node + Express and MongoDB stack; the monorepo, backend module and frontend module folder
structures; design tokens; the shared building blocks every module uses; build phases in
dependency order; the per-module "production-ready" checklist; CI/CD; and the first Phase 0
tasks.

## Regenerating the PDF

The PDF is generated from the Python sources in `spec-src/` with ReportLab.

```bash
pip install reportlab
python3 docs/spec-src/build.py
```

Each chapter lives in its own `c*.py` file. Shared styles and diagram helpers are in
`spec-src/kit.py`.
