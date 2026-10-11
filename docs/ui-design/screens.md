# Screen inventory

Every screen on the design canvas, with its web route, main role, module gate, permission and main APIs. Role menus are in panels.md.

| Board | File | Route | Primary role | Module | Permission | Main APIs |
|---|---|---|---|---|---|---|
| Overview | boards/Main.dc.html | - | All | - | - | - |
| Design system | boards/DesignSystem.dc.html | - | All | - | - | - |
| Login and 2FA | boards/Login.dc.html | /login | All users | CORE | public | POST /auth/login, /auth/2fa/verify |
| Pricing and signup | boards/Signup.dc.html | www/pricing | Prospect | Platform | public | GET /public/plans, POST /public/signup |
| Setup wizard | boards/SetupWizard.dc.html | /setup | Super Admin | CORE | settings:* | PUT /branches, /departments, POST /masters/{type}/import |
| Platform console | boards/Console.dc.html | console/ | Platform owner | Platform | platform:* | GET /platform/tenants, /platform/metrics |
| Tenant detail | boards/ConsoleTenant.dc.html | console/tenants/:id | Platform owner | Platform | platform:tenant:* | GET /platform/tenants/{id}, POST /platform/tenants/{id}/subscription |
| Role panel map | boards/PanelMap.dc.html | - | Everyone | CORE | - | GET /auth/me (roles, panels, menu) |
| Role home pages (25) | boards/HomeDoctor.dc.html | /home | Each role | CORE | per role | GET /me/home (queue, counts, alerts) |
| Clinic desk (one-screen mode) | boards/ClinicDesk.dc.html | /clinic | Clinic doctor and admin | OPD | opd:*, billing:bill:create | GET /opd/queue, PUT /opd/visits/{id}/consultation, POST /billing/bills |
| Subscription | boards/Subscription.dc.html | /settings/subscription | Super Admin | CORE | settings:subscription:read | GET /subscription, POST /subscription/preview |
| Admin dashboard | boards/Dashboard.dc.html | / | Admin | CORE | dashboard:admin:read | GET /dashboard/summary |
| Approvals | boards/Approvals.dc.html | /approvals | Checkers | CORE | approvals:inbox:read | GET /approvals, POST /approvals/{id}/decision |
| Reports | boards/Reports.dc.html | /reports | Managers | All | reports:{module}:read | GET /reports/{code}, POST /reports/{code}/export |
| Audit log | boards/AuditLog.dc.html | /audit | Super Admin | CORE | audit:log:read | GET /audit |
| Hospital settings | boards/Settings.dc.html | /settings | Super Admin | CORE | settings:hospital:* | GET/PUT /settings, /branches, /templates |
| Users | boards/Users.dc.html | /settings/users | Admin | CORE | settings:user:* | CRUD /users |
| Roles and access | boards/Roles.dc.html | /settings/roles | Super Admin | CORE | settings:role:* | CRUD /roles |
| Departments and masters | boards/Departments.dc.html | /settings/masters | Admin | CORE | settings:master:* | CRUD /departments, /masters/{type} |
| Patient registration | boards/Patients.dc.html | /patients/new | Front Office | CORE | patients:patient:create | GET /patients?q=, POST /patients |
| Patient profile | boards/PatientProfile.dc.html | /patients/:id | Clinical, front office | CORE | patients:patient:read | GET /patients/{id}, /patients/{id}/timeline |
| Front office | boards/FrontOffice.dc.html | /front-office | Front Office | CORE | frontoffice:* | POST /front-office/tokens, /passes |
| OPD check-in | boards/OpdCheckin.dc.html | /opd/check-in | Front Office | OPD | opd:visit:create | GET /opd/appointments?date=today, POST /opd/appointments/{id}/check-in |
| OPD triage | boards/OpdTriage.dc.html | /opd/triage | Staff Nurse | OPD | opd:vitals:create | GET /opd/queue?stage=triage, POST /opd/visits/{id}/vitals |
| OPD settings | boards/OpdConfig.dc.html | /settings/opd | Hospital Admin | OPD | opd:schedule:*, opd:settings:* | CRUD /opd/schedules, PUT /opd/settings |
| OPD analytics | boards/OpdAnalytics.dc.html | /opd/analytics | Management | OPD | reports:opd:read | GET /reports/opd-wait-times, /reports/opd-doctor-performance |
| Patient mobile booking | boards/PortalBooking.dc.html | /my/book | Patient | CORE | patient OTP | GET /public/doctors, POST /portal/appointments, POST /portal/payments |
| OPD appointments | boards/Opd.dc.html | /opd | Front Office | OPD | opd:appointment:* | GET /opd/slots, POST /opd/appointments |
| Consultation | boards/Consult.dc.html | /opd/visits/:id | Doctor | OPD | opd:consultation:write | PUT /opd/visits/{id}/consultation |
| In-patient rounds | boards/IpdRounds.dc.html | /ipd/rounds | Doctor | IPD | ipd:note:write, orders:* | GET /ipd/admissions?doctor=me, POST /orders |
| Admission | boards/Admission.dc.html | /ipd/admit | Admission Desk | IPD | ipd:admission:create | POST /ipd/admissions |
| Bed board | boards/Beds.dc.html | /ipd/beds | Admission Desk | IPD | ipd:bed:read | GET /ipd/beds + socket bed:update |
| Discharge desk | boards/Discharge.dc.html | /ipd/discharge | Doctor, billing | IPD | ipd:discharge:* | PUT /ipd/admissions/{id}/discharge-summary |
| Bed requests and transfers | boards/IpdBedRequests.dc.html | /ipd/bed-requests | Ward In-charge, Admission Desk | IPD | ipd:bed:allocate | GET /ipd/bed-requests, POST /ipd/bed-requests/{id}/reserve, POST /ipd/transfers |
| Insurance and TPA desk | boards/IpdTpa.dc.html | /ipd/insurance | Billing Manager (TPA desk) | IPD | ipd:preauth:* | GET /ipd/preauths?open=true, POST /ipd/preauths/{id}/enhancements, POST /ipd/claims |
| In-patient bill | boards/IpdBill.dc.html | /ipd/bills | Cashier | IPD | billing:ip:* | GET /ipd/admissions/{id}/bill, POST /ipd/admissions/{id}/final-bill |
| IPD settings | boards/IpdConfig.dc.html | /settings/ipd | Hospital Admin | IPD | ipd:settings:* | CRUD /ipd/wards, /ipd/beds, /ipd/packages, PUT /ipd/settings |
| IPD analytics | boards/IpdAnalytics.dc.html | /ipd/analytics | Management | IPD | reports:ipd:read | GET /reports/ipd-census, /reports/ipd-indicators |
| Attendant mobile screens | boards/PortalStay.dc.html | /my/stay | Patient, attendant | CORE | patient OTP | GET /portal/admissions/current, /portal/admissions/{id}/bill, POST /portal/payments |
| Cashier shift and day-end | boards/BillShift.dc.html | /billing/shift | Cashier, Billing Manager | CORE | billing:shift:* | POST /billing/shifts, POST /billing/shifts/{id}/close, POST /billing/days/{date}/lock |
| Corporate and credit | boards/BillCorporate.dc.html | /billing/corporates | Billing Manager | CORE | billing:corporate:* | GET /billing/corporates, POST /billing/corporate-invoices, POST /billing/einvoice/{id} |
| Billing settings | boards/BillConfig.dc.html | /settings/billing | Hospital Admin | CORE | billing:settings:* | PUT /billing/settings, CRUD /billing/series, /billing/price-lists |
| Billing analytics | boards/BillAnalytics.dc.html | /billing/analytics | Management, Accounts | CORE | reports:billing:read | GET /reports/revenue, /reports/receivables-ageing, /reports/leakage |
| Patient payments on the phone | boards/PortalPay.dc.html | /my/bills | Patient | CORE | patient OTP | GET /portal/bills, POST /portal/payments, GET /portal/receipts |
| Sample collection and receipt | boards/LabSample.dc.html | /lab/samples | Lab reception, nurse | LAB | lab:sample:* | GET /lab/samples?status=in-transit, POST /lab/samples/{id}/accept, POST /lab/samples/{id}/reject |
| Quality control | boards/LabQC.dc.html | /lab/qc | Lab technician, pathologist | LAB | lab:qc:* | POST /lab/qc/runs, GET /lab/qc/levey-jennings?control= |
| Microbiology | boards/LabMicro.dc.html | /lab/micro | Microbiologist | LAB | lab:micro:* | GET /lab/cultures, POST /lab/cultures/{id}/readings, POST /lab/cultures/{id}/sensitivity |
| Histopathology | boards/LabHisto.dc.html | /lab/histo | Pathologist | LAB | lab:histo:* | GET /lab/histo/cases, PUT /lab/histo/cases/{id}, POST /lab/histo/cases/{id}/release |
| Lab settings | boards/LabConfig.dc.html | /settings/lab | Lab in-charge | LAB | lab:settings:* | CRUD /lab/tests, /lab/ranges, /lab/critical-values, /lab/partners |
| Lab analytics | boards/LabAnalytics.dc.html | /lab/analytics | Management, lab in-charge | LAB | reports:lab:read | GET /reports/lab-tat, /reports/lab-indicators |
| Phlebotomist phone screens | boards/PhleboPhone.dc.html | app /visits | Phlebotomist | LAB | lab:homevisit:* | GET /lab/home-visits?mine=today, POST /lab/home-visits/{id}/collect |
| Nursing station | boards/Nursing.dc.html | /nursing/:wardId | Staff Nurse | NUR | nursing:* | GET /nursing/wards/{id}/census, POST /nursing/mar/{doseId}/administer |
| Shift roster | boards/Roster.dc.html | /hr/rosters | Ward In-charge | HRM | hr:roster:write | GET/PUT /hr/rosters |
| Laboratory | boards/Lab.dc.html | /lab | Lab, pathologist | LAB | lab:* | GET /lab/worklists, PUT /lab/tests/{id}/results |
| Radiology | boards/Radiology.dc.html | /radiology | Radiologist | RAD | rad:* | PUT /rad/studies/{id}/report, POST /sign |
| Pharmacy | boards/Pharmacy.dc.html | /pharmacy | Pharmacist | PHR | pharmacy:* | GET /pharmacy/rx-queue, POST /pharmacy/sales |
| Billing counter | boards/Billing.dc.html | /billing | Cashier | CORE | billing:* | POST /billing/bills, /bills/{id}/payments |
| Finance | boards/Finance.dc.html | /finance | Accountant | FIN | finance:* | GET /finance/trial-balance, POST /finance/vouchers |
| Inventory | boards/Inventory.dc.html | /inventory | Store Keeper | INV | inventory:* | GET /inventory/stock, POST /inventory/purchase-orders |
| HR | boards/Hr.dc.html | /hr | HR Manager | HRM | hr:* | CRUD /hr/employees, POST /hr/leave-requests/{id}/decision |
| Payroll | boards/Payroll.dc.html | /payroll | Payroll Officer | PAY | payroll:* | POST /payroll/runs, GET /payroll/runs/{id} |
| Medical records | boards/Records.dc.html | /records | MRD Officer | MRD | mrd:* | GET /mrd/deficiencies, POST /mrd/births, /mrd/deaths |
| Diet and kitchen | boards/Diet.dc.html | /diet | Dietitian | DIET | diet:* | GET /diet/production, PUT /diet/orders/{id} |
| Facility | boards/Facility.dc.html | /facility | Supervisor | FAC | facility:* | GET /facility/hk-tasks, POST /facility/tickets |
| Quality | boards/Quality.dc.html | /quality | Quality Manager | QLT | quality:* | POST /quality/incidents, GET /quality/indicators |
| Patient CRM | boards/Crm.dc.html | /crm | CRM Executive | CRM | crm:* | CRUD /crm/leads, POST /crm/campaigns |
| My space | boards/MySpace.dc.html | /me | Every employee | HRM | self | GET /payroll/payslips/me, POST /hr/leave-requests |
| Queue TV | boards/QueueTV.dc.html | /display/queue | Display screen | OPD | display token | socket queue:update |
| Patient portal | boards/Portal.dc.html | /my (patient) | Patient | CORE | patient OTP | POST /portal/auth/otp, GET /portal/me/documents |
| Print templates | boards/PrintBill.dc.html | server PDF | - | CORE | billing:bill:print | GET /billing/bills/{id}/pdf |
| Screen states | boards/States.dc.html | - | All | - | - | Error format in API docs |

