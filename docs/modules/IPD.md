# IPD: admission to discharge - module specification

Module 2 of 16. Design boards: canvas pages "IPD 1 · Module flow end to end" and "IPD 2 · Role-wise flows" (https://claude.ai/artifact/Fnp7CKPFT5jbiEFyMFNRq2). Board sources are in docs/ui-design/boards (Ipd*.dc.html, PortalStay.dc.html); generators in docs/ui-design/source/ipd.

## 1. Scope

From admission advice to a clean bed: estimate and financial counselling, insurance pre-authorisation, bed allocation, admission, ward care (assessments, orders, medicine rounds, charts), daily charges and deposits, transfers, discharge, bed turnaround and the insurance claim. It covers cash, corporate, private insurance (direct and through TPAs) and government schemes (PM-JAY, CGHS, ECHS). Emergency care starts before any payment. OPD hands over through the admission request; OT, ICU charts, pharmacy, lab, diet and housekeeping plug in through orders and tasks.

## 2. End-to-end flow (planned admission)

| Step | Who | What happens |
|---|---|---|
| 1 | Doctor (consultant, RMO) | **Admission advised.** From OPD, emergency or planned surgery; reason, stay, bed type |
| 2 | Admission desk | **Estimate and counselling.** Room tariff, package, deposit; estimate e-signed |
| 3 | Insurance (TPA) desk | **Pre-authorisation.** Policy checked; request with documents; insurer replies in 1 h |
| 4 | Bed manager and housekeeping | **Bed allocated.** By category, gender and isolation need; reserved 2 h |
| 5 | Admission desk | **Admitted.** IP number, consents, barcode wristband, attendant pass |
| 6 | Patient and attendant | **Pays deposit.** UPI, card or cash by bed category; none if cashless approved |
| 7 | Ward nurse | **Received in ward.** Nursing assessment in 2 h: allergies, falls and pressure risk |
| 8 | Doctor (consultant, RMO) | **Initial assessment.** History, plan and orders in 24 h: medicines, tests, diet |
| 9 | Pharmacy, lab and diet | **Orders fulfilled.** Medicines issued patient-wise; samples; diet from kitchen |
| 10 | Ward nurse | **Care every shift.** Barcode medicine round (MAR), vitals, intake-output, notes |
| 11 | Doctor (consultant, RMO) | **Daily rounds.** Progress notes, results reviewed, orders changed |
| 12 | System (automatic) | **Charges posted.** Room, nursing, services daily; alert at 80% of deposit |
| 13 | Insurance (TPA) desk | **Enhancement.** Raised when bill reaches 90% of the approved amount |
| 14 | Doctor (consultant, RMO) | **Discharge planned.** Expected date set a day ahead; summary drafted |
| 15 | In-patient billing | **Final bill.** Pharmacy returns credited; insurer final approval in 3 h |
| 16 | Patient and attendant | **Goes home.** Medicines explained, summary and bill on WhatsApp, gate pass |
| 17 | Bed manager and housekeeping | **Bed turned around.** Cleaning task; bed available again in 45 min |
| 18 | System (automatic) | **After discharge.** Follow-up booked, feedback, record to MRD, claim filed |

Steps 9 to 13 repeat every day until discharge is planned. A transfer can happen at any point and changes the room tariff from that hour. IRDAI Master Circular on health insurance (May 2024): the insurer decides a cashless request within 1 hour and the final discharge approval within 3 hours of the hospital's request.

## 3. Alternate and exception flows

- **A. Emergency admission.** Emergency triage: admit now; Bed or ICU allocated first; no deposit wait; Treatment starts on verbal plus written order; Registration and consents completed by attendant; Deposit or pre-auth within 24 h; Joins normal IPD flow.
- **B. Planned surgery (package).** Surgery date booked from OPD; Pre-op tests and anaesthesia check in OPD; Package estimate signed; Admitted on the day; OT scheduled; Package billed; extras outside package shown separately; Package variance reported.
- **C. Cashless insurance (TPA).** Policy and ID verified; Pre-auth sent with documents; Approved, query or denied (1 h target); Enhancement when bill nears approval; Final approval in 3 h after final bill; Claim filed; settlement matched to bill.
- **D. Government scheme (PM-JAY, CGHS, ECHS).** Beneficiary verified on scheme portal; Package pre-auth on scheme portal; number recorded; Scheme rates; patient pays nothing for package; Daily photos and notes as scheme requires; Claim with discharge documents; Payment matched on receipt.
- **E. Transfer or ICU step-up.** Doctor orders transfer; Bed request to bed manager; Bed allocated; handover note (SBAR); Patient moved; tariff changes from that hour; Old bed goes to cleaning; Step-down later follows the same steps.
- **F. Insurance denied.** Insurer denies or query not resolved; Patient and attendant informed with reason; Converted to cash or corporate; Deposit collected as per category; Papers given for reimbursement claim.
- **G. Leaving against advice (LAMA).** Patient or family asks to leave; Doctor explains risks, recorded; LAMA form signed with witness; Bill settled or dues approved; Summary marked LAMA; bed released.
- **H. Death in hospital.** Death declared and time recorded; Cause of death certificate (MCCD); Medico-legal: police informed; Body handed over; never held for dues; Record to MRD; death review.
- **I. Absconded patient.** Patient missing at round or check; Search and security informed; Police informed as per policy; Marked absconded; bed released; Bill moved to dues.
- **J. Day care.** Booked for dialysis, chemo, cataract and similar; Day-care bed; short admission; Procedure and observation; Same-day discharge; day-care package; Next session booked.
- **K. Mother and newborn.** Delivery recorded in labour room; Baby record and UHID linked to mother; Baby on mother’s bill or own (NICU); Birth details for civil registration; Joint discharge with both summaries.
- **L. Medico-legal case (MLC).** MLC flagged at admission; Police intimation logged; Injuries documented; records locked; Police informed at discharge or death; MLC register updated.
- **M. Transfer to another hospital.** Doctor decides referral out; Receiving hospital confirmed; Consent, summary and ambulance; Bill settled or moved to dues; Bed released; outcome recorded.

## 4. Status lifecycles

| Object | Normal path | Side exits (from) |
|---|---|---|
| Admission request | Requested → Estimate given → Bed reserved → Admitted | Cancelled (Requested), Waiting for bed (Estimate given), Reservation expired (2 h) (Bed reserved) |
| Bed | Available → Reserved → Occupied → Vacated → Cleaned (Available) | Blocked (maintenance) (Available), Terminal clean (isolation) (Vacated) |
| In-patient stay | Admitted → Under treatment → Discharge planned → Discharge started → Discharged | Transferred (bed or ICU) (Under treatment), LAMA, absconded, referred out (Discharge planned), Death (Discharge started) |
| Pre-authorisation | Draft → Sent → Approved → Enhanced → Final approved → Settled | Query or denied (to cash) (Sent), Approved less: patient pays (Final approved), Short-paid: deduction (Settled) |
| In-patient bill | Running → Interim → Final draft → Audited → Settled | Discount pending approval (Final draft), Discharged with dues (Audited) |
| Medicine order | Ordered → Pharmacist verified → Issued to ward → Given (MAR) | Rejected by pharmacist (Pharmacist verified), Held or refused (reason) (Issued to ward) |
| Discharge | Planned → Summary signed → Bill cleared → Documents given → Patient left | Awaiting insurer approval (Summary signed) |

The API rejects any status change not listed; every change stores time and user.

## 5. Business rules

Enforced by the API; the UI only explains them. Values in brackets are defaults on the IPD Settings screen.

| No. | Rule | Detail |
|---|---|---|
| R1 | Admission order | Every admission needs a doctor’s admission order naming the admitting consultant, reason and expected stay. |
| R2 | Money never blocks emergency care | Emergency admissions get a bed first. Deposit or pre-auth is due within [24 h]. Planned admissions pay the category deposit before the bed is reserved. |
| R3 | One stay, one bed | A patient has one active admission and one bed. A bed holds one patient. A reservation expires after [2 h] unless renewed. |
| R4 | Bed matching | Bed suggestions respect bay gender, age (paediatric), isolation need and category. A higher category needs signed consent for the tariff. |
| R5 | Room-rent limit | For insured patients, a room above the policy limit shows the proportionate deduction warning and needs the upgrade consent before transfer. |
| R6 | Room rent | Charged by [midnight census] (option: 24-hour cycle). ICU over [6 h] in a day is a full ICU day. On the day of a transfer, each bed is charged by hours. |
| R7 | Deposit alerts | At [80%] of deposit used, the attendant and billing are alerted. At [100%], planned patients must top up; treatment is never stopped. |
| R8 | Pre-authorisation | Sent within [2 h] of planned admission and [24 h] of emergency admission. If no insurer reply in 1 hour, the desk is alerted to follow up (IRDAI 2024). |
| R9 | Enhancement | Suggested automatically when the running bill reaches [90%] of the approved amount. |
| R10 | Assessments on time | Nursing admission assessment within [2 h] and doctor’s initial assessment within [24 h]; overdue items show on both home screens. |
| R11 | Medicine safety | Orders are verified by a pharmacist before issue (STAT excepted). Doses are given only after scanning the wristband and the medicine. A missed or held dose needs a reason. |
| R12 | High-alert medicines | Insulin, heparin, potassium chloride, chemotherapy and similar need a second nurse’s confirmation in the MAR. |
| R13 | Signed records | Signed notes, orders and summaries cannot be edited; changes are addenda with time and author. |
| R14 | Discharge summary | A stay closes only with a consultant-signed summary containing diagnoses (ICD-10), procedures, medicines and follow-up. |
| R15 | Pharmacy returns | The final bill cannot be made while ward returns are pending; returns are credited first. |
| R16 | Final bill speed | Final bill target [45 min] after discharge advice; insured bills go for final approval within [30 min] of the bill. |
| R17 | Discounts and dues | Every discount needs approval: Billing Manager up to [10% or ₹10,000], Super Admin above that. Discharge with dues needs Medical Superintendent approval. |
| R18 | Deceased patients | A body is never held back for unpaid bills. Dues move to the patient account. |
| R19 | Bed release | A vacated bed becomes Cleaning and turns Available only when housekeeping closes the task (target [45 min], isolation [90 min]). |
| R20 | Medico-legal and LAMA | MLC admissions record police intimation and lock injury records. LAMA needs a signed form with a witness and the risks explained. |

## 6. Settings (IPD Settings screen)

Per branch unless noted.

| Setting | Level | Default |
|---|---|---|
| Wards, beds, bays and features | Ward | As configured (120 beds) |
| Tariff per bed category | Branch | General ₹1,200 to ICU ₹12,000 per day |
| Planned deposit per category | Branch | ₹10,000 to ₹50,000 |
| Deposit alert and top-up levels | Branch | 80% and 100% |
| Emergency deposit window | Branch | 24 h |
| Room rent method | Branch | Midnight census |
| ICU full-day rule | Branch | Over 6 h |
| Enhancement prompt | Branch | 90% of approval |
| Reservation hold | Branch | 2 h |
| Discharge, bill and cleaning targets | Branch | 3 h, 45 min, 45 min |
| Packages with inclusions | Department | As configured |
| Insurers, TPAs, schemes and rate cards | Branch | As contracted |
| Consent and summary templates | Department | English, Hindi, Marathi |

## 7. Notifications

SMS uses DLT-approved templates; WhatsApp needs patient consent.

| Event | To | Channel | Message |
|---|---|---|---|
| Admission confirmed | Attendant | SMS, WhatsApp | IP number, ward, bed, consultant, visiting hours |
| Bed request | Bed manager | In-app | Patient, need, priority |
| Reservation expiring | Admission desk | In-app | 15 minutes before expiry |
| Insurer reply or query | TPA desk, attendant | In-app, SMS | Approved amount or query text |
| No insurer reply in 1 h | TPA desk | In-app | Escalate to insurer helpdesk |
| Deposit at 80% | Attendant, billing | SMS, WhatsApp, in-app | Bill so far, deposit, pay link |
| Medicine due or late | Nurse | In-app | Bed, medicine, due time |
| Early warning score high | Nurse, RMO | In-app, sound | Bed, score, vitals |
| Critical result | Doctor, nurse | In-app, call log | Value and time |
| Discharge expected tomorrow | Attendant, billing, pharmacy, TPA desk | SMS, in-app | Expected time, documents to bring |
| Ready to go home | Attendant | SMS, WhatsApp | Balance and pay link |
| Bed vacated | Housekeeping | In-app | Bed, cleaning type |
| Daily IPD summary | Management | E-mail | 08:00 each day |
| Feedback | Patient | WhatsApp | 1 day after discharge |

## 8. Reports

All export to Excel and PDF; schedulable.

| Report | For | Key columns |
|---|---|---|
| Midnight census | Ward in-charge, MRD | Ward, bed, patient, days, category |
| Admission and discharge register | MRD, management | IP no., dates, consultant, outcome |
| Bed occupancy by ward | Management | Beds, occupied days, occupancy % |
| Average length of stay | Management, departments | By department, doctor, diagnosis |
| Discharge turnaround | Management, quality | Per stage times, delays and reasons |
| Deposit vs bill | Billing | Patient, bill, deposit, balance |
| Pre-auth and claim status | TPA desk | Insurer, sent, replied, approved, ageing |
| Package variance | Billing, admin | Package, price, actual cost, extras |
| Revenue per occupied bed day | Management | Department, revenue, bed days |
| Deaths, LAMA and absconding | Medical Superintendent | Patient, date, type, review |
| Readmissions within 30 days | Quality | Patient, both stays, diagnosis |
| Medicine round compliance | Nursing | Doses due, on time, late, missed |

## 9. Measures and formulas

Used on the IPD analytics screen and for NABH reporting.

| Measure | Formula | Notes |
|---|---|---|
| Bed occupancy rate | Occupied bed days × 100 ÷ (beds × days in period) | Occupied bed days from the midnight census |
| Average length of stay | In-patient days ÷ discharges (including deaths) | Day care excluded |
| Bed turnover rate | (Discharges + deaths + LAMA + transfers out) ÷ beds | Per month |
| Bed turnover interval | (Available bed days − occupied bed days) ÷ discharges | Days a bed stays empty between patients |
| Discharge turnaround | Patient left − discharge advice | Median; per stage from time stamps |
| Bed turnaround | Bed ready − patient left | From cleaning tasks |
| Revenue per occupied bed day | In-patient revenue ÷ occupied bed days | Excludes pharmacy for take-home |
| Gross death rate | Deaths × 100 ÷ discharges including deaths | Net rate excludes deaths within 48 h |
| LAMA rate | LAMA × 100 ÷ discharges |  |
| Readmission rate | Readmitted within 30 days × 100 ÷ discharges | Same hospital, any cause |
| Pre-auth reply time | Insurer reply − pre-auth sent | IRDAI target 1 h |
| Doses on time | Doses given within 30 min of due × 100 ÷ doses due | From the MAR |

## 10. Edge cases

How the system behaves.

| Case | Behaviour |
|---|---|
| No bed in the needed category | Waiting list with priority; temporary bed (emergency or HDU) flagged; Medical Superintendent alerted |
| Insurer approves less than estimate | Difference shown to attendant as patient share; deposit asked for it |
| Patient changes payer mid-stay (cash to insurance) | Pre-auth from that day; earlier charges stay patient share unless insurer accepts |
| Transfer at midnight | Census uses the bed at 00:00; transfer hours used only on the transfer day |
| Two consultants | One admitting consultant owns the stay; cross-consult visits billed to the visiting doctor |
| Long stay over 30 days | Interim bill every [7 days]; deposit top-up asked |
| Death before admission complete | Emergency record converts to admission for documentation; death flow follows |
| Readmission within 24 h | New admission linked to the earlier stay; shown on both summaries |
| Newborn needs NICU | Baby gets own UHID and admission, linked to mother; bills can be combined |
| Network drop on ward | MAR keeps scans offline on the device and syncs; duplicate doses blocked on sync |
| Deposit paid by wrong patient | Transfer between accounts needs Billing Manager approval and is audited |

## 11. Acceptance tests (sample)

Run on staging with pilot hospital masters.

| Test | Steps | Pass when |
|---|---|---|
| Emergency without deposit | Admit emergency patient with no payment | Bed allocated; deposit due shown with 24 h timer |
| Gender bay | Request bed for female patient | No male-bay beds suggested |
| Room-rent warning | Upgrade insured patient above limit | Warning shown; transfer blocked until consent signed |
| Midnight census | Keep 10 patients over midnight | 10 room charges posted at 00:05 with correct tariffs |
| Deposit alert | Post charges to 80% of deposit | SMS to attendant and alert to billing |
| Enhancement prompt | Bill reaches 90% of approval | Prompt on TPA desk; case moves to top |
| Barcode MAR | Scan wrong patient wristband | Dose blocked with message |
| Returns before bill | Try final bill with pending returns | Blocked until returns credited |
| Bed release | Discharge patient | Bed shows Cleaning, then Available after task closed |
| Body not held | Death with dues | Body handover allowed; dues on patient account |
| Indicator maths | Run a month of test data | Occupancy, stay and turnover match the formulas |

## 12. Role-wise flows

Each role works in its own panel and sees only its own IPD work.

### Patient and attendant

The attendant (family member) does most of the work during a stay. Mobile web portal, WhatsApp and SMS; OTP login linked to the patient.

1. Gets admission advice and a written estimate
2. Signs estimate and consents (e-sign or paper)
3. Gives insurance card or scheme ID
4. Pays deposit (UPI, card, cash)
5. Gets IP number, bed, ward and visiting rules by SMS
6. Sees running bill and deposit balance daily on phone
7. Tops up deposit when alerted
8. Is told the expected discharge date a day ahead
9. Tracks discharge status: summary, bill, insurer approval
10. Gets summary, bill and Rx on WhatsApp; follow-up booked

- **Screens:** Attendant mobile screens (PortalStay), Patient portal home (Portal), Final bill print (PrintBill), Discharge summary print (PrintDischarge)
- **Can:** See bed, doctor, running bill and deposit; Pay deposit and bills online; Download estimate, receipts, summary and reports; Request a room change; Give feedback and raise complaints
- **Cannot:** See clinical notes or nursing charts; Change the estimate or package; Leave without bill clearance or approved dues; Get more attendant passes than allowed
- **Notified when:** Admission confirmed with bed and ward; Deposit low (80% used); Insurer approved, queried or denied; Discharge expected tomorrow; Ready to go home; Follow-up and feedback
- **Measured by:** Discharge turnaround (Under 3 h); Bill complaints (Under 2%); Estimate vs final bill (Within 15%); Patient rating (4.5 / 5 or more)

### Admission desk

Turns an admission advice into an admitted patient with a bed, an IP number and a signed estimate.

1. Sees admission request from doctor or emergency
2. Finds or registers patient (UHID, ABHA)
3. Prepares estimate from tariff or package
4. Counsels attendant; estimate signed
5. Requests bed by category and gender
6. Hands insurance cases to the TPA desk
7. Collects deposit or notes cashless
8. Admits: IP number, consents, wristband
9. Issues attendant pass; informs ward
10. Tracks planned admissions for tomorrow

- **Screens:** Admit patient (Admission), Live bed board (Beds), Bed requests and transfers (IpdBedRequests), Patient profile (PatientProfile)
- **Can:** Create admissions and estimates; Reserve a bed for 2 hours; Collect deposits and print receipts; Print wristbands and attendant passes; Cancel an admission before the patient is received
- **Cannot:** Admit without a doctor's admission order; Change tariffs or packages; Give discounts; Hold an emergency for deposit
- **Notified when:** New admission request; Bed ready for reserved patient; Reservation about to expire; Planned admissions for tomorrow
- **Measured by:** Advice to admitted (Under 60 min); Estimates signed (100%); Deposit at admission (95% of planned); Reservation expiries (Under 5%)

### Insurance (TPA) desk

Gets cashless approvals on time and turns them into paid claims. Works with insurers, TPAs and government schemes.

1. Verifies policy, ID and room-rent limit
2. Sends pre-auth with documents
3. Tracks 1-hour insurer reply; answers queries
4. Records approved amount on the bill
5. Watches bill vs approval every day
6. Sends enhancement at 90% of approval
7. Sends final bill for discharge approval
8. Tracks 3-hour final approval
9. Files claim with documents
10. Matches settlement; books deductions

- **Screens:** Insurance and TPA desk (IpdTpa), In-patient bill (IpdBill), Discharge desk (Discharge), Approvals (Approvals)
- **Can:** Create and send pre-auth and enhancement; Record insurer replies and amounts; Split bill between insurer and patient; File claims and record settlements; Flag non-payable items to patient share
- **Cannot:** Change clinical records; Write off deductions without approval; Discharge a patient; Edit tariffs
- **Notified when:** New insured admission; Insurer reply or query; No reply after 1 hour; Bill at 90% of approval; Final approval pending over 3 hours; Settlement short-paid
- **Measured by:** Pre-auth sent within 2 h (95%); Final approval time (Under 3 h); Claim deductions (Under 5%); Claims unpaid over 45 days (Under 10%)

### Ward in-charge and bed manager

Keeps beds flowing: allocates beds, runs transfers, pushes discharges and checks that cleaning is fast.

1. Starts the day with census and expected discharges
2. Sees bed requests from admission and doctors
3. Allocates by category, gender and isolation
4. Approves transfers and ICU step-up or step-down
5. Pushes discharges planned for today
6. Sees vacated beds and cleaning tasks
7. Marks maintenance blocks
8. Balances nurse-patient ratio with roster
9. Reviews falls, pressure injuries and incidents
10. Signs the midnight census

- **Screens:** Bed requests and transfers (IpdBedRequests), Live bed board (Beds), Nursing station (Nursing), Rosters (Roster)
- **Can:** Allocate, reserve and swap beds; Approve transfers within the ward; Block beds for maintenance or isolation; Escalate delayed discharges; Approve ward indents
- **Cannot:** Admit or discharge a patient; Change tariffs; Move a patient to a higher bed category without consent; Release a bed before cleaning is done
- **Notified when:** New bed request; Transfer ordered; Bed vacated, cleaning started; Cleaning late (over 45 min); Discharge planned but not started by noon
- **Measured by:** Bed occupancy (80 to 90%); Bed turnaround (Under 45 min); Request to bed (Under 30 min); Discharges before noon (40% or more)

### Staff nurse

Delivers care every shift and records it once: medicines, vitals, charts and handover.

1. Receives patient; checks wristband
2. Nursing assessment in 2 h: allergies, falls, pressure
3. Starts care plan
4. Gives medicines by barcode scan (MAR)
5. Records vitals; early warning score flags
6. Intake-output, wound and ICU charts
7. Sends samples; collects diet orders
8. Shift handover (SBAR) to next nurse
9. Prepares patient for discharge
10. Explains medicines and gives documents

- **Screens:** Nursing station (Nursing), Live bed board (Beds), Diet orders (Diet), Tickets and transport (Facility)
- **Can:** Record vitals, MAR, notes and charts; Hold a dose with reason; Raise ward indents and diet changes; Request transport and housekeeping; Report incidents
- **Cannot:** Change doctor orders; Give a high-alert drug without a second nurse; Discharge a patient; Edit a signed note (only addendum)
- **Notified when:** Medicine due or late; Early warning score high; Critical lab value; New or changed order; Patient for discharge today
- **Measured by:** Doses on time (95% or more); Assessment within 2 h (100%); Falls per 1,000 patient days (Under 1); Handover completed (100%)

### Doctor (consultant and RMO)

Admits, treats and discharges. The consultant owns the plan; the resident medical officer (RMO) covers rounds and nights.

1. Advises admission with reason and expected stay
2. Initial assessment and plan within 24 h
3. Orders medicines, tests, diet and procedures
4. Daily rounds: progress note, results
5. Asks for cross-consults
6. Orders transfer or ICU when needed
7. Sets expected discharge date a day ahead
8. Signs discharge summary
9. Discharge medicines and follow-up date
10. Completes death or LAMA papers when needed

- **Screens:** In-patient rounds (IpdRounds), Discharge desk (Discharge), Laboratory results (Lab), Discharge summary print (PrintDischarge)
- **Can:** Admit, order, transfer and discharge; Use order sets and templates; Co-sign RMO notes; Approve medically needed upgrades; Start death and LAMA papers
- **Cannot:** Edit signed notes (addendum only); See patients outside own or shared care, without break-glass reason; Change bills; Close a stay without a signed summary
- **Notified when:** New admission under me; Critical result; Early warning score high; Cross-consult request; Summary waiting for signature
- **Measured by:** Assessment within 24 h (100%); Summary signed before 11:00 on discharge day (90%); Average length of stay (Department target); Readmissions within 30 days (Under 5%)

### Pharmacy, lab and diet

Fulfil in-patient orders patient-wise and charge them to the running bill automatically.

1. Pharmacist verifies new medicine orders
2. Issues patient-wise doses to ward
3. STAT orders issued in 15 min
4. Lab collects samples from ward round
5. Critical values phoned and logged
6. Kitchen prepares diets by ward
7. Charges post to the bill automatically
8. Ward returns credited before final bill

- **Screens:** Pharmacy (Pharmacy), Laboratory (Lab), Diet and kitchen (Diet), Inventory (Inventory)
- **Can:** Verify, substitute (with doctor approval) and issue; Accept returns and credit the bill; Release lab reports; Change diet on dietitian advice
- **Cannot:** Issue without a valid order (except emergency with later order); Change prices; Release a report without validation
- **Notified when:** New or STAT order; Discharge planned (returns due); Diet change or nil by mouth; Stock below minimum
- **Measured by:** Order to ward (routine) (Under 2 h); STAT to ward (Under 15 min); Returns credited before bill (100%); Lab turnaround (routine) (Under 4 h)

### In-patient billing

Keeps the running bill right every day so the final bill is ready within minutes of discharge advice.

1. Collects deposit at admission
2. Checks daily auto-charges posted
3. Adds services not auto-charged
4. Tracks deposit balance; sends top-up alerts
5. Prints interim bill on request
6. Applies package and shows extras
7. Prepares final bill on discharge advice
8. Splits insurer and patient share
9. Collects balance or refunds deposit
10. Issues bill clearance to ward

- **Screens:** In-patient bill (IpdBill), Billing counter (Billing), Final bill print (PrintBill), Receipt print (PrintReceipt)
- **Can:** Collect deposits and payments; Add and cancel charges with reason; Print interim and final bills; Refund excess deposit (per approval rule)
- **Cannot:** Give discounts above the limit without approval; Delete posted charges (only reverse with reason); Clear a bill with pending pharmacy returns
- **Notified when:** Discharge advised; Deposit below 20%; Insurer final approval received; Discount approved or rejected
- **Measured by:** Final bill ready (Under 45 min); Missed charges found in audit (Under 1%); Refunds same day (95%); Bill complaints (Under 2%)

### Housekeeping and facility

Turns a vacated bed into a clean, ready bed fast, and fixes what breaks.

1. Gets cleaning task when a patient leaves
2. Assigns staff; starts timer
3. Terminal clean for isolation beds
4. Linen changed; checklist ticked
5. Marks bed ready; bed board turns Available
6. Maintenance tickets for broken items
7. Patient transport requests
8. Biomedical waste pickup logged

- **Screens:** Facility and housekeeping (Facility), Live bed board (Beds)
- **Can:** Accept and close cleaning tasks; Mark a bed ready or blocked; Raise and close maintenance tickets
- **Cannot:** Allocate beds; Change patient records
- **Notified when:** Bed vacated; Cleaning over 45 min; Isolation clean needed; Urgent maintenance
- **Measured by:** Bed turnaround (Under 45 min); Tickets closed same day (90%); Waste log complete (100%); Infection audit score (90% or more)

### IPD admin

Sets up wards, beds, tariffs, packages, deposits, insurers and rules. Changes to money settings need approval.

1. Creates wards, rooms, beds and categories
2. Sets tariffs per bed category
3. Sets deposits and alert levels
4. Builds packages with inclusions
5. Adds insurers, TPAs and rate cards
6. Sets auto-charges and room-rent rules
7. Sets discharge and cleaning targets
8. Maintains consent and summary templates
9. Reviews changes waiting for approval

- **Screens:** IPD settings (IpdConfig), Departments and masters (Departments), Hospital settings (Settings), Live bed board (Beds)
- **Can:** Edit IPD masters and rules; Draft tariff and package changes; Manage insurer panel and rate cards
- **Cannot:** Apply tariff changes without Super Admin approval; Change past bills; Delete a bed that has history (only retire)
- **Notified when:** Tariff change approved or rejected; Insurer panel contract expiring; Package variance high
- **Measured by:** Masters complete at go-live (100%); Package variance (Under 10%); Rate cards current (100%); Settings changes approved (Within 1 day)

### Management

Watches occupancy, length of stay, discharge speed, revenue per bed and quality, and approves exceptions.

1. Morning census and occupancy by ward
2. Expected discharges and admissions
3. Delayed discharges and why
4. Revenue per occupied bed and outstanding
5. Insurance pending and claim ageing
6. Approves discounts, dues and write-offs
7. Reviews deaths, LAMA and incidents
8. Monthly NABH indicators

- **Screens:** IPD analytics (IpdAnalytics), Live bed board (Beds), Discharge desk (Discharge), Approvals (Approvals), Quality (Quality)
- **Can:** See all IPD data across branches; Approve discounts, dues and write-offs; Approve tariff and package changes; Export reports
- **Cannot:** Edit clinical records; Approve own requests
- **Notified when:** Occupancy over 95%; Discharge over 4 h; Death or serious incident; Discount above limit; Daily IPD summary at 08:00
- **Measured by:** Bed occupancy (80 to 90%); Average length of stay (Department target); Revenue per occupied bed (Rising); Discharge turnaround (Under 3 h)

## 13. Capabilities

Market standard = offered by most hospital systems. Advanced = leading or enterprise systems. Our edge = not found in the public material reviewed.

**Admission**

- Admission request from OPD, emergency or doctor (Market standard)
- Estimate with financial counselling, e-signed (Advanced)
- Digital consents in English, Hindi, Marathi (Advanced)
- Barcode wristband and attendant pass (Market standard)
- Planned admission booking with pre-op checks (Advanced)
- ABHA linking at admission (Our edge)

**Beds and transfers**

- Live bed board by ward and status (Market standard)
- Bed categories, tariffs and gender bays (Market standard)
- Bed requests with suggested beds (Advanced)
- Reservation with 2-hour expiry (Advanced)
- Transfers and ICU step-up with handover (Market standard)
- Expected discharges feed bed planning (Advanced)
- Cleaning tasks with turnaround timer (Advanced)

**Insurance and schemes**

- Policy check and pre-authorisation (Market standard)
- IRDAI 1-hour and 3-hour timers (Our edge)
- Enhancement prompt at 90% of approval (Our edge)
- Room-rent limit warning before upgrade (Our edge)
- PM-JAY, CGHS, ECHS and corporate payers (Advanced)
- Claim filing and settlement matching (Advanced)
- Denial to cash conversion (Advanced)

**Ward care**

- Doctor assessment in 24 h, nursing in 2 h (Advanced)
- Daily progress notes and orders (Market standard)
- Barcode medicine round (eMAR) (Advanced)
- Vitals with early warning score (Advanced)
- Intake-output, ICU and wound charts (Market standard)
- Shift handover (SBAR) (Advanced)
- Diet orders to kitchen (Market standard)
- Cross-consultation requests (Market standard)

**Billing**

- Daily auto-charges from census and charts (Advanced)
- Running and interim bills (Market standard)
- Deposit tracking and top-up alerts (Market standard)
- Package billing with extras shown (Market standard)
- Pharmacy returns credited before final bill (Advanced)
- Split bill: insurer, patient, corporate (Advanced)
- Running bill on the attendant’s phone (Our edge)

**Discharge**

- Expected discharge date a day ahead (Advanced)
- Discharge summary from the case record (Market standard)
- Parallel clearance checklist (Advanced)
- Discharge turnaround tracking (Our edge)
- LAMA, death, transfer-out and absconding flows (Market standard)
- Documents on WhatsApp and ABHA (Our edge)
- Follow-up booked automatically (Advanced)

**Analytics and compliance**

- Census, occupancy, length of stay (Market standard)
- Turnover rate and interval (Advanced)
- Revenue per occupied bed day (Advanced)
- Readmission within 30 days (Advanced)
- NABH indicators with formulas (Our edge)
- Medico-legal register and locked records (Advanced)
- Full audit of transfers, charges and approvals (Our edge)

## 14. Competitor benchmark

From public product pages, directory listings and documentation, reviewed October 2026. "Not found" means not confirmed publicly, not that the product lacks it. "Other Epic modules" means the feature sits outside Grand Central. Verify in vendor demos before quoting.

| Capability | Indian HMS vendors (MocDoc and others) | KareXpert Smart Hospital | Epic Grand Central | Bahmni | Ours |
|---|---|---|---|---|---|
| Admission, transfer and discharge | Yes | Yes | Yes | Yes | Yes |
| Live bed board and occupancy | Yes | Yes | Yes | Yes | Yes |
| Room transfers | Yes | Yes | Yes | Yes | Yes |
| Housekeeping task when a bed is vacated | Not found | Not found | Yes | Not found | Yes |
| Predictive capacity or expected discharges | Not found | Not found | Yes | To-be-discharged queue | Yes |
| Physician orders and nursing notes | Yes | Not found | Other Epic modules | Not found | Yes |
| IP bill with department breakdown | Yes | Not found | Other Epic modules | Via Odoo | Yes |
| On-the-spot or interim bills | Yes | Not found | Other Epic modules | Not found | Yes |
| Insurance and TPA claim management | Yes | Not found | Other Epic modules | Not found | Yes |
| Pre-auth with IRDAI time limits | Not found | Not found | Not found | Not found | Yes |
| Room-rent limit warning on upgrade | Not found | Not found | Not found | Not found | Yes |
| Discharge summary generation | Yes | Discharge automation | Other Epic modules | Not found | Yes |
| Running bill visible to family | Not found | Not found | Not found | Not found | Yes |
| ABDM and ABHA | Vendor claims | Not found | Not found | Not found | Yes |
| PM-JAY and CGHS packages | Not found | Not found | Not found | Not found | Recorded; portal entry manual |
| Discharge turnaround analytics | Not found | Not found | Yes | Not found | Yes |

Sources:

- MocDoc, overcoming in-patient management software challenges: https://mocdoc.com/blog/overcoming-inpatient-management-software-challenges
- Codingclave hospital management software: https://codingclave.com/products/hospital-management-software
- Doctors App IPD software: https://www.doctorsapp.in/ipd
- OneCity patient management software (OPD/IPD, ABHA): https://onecity.co.in/patient-management-software-bangalore
- KareXpert Smart Hospital on Capterra: https://www.capterra.com/p/186949/Smart-Hospital/
- KareXpert Smart Hospital on GetApp: https://www.getapp.com/healthcare-pharmaceuticals-software/a/smart-hospital/
- KareXpert, emergency medicine blog: https://www.karexpert.com/blogs/from-er-chaos-to-systemized-care-how-karexpert-is-transforming-emergency-medicine/
- Epic Grand Central (IntuitionLabs): https://intuitionlabs.ai/software/healthcare-provider-operations/bed-management-and-patient-flow/epic-grand-central
- Epic Grand Central (Alberta Connect Care): https://ehealth.connect-care.ca/epic-systems/epic-modules/grand-central
- Grand Central capacity poster, NSUH 2025: https://academicworks.medicine.hofstra.edu/nsuh_ccc_posters/2025/posters/21
- Bahmni Bed Management: https://bahmni.atlassian.net/wiki/spaces/BAH/pages/699400201/Bed+Management+BM
- Bahmni In-Patient Management (IPD): https://bahmni.atlassian.net/wiki/spaces/BAH/pages/32604214/In-Patient+Management+IPD
- IRDAI 2024 master circular timelines (BusinessWorld): https://businessworld.in/article/cashless-claims-within-an-hour-discharge-from-hospital-in-3-hrs-irdai-521477
- IRDAI 2024 master circular (The Week): https://www.theweek.in/news/india/2024/05/30/irdai-issues-new-master-circular-to-make-health-insurance-claims-process-more-seamless.amp.html
- Indicator formulas, MJPJAY output indicators: https://www.jeevandayee.gov.in/MJPJAY/RGJAYDocuments/List_of_35_Output_Indicators_and_Software_User_Manual.pdf

Check the IRDAI circular text itself and the current NABH indicator guide before using these timelines and formulas for compliance.

## 15. Screens

| Screen | Role | Board |
|---|---|---|
| Attendant mobile screens | Patient, attendant | PortalStay |
| Admit patient | Admission desk | Admission |
| Live bed board | Admission desk, ward, housekeeping | Beds |
| Bed requests and transfers | Ward in-charge, admission desk | IpdBedRequests |
| Insurance and TPA desk | Billing Manager (TPA desk) | IpdTpa |
| In-patient bill | Cashier | IpdBill |
| In-patient rounds | Doctor | IpdRounds |
| Nursing station (MAR, vitals, charts) | Staff nurse | Nursing |
| Discharge desk | Doctor, billing | Discharge |
| Diet and kitchen | Dietitian, nurse | Diet |
| Facility and housekeeping | Housekeeping | Facility |
| IPD settings | Hospital Admin | IpdConfig |
| IPD analytics | Management | IpdAnalytics |
| Final bill and discharge summary prints | Billing, doctor | PrintBill, PrintDischarge |
