# UI gaps against the design (scan of 11 Oct 2026)

Every board in `docs/ui-design/boards` was compared with the built web app: screens in the catalogue without a page, and tabs on a board with no matching section in the built page. Tick items as they land.

## A. Screens with no page

| # | Board | Route | Backend | Status |
|---|---|---|---|---|
| A1 | Platform console: tenants, tenant detail, invoices | console `/`, `/tenants/:id`, `/invoices` | exists (`/api/platform`) | Built: dashboard, hospitals, trials, subscriptions, tenant page, billing. Usage, support, releases and platform users need their API first |
| A2 | Billing analytics | `/billing/analytics` | new `GET /billing/analytics` | Built |
| A3 | Billing settings | `/settings/billing` | new billing settings record (`/billing/settings`) | Built: modes, numbering, price lists, payers, tax, approval rules, cash and print settings (enforced at shift close and on PDFs) |
| A4 | Setup wizard | `/setup` | existing setup APIs | Built: nine steps with status from live data, bulk bed generation; integrations shown as not connected |
| A5 | Role home pages (one per role) | `/` | new `GET /home?panel=` with widgets registered by each module | Built: 90 widgets over 27 role panels (KPIs, worklist, alerts) and quick actions |
| A6 | Corporate and credit | `/billing/corporates` | new: credit bills, corporate invoices, receipts, letters of credit | Built: credit bills with limit and hold, monthly invoices, receipts posted to the books, statement, ageing, letters of credit; e-invoice IRNs wait for a GST provider |
| A7 | Phlebotomist phone screens | `/lab/home-visits` | new: home visits | Built: booking (orders the tests), assignment, start, collection after the UHID scan once paid, hand-over; phone-sized cards |

## B. Sections missing inside built screens

| # | Screen | Missing | Backend |
|---|---|---|---|
| B1 | Finance | Payables, receivables, budgets, petty cash, doctor payouts | Built |
| B2 | HR | Recruitment, training, appraisal, exits | Built |
| B3 | Lab QC | QC lots, Westgard rules, EQAS, calibration and maintenance | Built |
| B4 | Lab samples | Counter collection, rejections today, send-outs, storage | Built |
| B5 | Lab settings | Partner labs, home collection, report templates | Built |
| B6 | Microbiology | Media QC, infection alerts | Built |
| B7 | Histopathology | Special stains, turnaround | Built |
| B8 | Diet | Menu and diet master, meal billing | partly | Built: diet master (energy, restrictions, menu per meal) and the day's meal billing by stay |
| B9 | My Space | Overview, tax declaration, profile | new | Built: overview; tax declarations (used for TDS, reviewed by payroll); profile changes through HR approval |
| B10 | Patient profile | Consents | new | Built: consent register (type, channel, validity, withdrawal); messaging consents drive CRM opt-outs |
| B11 | Hospital settings | Print templates, message templates, integrations, security, data export, help | Built |
| B12 | Cashier shift | Card and UPI settlement, bank deposits | new | Built: settlement matching (MDR within 3%), deposit slips (cash posted to the bank), and the day lock |
| B13 | Audit log | Logins, patient record access, daily exceptions | audit data exists | Built |
| B14 | Inventory | Store transfers, requisitions | transfers exist | Built: requisitions (manual or from reorder levels, to a PO or rejected) and the transfer register with a transfer form |
