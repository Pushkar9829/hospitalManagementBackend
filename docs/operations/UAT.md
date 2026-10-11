# User acceptance test scripts (pilot hospital)

Run on a staging copy loaded with the pilot hospital's own masters (departments, doctors,
services and tariff, wards and beds, items, staff). Each script is done by the person who will
do the job after go-live, with a supervisor watching. Mark each step Pass or Fail; a Fail gets
a ticket number. A module goes live only when every script is signed.

Sign-off per script: **Tester** (name, role, date) · **Supervisor** (name, date) · **HMS** (name, date).

---

## 1. Front office and patients (front office, cashier)

| # | Step | Expected |
|---|---|---|
| 1.1 | Quick-register a walk-in with name, age, mobile | UHID issued; welcome SMS queued; card prints |
| 1.2 | Register the same person again | Duplicate warning with the existing UHID |
| 1.3 | Full registration of a child with a guardian, regional-script name | Saved; relation and guardian shown on the banner |
| 1.4 | Search by UHID, by mobile, by part of the name | Each finds the patient |
| 1.5 | Open the record: Visits, Admissions, Reports, Medicines tabs and the summary | Match what the patient actually had |
| 1.6 | Record and withdraw a consent | Withdrawal needs a reason; history kept |

## 2. OPD (front office, nurse, doctor, cashier)

| # | Step | Expected |
|---|---|---|
| 2.1 | Book a slot; book the same slot again | Second booking refused with the next free time |
| 2.2 | Check in; token printed | Token shows on the Queue TV within 10 seconds |
| 2.3 | Register a Queue TV in OPD settings and open its link on the TV | Tokens and rooms only, no patient names; announcement after one tap |
| 2.4 | Triage with vitals (cardiology) | Doctor's queue shows the patient after triage |
| 2.5 | Consultation: penicillin-allergic patient prescribed amoxicillin | Allergy warning; doctor must acknowledge |
| 2.6 | Sign with diagnosis, orders and prescription | Orders reach lab and pharmacy; bill has the charges |
| 2.7 | Follow-up within the free window | No fee charged |
| 2.8 | Cancel a paid appointment | Refund per the cancellation rule |

## 3. Billing and cashier (cashier, billing manager)

| # | Step | Expected |
|---|---|---|
| 3.1 | Open a shift; take cash, UPI and card payments | Receipts print; shift totals match |
| 3.2 | Discount above the cashier's limit | Goes for approval; bill held until decided |
| 3.3 | Cancel a bill | Approval needed; credit note issued |
| 3.4 | Close the shift with a variance | Variance above the limit needs approval |
| 3.5 | Day-end: card and UPI settlement, bank deposit slip, day lock | After the lock, no payment can be dated that day |
| 3.6 | Corporate credit bill, month invoice, payment against it | Ageing updates; finance shows the receipt |

## 4. IPD, nursing and insurance (front office, nurse, doctor, TPA, cashier)

| # | Step | Expected |
|---|---|---|
| 4.1 | Admission request from OPD with estimate; bed held | Bed shows reserved on the bed board |
| 4.2 | Admit with deposit; wristband prints | Bed occupied; deposit on the IP bill |
| 4.3 | Medicine order; pharmacist verifies; nurse gives with wristband scan | MAR records time and nurse; high-alert drug needs a second nurse |
| 4.4 | Vitals with a high NEWS2 | RMO alerted |
| 4.5 | Transfer bed | Room rent changes from the next census |
| 4.6 | Cashless pre-auth; insurer reply overdue | Alert to the TPA desk after one hour |
| 4.7 | Discharge summary signed; final bill; dues approval; discharge | Bed goes to cleaning; record opens for MRD coding |

## 5. Laboratory (phlebotomist, technician, pathologist)

| # | Step | Expected |
|---|---|---|
| 5.1 | Collect with wristband scan; labels print per container | Unpaid OPD test cannot be collected |
| 5.2 | Receive; reject one as haemolysed | Recollection requested; patient SMS (non-sensitive test) |
| 5.3 | QC run out of control | Analyser's patient results held |
| 5.4 | Critical value | Call with read-back recorded; HOD escalation if not called in time |
| 5.5 | Verify and release (two people) | Report PDF; doctor sees it in the patient record |
| 5.6 | Home collection booked, assigned, collected | Sample reaches receipt with the visit number |

## 6. Radiology (radiology desk, radiologist)

| # | Step | Expected |
|---|---|---|
| 6.1 | Book a CT with contrast | Creatinine and consent checked before the scan |
| 6.2 | Ultrasound of a pregnant patient | PCPNDT Form F required |
| 6.3 | Report and sign by another radiologist | Report reaches the record; critical finding phoned |

## 7. Pharmacy and inventory (pharmacist, store)

| # | Step | Expected |
|---|---|---|
| 7.1 | Dispense an OPD prescription | FEFO batch picked; expired batch blocked |
| 7.2 | Substitute a brand | Patient consent recorded |
| 7.3 | Schedule H1 drug | Register entry with prescriber details |
| 7.4 | Child dose above the weight limit | Warning |
| 7.5 | PO, GRN with a price above the PO | Approval needed; stock and payable update |
| 7.6 | Requisition from reorder level; transfer between stores | Stock moves; ledger shows both sides |

## 8. HR, payroll and finance (HR, payroll, accounts)

| # | Step | Expected |
|---|---|---|
| 8.1 | Leave request by an employee; manager approves | Balance reduces; roster shows the gap |
| 8.2 | Attendance import; month lock | Payroll reads the locked days |
| 8.3 | Payroll run for 50 sample employees | Matches the hospital's manual calculation to the rupee |
| 8.4 | Release payroll; bank file | HR then finance approve; bank file totals match |
| 8.5 | Trial balance after the test month | Balances; P&L and balance sheet agree |
| 8.6 | Vendor payment with TDS; petty cash expense above the limit | TDS payable posted; petty cash waits for approval |

## 9. Administration and security (Super Admin, admin, auditor)

| # | Step | Expected |
|---|---|---|
| 9.1 | Create a user with a privileged role | Needs Super Admin approval |
| 9.2 | Privileged user signs in | Two-factor set-up forced |
| 9.3 | Reset a lost two-factor device | Reason required; user must set it up again |
| 9.4 | Audit log: who opened a patient record today | Listed with time and user |
| 9.5 | Export patients CSV | Super Admin only; export appears in the audit log |
| 9.6 | Restore drill on staging (`npm run db:restore-drill`) | Every collection matches; time recorded |

## Parallel run (billing and pharmacy, 2–3 days)

Run the old system and HMS side by side. Each evening compare: number of bills, total billed,
total collected by mode, pharmacy sales and stock of 20 fast-moving items. Differences are
explained and fixed before the old system is switched off.
