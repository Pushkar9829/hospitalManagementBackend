# Hospital Management System - UI/UX design

The full clickable design lives on a design canvas:
https://claude.ai/artifact/Fnp7CKPFT5jbiEFyMFNRq2
(private until the owner shares it from the canvas Share menu).

It has 158 boards on 19 pages, and 28 role panels (each role has its own home page, menu and data scope):

| Page | Boards |
|---|---|
| Phase 0 · Foundations | Overview, design system, login and 2FA |
| Role Panels | Role panel map, a home dashboard for each of 25 roles (including Head of Department, Security Desk, Home Collection, Auditor and Insurance Desk) and the clinic one-screen desk |
| OPD 1 · Module flow end to end | OPD overview and competitor benchmark, swimlane flow, alternate flows, status lifecycles, rules and tests, OPD settings, OPD analytics |
| OPD 2 · Role-wise flows | OPD flow for patient, call centre, front office, cashier, nurse, doctor, pharmacy and lab, OPD admin, management, with their screens |
| IPD 1 · Module flow end to end | IPD overview and competitor benchmark, swimlane flow (admission advice to bed turnaround), 13 alternate flows, status lifecycles, rules and tests, IPD settings, IPD analytics |
| IPD 2 · Role-wise flows | IPD flow for patient and attendant, admission desk, insurance (TPA) desk, bed manager, nurse, doctor, pharmacy-lab-diet, in-patient billing, housekeeping, IPD admin, management, with attendant mobile screens, bed requests, TPA desk and in-patient bill |
| Billing 1 · Module flow end to end | Billing overview and competitor benchmark, swimlane flow (charge to ledger), 14 alternate flows, status lifecycles, rules and tests, billing settings, billing analytics |
| Billing 2 · Role-wise flows | Billing flow for patient and payer, cashier, billing manager, corporate desk, insurance desk, pharmacy counter, accounts, auditor, management, with patient payment screens, cashier shift and corporate credit desk |
| Lab 1 · Module flow end to end | Laboratory overview and competitor benchmark, swimlane flow (order to report), 13 alternate flows, status lifecycles, rules and tests, lab settings (test master, critical values, analysers), lab analytics |
| Lab 2 · Role-wise flows | Laboratory flow for patient, doctor, ward nurse, home collection, lab reception, technician, pathologist, lab in-charge, management, with sample receipt, QC, microbiology, histopathology and phlebotomist phone screens |
| Phase 1 · SaaS Platform | Pricing and signup, setup wizard, platform console, tenant detail, hospital subscription |
| Phase 2 · Security & Core | Dashboard, approvals, reports, audit log, hospital settings, users, roles, departments and masters |
| Phase 3 · Patient Operations | Registration, patient profile, front office, OPD, consultation, admission, bed board, discharge desk, queue TV |
| Phase 4 · Clinical | Doctor in-patient rounds, nursing station, shift roster |
| Phase 5 · Diagnostics | Laboratory, radiology, pharmacy |
| Phase 6 · Billing, Finance & People | Billing, finance, inventory, HR, payroll, employee self-service |
| Phase 7 · Support & Engagement | Medical records, diet, facility, quality, CRM, patient portal (mobile) |
| Print Templates | IPD bill A4, OPD receipt 80 mm, prescription A5, lab report A4, discharge summary A4 |
| Developer Handoff | Build guide (tokens, components, screen inventory, rules), screen states |

## Files here

- `../modules/OPD.md`: full OPD module specification (flows, rules, roles, tests, benchmark).
- `../modules/IPD.md`: full IPD module specification (admission to discharge, insurance, beds, billing, roles, tests, benchmark).
- `../modules/LAB.md`: full Laboratory (LIS) specification (order to report, QC, microbiology, histopathology, roles, tests, benchmark).
- `../modules/BILLING.md`: full Billing, Payments and Insurance specification (charge to ledger, shifts, corporate credit, GST, roles, tests, benchmark).
- `panels.md`: every role panel with its home page, menu and data scope. Start here.
- `screens.md`: every screen with route, role, module, permission and APIs.
- `tokens.json`: colours, type, spacing and radius. In code they become `packages/ui/src/tokens.css` (Tailwind v4); see `../implementation/PLAN.md`. Where a board still mentions MUI, the plan's Tailwind stack replaces it.
- `boards/`: the source of every board (`.dc.html`). They run inside the design canvas,
  not as standalone pages; open the canvas link to view and click through them.
- `source/`: the building blocks used to generate the app-screen boards
  (shared shell, per-screen body, per-screen data). `python3 source/build.py <Name> ...`
  rebuilds one board using the arguments listed in `source/screens.tsv` and `source/homes.tsv`;
  role menus come from `source/parts/panels.json`. `source/opd/`, `source/ipd/`, `source/bill/` and `source/lab/` generate the
  module flow diagrams and role boards (`python3 source/bill/flow.py boards`, and so on);
  `source/mkmodule.py` and `source/mkrules.py` build the overview and rules boards, `<module>/mkdoc.py`
  regenerates the module specification, and `source/syncdocs.py` refreshes the panel map, panels.md and screens.md.

The functional specification, API documentation and deployment guide are in
`../Hospital_Management_System_Phase1_Specification.pdf`.