## Build rules

1. Panels: after login the API returns the user’s roles; the app opens the home page of the primary role. The menu is built only from that panel’s items (see the Role panels page). Users with several roles switch panel from the top bar; the switch changes the menu and home page, never the permissions checked by the server.
2. Routes above are web app paths; API paths are under /api/v1 as in the API documentation.
3. Every screen checks module and permission on the server. The UI hides menu items but never relies on that.
4. Tabs, filters and selected rows live in the URL (?tab=, ?q=, ?id=) so links can be shared and Back works.
5. Tables page on the server: 25 rows default, 100 max. Show the total count.
6. Money is stored in paise and shown with the Indian grouping (₹1,23,456.00). Dates show as 09 Oct 2026; times 24-hour.
7. IDs (UHID, bill, IP, batch) use the mono font so they can be read and copied.
8. A 202 APPROVAL_PENDING response shows the waiting banner from the Screen states board.
9. Live screens (bed board, queue, approvals, nursing tasks) subscribe to Socket.IO and refetch after reconnect.
10. Every form uses the Zod schema shared with the API; validate on blur and on submit.
11. Keyboard: all actions reachable by Tab; Enter submits; billing and pharmacy support shortcut keys listed in each screen’s help.
12. Accessibility: WCAG 2.1 AA contrast, visible focus ring, labels on every input, colour never the only signal.
13. Sample data on boards is illustrative. Use the real API; never ship sample names.

