# OPD and Appointments - module specification

Module 1 of 16. Design boards: canvas pages "OPD 1 · Module flow end to end" and "OPD 2 · Role-wise flows" (https://claude.ai/artifact/Fnp7CKPFT5jbiEFyMFNRq2). Board sources are in docs/ui-design/boards (Opd*.dc.html, PortalBooking.dc.html).

## 1. Scope

From the first call to the closed visit: booking (desk, phone, portal, WhatsApp, walk-in), check-in, tokens and queue display, triage, consultation, e-prescription, test orders, billing, pharmacy, results review, follow-up and feedback. Admission from OPD hands over to the IPD module.

## 2. End-to-end flow (happy path)

| Step | Who | What happens |
|---|---|---|
| 1 | Patient | Needs a doctor: calls, books on the portal or WhatsApp, or walks in |
| 2 | Call centre and portal | Books a slot: doctor, date and slot; OTP check; optional online payment |
| 3 | System | Confirms by SMS and WhatsApp; reminders 24 h and 2 h before |
| 4 | Front office | Check-in: finds UHID or registers; ABHA scan; consents |
| 5 | Cashier | Collects consultation fee, or free follow-up rule waives it |
| 6 | System | Issues token; patient joins doctor queue; TV and SMS show position |
| 7 | Nurse | Triage: vitals, complaint, pain score, priority |
| 8 | Doctor | Consultation: history, examination, ICD-10 diagnosis |
| 9 | Doctor | Plan: e-prescription, test orders, advice, admit or refer |
| 10 | Cashier | Bills orders on one bill with member and package prices |
| 11 | Lab and radiology | Tests done; report sent to doctor and patient |
| 12 | Pharmacy | Dispenses from queue, earliest-expiry batches, counselling |
| 13 | Doctor | Reviews results the same day when needed |
| 14 | System | Closes visit; follow-up booked; feedback link; wait times logged |

Steps 10 to 12 can happen in any order. Each counter has its own token series on the shared TV.

## 3. Alternate and exception flows

- **A. Walk-in.** Arrives, finds or quick-registers UHID, picks doctor (next free slot or walk-in series W-), pays, token merged 1 walk-in after every 3 booked.
- **B. Online prepaid.** Search on portal or WhatsApp, slot held 5 min, pay by UPI or card, QR pass, scan QR at kiosk or desk, token without visiting the fee counter.
- **C. Reschedule or cancel.** Request by patient, call centre or desk; cut-off policy check; slot released and offered to the first waitlisted patient; refund or credit by policy; all logged.
- **D. No-show.** 30 min grace after slot; auto No-show at session end; rebook SMS; prepaid fee by policy; 3 no-shows in 90 days means prepay required.
- **E. Doctor leave or late.** Leave or ad-hoc block lists affected bookings; bulk move to same-specialty doctor or new date; patients messaged; refund if they cancel.
- **F. Free follow-up.** Same doctor within 15 days of last paid visit; fee waived and visit linked; paid again after the window or for a new complaint.
- **G. Tele-consultation.** Tele slot booked and prepaid; consent stored; video link by SMS and portal; doctor starts from queue; e-Rx sent; tests booked at nearest centre.
- **H. Referral or cross-consult.** Doctor refers; same-day priority slot in other department; referral note visible; fee per policy; both on one bill.
- **I. Admission from OPD.** Admission request; bed allocated; deposit; IPD module takes over; OPD visit closed as Admitted.
- **J. Priority or red flag.** Triage sets red; top of queue and doctor alerted; emergency referral if needed (Phase 2 ER); every queue jump audited.
- **K. Health check-up.** Package booked; check-in creates all orders; route sheet tracks stations; physician reviews; one consolidated report.

## 4. Status lifecycles

| Object | Normal path | Side exits |
|---|---|---|
| Appointment | Booked → Confirmed → Checked in → In consult → Completed | Cancelled, No-show, Rescheduled |
| Queue token | Issued → Waiting → Called → With doctor → Done | Skipped (recall), Priority moved up |
| Visit | Open → Triage done → Consulted → Orders pending → Closed | Admitted, Referred |
| OPD bill | Draft → Final → Partly paid → Paid | Discount pending approval, Refunded or cancelled |
| Test order | Ordered → Billed → Sample or scan done → Reported → Reviewed | Rejected sample, recollect |
| Prescription | Draft → Signed → At pharmacy → Dispensed | Partly dispensed, Substitute approved |

The API rejects any status change not listed.

## 5. Business rules

Enforced by the API; the UI only explains them.

| No. | Rule | Detail |
|---|---|---|
| R1 | One slot, one booking | A slot holds one booking unless overbooking is allowed for that session [max 2 extra]. Database uniqueness on doctor + slot start. |
| R2 | Slot hold | Online bookings hold the slot while paying [5 min], then release it. |
| R3 | Booking window | Patients can book [30 days] ahead and up to [60 min] before the slot. |
| R4 | Free follow-up | Fee waived if same doctor, within [15 days] of the last paid visit, max [1] free follow-up per paid visit. Doctor can mark "new complaint" to charge. |
| R5 | Walk-in mixing | Walk-ins enter the queue [1] after every [3] booked tokens, unless no booked patient is waiting. |
| R6 | Late arrival | Arrivals more than [15 min] late go after the next on-time patient; the token shows "Late". |
| R7 | No-show | Unarrived [30 min] after slot time becomes No-show at session end; prepaid fee follows the refund policy. |
| R8 | Repeat no-show | [3] no-shows in [90 days] makes prepayment mandatory for online booking. |
| R9 | Cancellation | Free until [4 h] before slot; later cancellations keep [50%] of a prepaid fee as credit. |
| R10 | Doctor leave | Approved leave blocks slots and lists affected bookings; patients cannot be left without a message. |
| R11 | Queue order | Priority red > booked on time > walk-in > late. Any manual move needs a reason and is audited. |
| R12 | Triage before doctor | Vitals are required before consult when the department setting [Triage required] is on; doctor can override with reason. |
| R13 | Close a visit | A visit closes only with at least one diagnosis or "no diagnosis" reason. |
| R14 | Signed records | Signed notes and prescriptions cannot be edited; changes are addenda with time and author. |
| R15 | Orders billing | OPD tests are paid before sample collection unless the patient is credit or corporate. |
| R16 | Discounts | Above [10%] or [₹10,000] needs Billing Manager; above that, Super Admin (approval rules). |
| R17 | Two open visits | A patient can hold at most [2] future bookings per doctor. |
| R18 | Tele-consult | Only for doctors and visit types marked tele-enabled; consent stored before the call. |
| R19 | Family booking | A portal user can book for linked family members only, after OTP linking. |
| R20 | Session close | At session end the doctor sees unclosed visits and must close or carry forward. |

## 6. Settings (OPD Settings screen)

Per branch, department or doctor where noted.

| Setting | Level | Default |
|---|---|---|
| Slot length per visit type | Doctor | New 10 min, follow-up 5 min, tele 10 min |
| Max patients per session | Doctor | 18 |
| Overbooking allowed | Doctor | Yes, 2 per session |
| Online booking enabled | Doctor | Yes |
| Prepay for online booking | Department | Optional |
| Free follow-up window and count | Doctor | 15 days, 1 |
| Walk-in token series and mixing | Department | W-, 1 per 3 |
| Late and no-show grace | Branch | 15 and 30 min |
| Cancellation cut-off and refund | Branch | 4 h, 50% credit after cut-off |
| Triage required | Department | Yes for medicine, cardiology, paediatrics |
| Reminders | Branch | SMS + WhatsApp at booking, 24 h and 2 h |
| Token near alert | Branch | When 3 ahead |

## 7. Notifications

Templates in English, Hindi and Marathi; SMS uses DLT-approved templates.

| Event | To | Channel | Message |
|---|---|---|---|
| Booking confirmed | Patient | SMS, WhatsApp | Doctor, date, time, fee, QR pass |
| Reminder | Patient | SMS, WhatsApp | 24 h and 2 h before, with reschedule link |
| Booking changed by hospital | Patient | SMS, WhatsApp, call list | Old and new time, reason |
| Token near | Patient | SMS | You are 3 patients away |
| Patient triaged | Doctor | In-app | Token, vitals, priority |
| Red flag | Doctor, duty in-charge | In-app, sound | Patient, reason |
| Report ready | Patient, doctor | SMS, WhatsApp, in-app | Secure link (expires in 7 days) |
| Follow-up due | Patient | SMS, WhatsApp | 2 days before date |
| Feedback | Patient | WhatsApp | 2 h after visit closes |
| Daily OPD summary | Management | E-mail | 21:00 each day |

## 8. Reports

All export to Excel and PDF; schedulable.

| Report | For | Key columns |
|---|---|---|
| Daily OPD register | Front office, MRD | Token, UHID, patient, doctor, visit type, times |
| Doctor-wise footfall and revenue | Management | Doctor, new, follow-up, revenue, tests ordered |
| Wait time by stage | Management, Quality | Arrival to triage, triage to doctor, consult, billing, pharmacy |
| No-show and cancellation | Management | Doctor, channel, rate, lost revenue |
| Slot utilisation | OPD admin | Sessions, slots, booked, seen, idle |
| Morbidity (ICD-10) | MRD, management | Diagnosis, count, age group |
| Referral source | CRM, management | Source, visits, revenue |
| OPD to IPD conversion | Management | Doctor, visits, admissions, % |
| Feedback and NPS | Quality | Doctor, department, score, comments |

## 9. Measures and formulas

Shown on OPD analytics; targets set by management.

| Measure | Formula | Target |
|---|---|---|
| Total time in OPD | Visit closed time − arrival time, median | Under 90 min |
| Wait to see doctor | Consult start − check-in time, median | Under 30 min (NABH) |
| Consult time | Consult end − consult start, median | 8 to 15 min |
| No-show rate | No-shows ÷ bookings for the day | Under 8% |
| Slot utilisation | Patients seen ÷ slots offered | Over 85% |
| Online share | Portal and WhatsApp bookings ÷ all bookings | Rising |
| Revenue per visit | OPD revenue incl. tests and pharmacy ÷ visits | Trend |
| Conversion to IPD | Admissions from OPD ÷ OPD visits | Per specialty |

## 10. Edge cases

Must be handled and tested.

| Case | Expected behaviour |
|---|---|
| Two desks book the same slot at once | Second gets "slot just taken" and the next free slot is suggested |
| Patient arrives for wrong date | Desk sees the booking, offers today’s free slot or walk-in |
| Doctor leaves mid-session | Remaining tokens offered to another doctor or rebooked; patients messaged |
| Payment succeeded but booking timed out | Payment webhook confirms booking if slot still free, else auto-refund |
| Patient with same name and mobile | Duplicate check before creating; merge needs approval |
| Network drop at check-in | Form keeps data; token issued once network returns; no double token |
| Minor patient | Guardian details required; consent by guardian |
| Medico-legal case in OPD | MLC flag, police intimation, record locked from edits |

## 11. Acceptance tests (sample)

Run on staging with pilot hospital masters.

| Test | Steps | Pass when |
|---|---|---|
| Book and check in | Book online with UPI, scan QR at desk | Token issued, no fee asked, TV shows token |
| Free follow-up | Book same doctor on day 10 | Bill shows ₹0 consultation with follow-up label |
| Walk-in mixing | Queue 6 booked + 2 walk-ins | Order is B,B,B,W,B,B,B,W |
| No-show | Leave booking unarrived past grace | Status No-show at session end, SMS sent |
| Doctor leave | Approve leave with 5 bookings | 5 patients listed, bulk move works, SMS sent |
| Discount approval | Cashier gives 15% | Bill held; Billing Manager then Super Admin approve; bill updates |
| Close visit rule | Doctor closes without diagnosis | Blocked with message |
| Wait time report | Run day with 50 visits | Median per stage matches time stamps |

## 12. Role-wise flows

Each role works in its own panel and sees only its own OPD work.

### Patient

Mobile web portal, WhatsApp and SMS. No app to install. OTP login; one login manages the family.

1. Finds a doctor by specialty, name or symptom
2. Picks a slot; sees fee and follow-up rule
3. Pays by UPI or card (or pays at hospital)
4. Gets confirmation with QR pass; reminders 24 h and 2 h
5. Scans QR at kiosk or desk to check in
6. Watches token on TV; SMS when 3 ahead
7. Triage and consultation
8. Pays for tests at one counter or online
9. Collects medicines; report link arrives
10. Gets e-Rx, follow-up date and feedback link

- **Screens:** Mobile booking flow, Patient portal home, Queue TV display, Prescription print
- **Can:** Book, reschedule or cancel own and family visits; Pay online and download receipts; Join tele-consultation; Download Rx and reports; Give feedback and raise complaints
- **Cannot:** See any other patient; Book doctors not open for online booking; Cancel after cut-off without the policy fee; Book more than 2 open visits per doctor
- **Notified when:** Booking confirmed or changed; Reminder 24 h and 2 h before; Token is 3 ahead; Report ready; Follow-up due; Feedback request
- **Measured by:** Wait from arrival to doctor (Under 30 min); Online booking share (Rising month on month); No-show rate (Under 8%); Patient rating (4.5 / 5 or more)

### Call centre

Phone bookings, reschedules, waitlist and recalls. Caller is identified from the phone number.

1. Incoming call: patient matched by phone
2. Hears need; suggests department and doctor
3. Checks live availability across doctors
4. Books, reschedules or cancels with policy check
5. Sends payment link if prepay required
6. Adds to waitlist when full
7. Calls waitlist when a slot frees
8. Calls back no-shows to rebook
9. Logs enquiry; hot leads go to CRM

- **Screens:** Call centre home, CRM and call log, Appointments, Patient search and register
- **Can:** Book for any patient in any department; Manage waitlist; Send payment links; Create leads
- **Cannot:** Give discounts or refunds; See clinical notes; Check in or bill a patient
- **Notified when:** Waitlist slot freed; Doctor leave affecting bookings; Missed calls to return
- **Measured by:** Calls answered (Over 95%); Call to booking (Over 60%); Average handle time (Under 3 min); Waitlist filled (Over 70% of freed slots)

### Front office

Registration and check-in counters. Fast search, duplicate checks and tokens.

1. Starts day: sees doctor availability and late notices
2. Searches UHID, mobile or ABHA QR
3. Quick-registers new patients (name, age, sex, mobile)
4. Checks in booked patients; token printed
5. Walk-in: picks doctor and next slot or walk-in series
6. Collects fee when desk also bills
7. Reschedules or cancels at the counter
8. Moves patients when a doctor is delayed
9. Day end: unarrived marked no-show; lists printed

- **Screens:** Front office home, OPD check-in, Register patient, Appointments, Counter tokens and passes
- **Can:** Register and edit demographics; Book, check in, reschedule, cancel; Issue tokens and visitor passes; Request patient merge (maker)
- **Cannot:** Approve merges or discounts; Open clinical notes; Change doctor schedules
- **Notified when:** Doctor running late or on leave; Possible duplicate patient; Planned admission arrivals
- **Measured by:** Check-in time (Under 2 min); Duplicate registrations (Under 0.5%); Queue at desk (Under 5 waiting); ABHA linked (Rising share)

### Cashier

Collects consultation and test charges in one place, with split payments and approvals.

1. Opens shift with cash count
2. Calls billing token
3. Sees all unbilled charges for the patient
4. Free follow-up and member prices applied automatically
5. Discount request goes to approval if above limit
6. Takes payment: UPI, card, cash or split
7. Prints or sends e-receipt
8. Requests refunds for cancelled tests
9. Closes shift; difference needs a reason

- **Screens:** Cashier home, Billing counter, OPD receipt print
- **Can:** Create bills and receipts; Request discounts and refunds (maker); Reprint receipts (logged)
- **Cannot:** Approve own discounts or refunds; Change prices; Delete a bill
- **Notified when:** Discount approved or rejected; Refund decided; Payment device offline
- **Measured by:** Billing wait (Under 5 min); Cash difference at close (Zero); Digital payment share (Over 70%); Reprints (Under 1% of bills)

### Nurse (triage)

OPD triage station before the doctor. Captures vitals and flags priority.

1. Sees triage queue in token order
2. Calls the patient
3. Records BP, pulse, temperature, SpO2, weight, height
4. BMI and sugar auto-flagged
5. Notes complaint, pain score; confirms allergies
6. Sets priority: red, amber, green
7. Sends to doctor queue; red alerts doctor
8. Gives injections or dressings ordered by doctor
9. Records what was given and when

- **Screens:** Nurse home, OPD triage
- **Can:** Record vitals and triage; Set priority (logged); Record procedures and injections
- **Cannot:** Prescribe or change orders; Bill or discount; Skip the queue without a red flag
- **Notified when:** New patient in triage queue; Doctor order for injection or dressing; Abnormal vital flagged
- **Measured by:** Arrival to triage (Under 10 min); Vitals complete (100% of visits); Red flags to doctor (Under 5 min); Triage time (Under 4 min)

### Doctor

Consultation room. Queue, history, notes, prescription and orders on one screen.

1. Reviews today's list and pre-visit summaries
2. Calls next token (TV and SMS update)
3. Sees vitals, history, past reports
4. Writes notes with templates; ICD-10 diagnosis
5. Prescribes; allergy and interaction checks
6. Orders tests and procedures; order sets
7. Admits or refers if needed
8. Signs; Rx printed or sent by WhatsApp
9. Sets follow-up date
10. Reviews results the same day if needed

- **Screens:** Doctor home, OPD consultation, Prescription print, Patient profile
- **Can:** Write notes, diagnoses, prescriptions, orders; Request admission or referral; Issue medical certificates; Start tele-consults
- **Cannot:** See patients of other departments without a referral (configurable); Change bills; Edit signed notes (addendum only)
- **Notified when:** Patient checked in and triaged; Red-flag patient; Critical result; Tele-consult patient waiting
- **Measured by:** Consult time (8 to 15 min); Patients per hour (Per specialty target); Visits closed with diagnosis (100%); Follow-up compliance (Over 70%)

### Pharmacy and lab

Orders from the consultation arrive automatically. No re-typing of prescriptions or tests.

1. Pharmacy: Rx appears in queue with token
2. Checks stock; offers substitute with consent
3. Dispenses earliest-expiry batches; bills
4. Counsels; prints dose labels
5. Lab: test appears in collection worklist
6. Collects sample; barcode printed
7. Enters and validates results
8. Report released to doctor and patient

- **Screens:** Pharmacy dispensing, Laboratory worklists, Lab report print
- **Can:** Dispense and bill medicines; Collect samples and enter results; Pathologist validates (checker)
- **Cannot:** Change a prescription; Release unvalidated results; Sell Schedule H1 without prescriber details
- **Notified when:** New Rx or test order; Critical value; Stock below reorder
- **Measured by:** Rx turnaround (Under 10 min); Sample collection wait (Under 10 min); Report TAT (routine) (Under 4 h); Fill rate (Over 95%)

### OPD administrator

Sets up how OPD works: schedules, fees, tokens, policies and messages.

1. Sets departments, rooms and counters
2. Builds doctor schedule templates
3. Slot length, session limit, overbooking
4. Fees per visit type; follow-up window
5. Token series and TV display
6. Cancellation, no-show and refund policy
7. Reminder and message templates
8. Consult templates and order sets
9. Handles doctor leave with bulk reschedule

- **Screens:** OPD settings, Departments and masters, Hospital settings, Appointments
- **Can:** Change OPD settings (fee changes need approval); Block doctor sessions; Bulk reschedule
- **Cannot:** Approve own fee changes; See clinical notes
- **Notified when:** Doctor leave approved; Fee change approved; Overbooking above limit
- **Measured by:** Slot utilisation (Over 85%); Sessions starting late (Under 10%); Schedule changes with under 24 h notice (Under 5%)

### Management

Watches OPD performance and acts on bottlenecks.

1. Opens OPD analytics each morning
2. Checks wait time per stage
3. Sees doctor utilisation and late starts
4. Tracks no-shows and cancellations
5. Revenue per visit and test conversion
6. OPD to admission conversion
7. Reads feedback and complaints
8. Acts: adds sessions, staff or counters

- **Screens:** OPD analytics, Super Admin dashboard, Reports, Quality
- **Can:** See all OPD data and reports; Approve fee and policy changes
- **Cannot:** Edit clinical records; Delete audit entries
- **Notified when:** Daily OPD summary at 21:00; Wait time above target; Complaint past TAT
- **Measured by:** OPD footfall (Daily and trend); Total time in OPD (Under 90 min); Revenue per visit (Trend); Patient NPS (Over +50)

## 13. Capabilities

Market standard = offered by most hospital systems. Advanced = leading or enterprise systems. Our edge = not found in the public material reviewed.

**Scheduling**

- Doctor schedule templates, sessions, rooms (Market standard)
- Slot length by visit type (Market standard)
- Doctor, department and hospital calendar views (Market standard)
- Leave and ad-hoc blocks with bulk reschedule (Advanced)
- Overbooking limits with warnings (Advanced)
- Waitlist that backfills freed slots (Advanced)

**Booking channels**

- Front desk and phone booking (Market standard)
- Walk-in with separate token series (Market standard)
- Patient portal booking and online payment (Advanced)
- WhatsApp booking link (Our edge)
- Call-centre screen with caller lookup (Advanced)
- Corporate and health check-up bulk booking (Advanced)

**Check-in and queue**

- Token at check-in, department-wise series (Market standard)
- Waiting-area TV with auto-call (Market standard)
- QR self check-in (kiosk or phone) (Advanced)
- ABHA Scan and Share check-in (Our edge)
- SMS when patient is 3 tokens away (Our edge)
- Priority and VIP handling with audit (Market standard)

**Triage**

- Vitals with auto BMI and range flags (Market standard)
- Chief complaint, pain score, allergy confirmation (Market standard)
- Red, amber, green priority (Advanced)
- Red-flag alert to doctor (Our edge)

**Consultation**

- Notes, ICD-10 diagnosis, templates (Market standard)
- Specialty templates (dental, eye, ANC, paeds) (Advanced)
- e-Prescription with auto-suggest (Market standard)
- Allergy and interaction checks (Advanced)
- Order sets for tests and procedures (Advanced)
- Trend charts for returning patients (Advanced)
- Regional-language Rx, WhatsApp delivery (Our edge)
- Medical certificates from the visit (Advanced)

**Orders and results**

- Lab and radiology orders flow to worklists (Market standard)
- Same-day result review and revisit (Advanced)
- Admission request from OPD (Market standard)
- Referral and cross-consultation (Market standard)

**Billing**

- Consultation and orders auto-added to bill (Market standard)
- Free follow-up window applied automatically (Advanced)
- Membership and package pricing (Advanced)
- Discounts with maker-checker approval (Our edge)
- UPI device and card machine matching (Our edge)

**Patient engagement**

- SMS and e-mail reminders (Market standard)
- Tele-consultation with prepayment (Advanced)
- Feedback after visit, NPS (Advanced)
- Follow-up reminders and recall lists (Advanced)

**Analytics and compliance**

- Footfall and revenue by doctor and department (Market standard)
- Wait time per stage, total time in OPD (Our edge)
- No-show and cancellation rates (Advanced)
- Doctor utilisation and late starts (Advanced)
- NABH OPD waiting-time indicator (Our edge)
- Full audit of queue jumps and changes (Our edge)

## 14. Competitor benchmark

From public product pages and documentation, reviewed October 2026. "Not found" means not confirmed publicly, not that the product lacks it. Verify in vendor demos before quoting.

| Capability | Indian HMS vendors (MocDoc, Codingclave) | KareXpert | Epic Cadence | Bahmni | Ours |
|---|---|---|---|---|---|
| Front desk, phone and walk-in booking | Yes | Yes | Yes | Walk-in visit | Yes |
| Patient self-booking and online payment | Not found | Yes | Not found | Not found | Yes |
| Token queue with TV display | Yes | Not found | Not found | Not found | Yes |
| Department-wise token series | Yes | Not found | Not found | Not found | Yes |
| Appointment reminders (SMS, e-mail) | Yes | Not found | SMS, e-mail, IVR | Not found | Yes |
| Waitlist backfill | Not found | Not found | Yes | Not found | Yes |
| Overbooking control | Not found | Not found | Warnings | Not found | Yes |
| Check-in and check-out | Not found | Not found | Yes | Start visit | Yes |
| Vitals at triage | Not found | Not found | Not found | Yes | Yes |
| e-Prescription | Yes | Yes | Not found | Drug orders | Yes |
| Lab orders from consultation | Not found | Not found | Not found | Yes | Yes |
| Auto-billing of consult and orders | Yes | Not found | Not found | Via Odoo | Yes |
| Tele-consultation | Not found | Yes | Not found | Not found | Yes |
| Footfall and revenue analytics | Yes | Not found | Not found | Not found | Yes |
| ABHA Scan and Share check-in | Not found | Not found | Not found | Not found | Yes |
| Wait time per stage (NABH) | Not found | Not found | Not found | Not found | Yes |

Sources:

- MocDoc hospital management system: https://mocdoc.com/india/mh/hospital-software-mumbai
- Codingclave OPD management software: https://codingclave.com/software/sub/opd-management-software-in-delhi
- KareXpert: https://karexpert.com/blogs/revolutionize-hospital-management-with-software-solutions
- Epic Cadence guide (Mindbowser): https://www.mindbowser.com/epic-cadence-a-guide-for-healthcare-scheduling/
- Epic support, University of Iowa: https://epicsupport.sites.uiowa.edu/node/1136
- Bahmni wiki, What happens in a hospital: https://bahmni.atlassian.net/wiki/spaces/BAH/pages/8192018/What+happens+in+a+hospital

## 15. Screens

| Screen | Role | Board |
|---|---|---|
| Patient mobile booking | Patient | PortalBooking |
| Appointments calendar and queue | Front office, call centre | Opd |
| OPD check-in | Front office | OpdCheckin |
| OPD triage | Nurse | OpdTriage |
| Consultation | Doctor | Consult |
| Billing counter | Cashier | Billing |
| Pharmacy dispensing | Pharmacist | Pharmacy |
| Laboratory worklists | Lab | Lab |
| Queue TV display | Waiting area | QueueTV |
| OPD settings | Hospital Admin | OpdConfig |
| OPD analytics | Management | OpdAnalytics |
| Prescription and receipt prints | Doctor, cashier | PrintRx, PrintReceipt |