## Components (React + Tailwind, `packages/ui`)

See `docs/implementation/PLAN.md` for the package layout. Colours, type and radius come from `packages/ui/src/tokens.css` (Tailwind v4 `@theme`), never from hex values in components.

| Pattern | Build with | Notes |
|---|---|---|
| Side menu | `Sidebar` (packages/ui/layout) | Built from subscribed modules and permissions; search box, collapsible groups, favourites; active item = filled + accent marker |
| Top bar | `TopBar` + `CommandPalette` (cmdk) | Global search by UHID, name, mobile, bill no.; Ctrl+K; approvals badge; branch and role switcher; user menu |
| Tabs (segmented) | Radix Tabs styled with Tailwind | Sync the tab to the URL: ?tab=gst |
| Card with header | `Card` + `PageHeader` | Title left, actions right; wraps on small screens |
| Data table | `DataTable` (TanStack Table + TanStack Virtual) | Server-side paging, sorting and filters; sticky header; column chooser; density toggle; row click opens detail |
| Status chip | `StatusBadge` | Always colour + text (13 px semibold); tone from the shared status enum; red only for act-now |
| Patient identity | `PatientBanner`, `PatientCell` | Mandatory on every patient-context screen; lists show full name + UHID or age |
| Stat tile | `StatTile` | Label, value, one-line context; links to the detail screen |
| Forms | React Hook Form + Zod + `FormField` | Same Zod schema as the API; errors under fields; 40 px controls on desktop, 44 px on touch |
| Stepper flows | `Stepper` | Admission, payroll run, setup wizard; steps clickable when allowed |
| Bed tiles, slot grid | `BedTile`, `SlotGrid` (buttons) | Keyboard reachable; live updates via Socket.IO |
| Kanban boards | `Kanban` | Housekeeping, CRM leads; move buttons as well as drag |
| Dialogs | Radix Dialog → `ConfirmDialog` | Confirm risky actions; reason field when required |
| Toasts | `Toast` (Radix Toast) | 5 s; never the only place an error is shown |
| Critical alerts | `CriticalAlert` | Stays until acknowledged (who, when); escalates after the timeout |
| Print layouts | Server-side PDF (pdfmake) | Match the Print templates page; A4, A5, 80 mm thermal |
