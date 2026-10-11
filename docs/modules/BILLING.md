# Billing, Payments and Insurance - module specification

Module 3 of 16. Design boards: canvas pages "Billing 1 · Module flow end to end" and "Billing 2 · Role-wise flows" (https://claude.ai/artifact/Fnp7CKPFT5jbiEFyMFNRq2). Board sources are in docs/ui-design/boards (Bill*.dc.html, PortalPay.dc.html); generators in docs/ui-design/source/bill. The in-patient insurance and TPA flow is in IPD.md.

## 1. Scope

Everything from the first charge to the ledger: payer-based pricing, OPD, IPD, pharmacy, walk-in and miscellaneous bills, deposits, every payment mode (UPI, card, cash, cheque, bank transfer, wallet, payment link), discounts, cancellations and refunds with approval, insurance, scheme and corporate shares, corporate credit and e-invoices, cashier shifts, day-end close, GST and revenue analytics. Insurance pre-authorisation and claims for in-patients are specified in IPD.md and reused here.

## 2. End-to-end flow (charge to ledger)

| Step | Who | What happens |
|---|---|---|
| 1 | Front office and admission | **Payer set.** Cash, corporate, insurer or scheme; price list follows the payer |
| 2 | Clinical (doctor, nurse, lab, pharmacy) | **Services ordered.** Consult, tests, procedures, medicines, room |
| 3 | System (automatic) | **Charges captured.** Priced by payer list; package and GST rules applied |
| 4 | Cashier | **Bill raised.** OPD pay first; IPD running bill and deposit |
| 5 | Patient and payer | **Pays.** UPI, card, cash, cheque, wallet or split |
| 6 | System (automatic) | **Receipt.** Printed and sent on WhatsApp; posted to day book |
| 7 | Cashier | **Discount or refund asked.** Always with a reason |
| 8 | Billing manager | **Approves.** Maker-checker; Super Admin above the limit |
| 9 | Insurance and corporate desk | **Payer share billed.** Insurer claim or corporate invoice; patient pays the rest |
| 10 | Cashier | **Shift closed.** Cash counted by note; card and UPI matched; handover |
| 11 | Billing manager | **Day-end verified.** Variances explained before the day locks |
| 12 | Accounts | **Banked and reconciled.** Deposit slip, bank statement and settlements matched |
| 13 | System (automatic) | **Posted to ledger.** Revenue by department, receivables by payer, GST |
| 14 | Accounts | **Receivables chased.** Corporate, insurer and patient dues by age |
| 15 | System (automatic) | **Revenue analytics.** By service, payer, doctor; collection and leakage |

Nothing is deleted: every charge has a source, and mistakes are cancelled or reversed with a reason, an approval and a credit note. Steps 2 to 6 repeat all day at every counter; steps 10 to 13 close each shift and each day.

## 3. Alternate and exception flows

- **A. Walk-in test only.** Patient walks in with an outside prescription; Quick registration; Tests priced by payer list; Paid before sample or scan; Report and receipt on WhatsApp.
- **B. Pharmacy counter sale.** Prescription scanned or typed; Batches picked, earliest expiry first; GST by HSN on the bill; Paid; return within policy gives a credit note.
- **C. Package.** Package chosen at estimate; Charges inside the package show as included; Extras billed separately and shown daily; Variance reported to admin.
- **D. Deposit and refund.** Deposit collected at admission; Top-ups when 80% used; Final bill adjusts all deposits; Excess refunded to original mode same day.
- **E. Cancel after payment.** Cashier requests cancellation with reason; Billing Manager approves; Credit note issued; number kept; Refund paid; audit trail complete.
- **F. Discount.** Cashier asks with reason; Billing Manager up to 10% or ₹10,000; Super Admin above that; Bill recalculates; patient notified.
- **G. Corporate credit.** Employee shows letter of credit; Patient pays nothing within limit; Monthly invoice; e-invoice when taxable; Payment matched; ageing tracked.
- **H. Insurance split.** Approved amount on the bill; Non-payables and co-pay to patient; Insurer share to claim; Deductions booked with reason.
- **I. Government scheme.** Scheme package fixed; Patient pays nothing for the package; Claim with scheme documents; Payment matched on receipt.
- **J. Wallet and membership.** Health card or wallet linked; Member price list applied; Pays from wallet, tops up by UPI; Balance on the receipt.
- **K. Concession.** Staff, family or free-care policy; Policy picks the discount; Approval if above policy; Concession report monthly.
- **L. Payment failed or pending.** UPI paid but no receipt (timeout); Bill shows payment pending; Webhook or settlement confirms; Receipt sent; no double charge.
- **M. Cheque bounce.** Cheque deposited; Bank returns it; Receipt reversed; dues reopened; Patient informed; charges as per policy.
- **N. Miscellaneous bill.** Certificate, record copy, attendant meal; Service from misc price list; Paid at counter; Revenue to the right head.

## 4. Status lifecycles

| Object | Normal path | Side exits (from) |
|---|---|---|
| Bill | Draft → Final → Partly paid → Paid | Cancelled (credit note) (Final), Dues approved (Partly paid), Refunded (Paid) |
| Payment | Initiated → Captured → Settled → Reconciled | Failed or timed out (Initiated), Cheque bounced (Captured), Refunded (Reconciled) |
| Discount request | Requested → Approved L1 → Approved L2 → Applied | Rejected (Requested), Expired (48 h) (Approved L1) |
| Refund | Requested → Approved → Paid → Confirmed by bank | Rejected (Requested), Failed: retry (Paid) |
| Cashier shift | Opened → Billing → Counted → Handed over → Verified | Variance: reason needed (Counted) |
| Corporate invoice | Draft → Issued → e-Invoice (IRN) → Part paid → Paid | Disputed (Issued), Written off (approval) (Part paid) |

The API rejects any status change not listed; every change stores time and user.

## 5. Business rules

Enforced by the API; the UI only explains them. Values in brackets are defaults on the Billing Settings screen.

| No. | Rule | Detail |
|---|---|---|
| R1 | Price by payer | Every line is priced from the payer’s price list (general, staff, senior citizen, member, corporate, insurer, scheme); missing items fall back to the general list. |
| R2 | Pay before service in OPD | OPD consultations and tests are paid before service, except credit, corporate, scheme and emergency patients. |
| R3 | Every charge has a source | Charges come from orders, the midnight census, charts or the pharmacy. Manual lines need a reason and are reported daily. |
| R4 | Nothing is deleted | A wrong bill is cancelled with a credit note and a reason after approval. Numbers are never reused; the series has no gaps. |
| R5 | Discounts | Cashiers cannot give discounts. Billing Manager approves up to [10% or ₹10,000]; Super Admin above that. Concession policies apply automatically. |
| R6 | Refunds | Go back to the original payment mode. Billing Manager approves up to [₹25,000]; Finance Controller above that. |
| R7 | Cash limit | No cash receipt of ₹2,00,000 or more from one person in a day, for one transaction or one event (Income-tax Act, section 269ST). The counter blocks it and suggests UPI, card or transfer. |
| R8 | GST on health care | Health care services by a clinical establishment are exempt. Non-ICU rooms above [₹5,000] a day carry 5% GST without input credit. OPD pharmacy sales and other taxable items carry GST by HSN or SAC. Rates are settings; confirm with the hospital’s CA. |
| R9 | e-Invoice | Taxable B2B invoices (for example to corporates) get an IRN and QR when the hospital is above the e-invoicing turnover threshold [₹5 crore]. |
| R10 | Open shift | A cashier cannot bill without an open shift. Shift opens with opening cash and one counter per cashier. |
| R11 | Close shift | Cash is counted note by note; card and UPI totals are matched with the devices. A variance above [₹100] needs a reason and Billing Manager verification. |
| R12 | Day lock | The day locks after all shifts are verified [by 23:00]. Changes after lock need Finance Controller to reopen. |
| R13 | Deposits | Deposits are adjusted on the final bill; any excess is refunded the same day to the original mode. |
| R14 | Dues | Leaving with dues needs approval (Medical Superintendent for in-patients). Dues follow the patient and show at the next visit. |
| R15 | Corporate credit | Within the credit limit and period only. Over-limit visits need Billing Manager approval. Invoices go out by the [5th] of the month. |
| R16 | Insurance share | The approved amount is the insurer share; non-payable items and co-pay are the patient share; deductions are booked with a reason. |
| R17 | Payment pending | If UPI or card confirms late, the bill shows Payment pending. The gateway webhook or next-day settlement confirms it; a second charge is blocked. |
| R18 | Duplicate prints | Reprints carry a DUPLICATE watermark and are logged with user and reason. |
| R19 | Write-off | Write-offs need Finance Controller and Super Admin approval and post to a separate ledger. |
| R20 | Ledger posting | Every bill, receipt, refund and credit note posts to the ledger automatically by department, payer and tax head. |

## 6. Settings (Billing Settings screen)

Per branch unless noted.

| Setting | Level | Default |
|---|---|---|
| Bill series and numbering | Branch | OP/, IP/, PH/, MS/ per financial year |
| Payment modes and devices | Counter | UPI, card, cash, cheque, bank transfer, wallet |
| Price lists and payer mapping | Branch | General, staff, senior, member, corporate, insurer, scheme |
| Discount and concession rules | Branch | 10% or ₹10,000 for Billing Manager |
| GST rates, HSN and SAC | Tenant | Health care exempt; non-ICU room above ₹5,000 at 5% |
| e-Invoice | Tenant | On for taxable B2B |
| Refund and deposit rules | Branch | Original mode; same-day excess refund |
| Cash rules | Branch | ₹2,00,000 limit; ₹100 variance |
| Receipt and bill templates | Branch | A4 bill, 80 mm receipt, English and Hindi |
| Day lock time | Branch | 23:00 |

## 7. Notifications

SMS uses DLT-approved templates; WhatsApp needs patient consent.

| Event | To | Channel | Message |
|---|---|---|---|
| Payment received | Patient | WhatsApp, SMS | Receipt link |
| Bill changed after payment | Patient | WhatsApp, SMS | Credit note and reason |
| Discount request | Billing Manager | In-app | Patient, amount, reason |
| Refund paid | Patient | SMS | Amount and mode |
| Payment pending over 15 min | Cashier | In-app | Bill and reference |
| Shift variance | Billing Manager | In-app | Cashier, amount, reason |
| Day not locked by 23:00 | Billing Manager, Accounts | In-app, e-mail | Shifts not verified |
| Corporate limit 90% used | Corporate desk | In-app, e-mail | Company, balance |
| Dues reminder | Patient | SMS, WhatsApp | Amount and pay link |
| Daily revenue summary | Management | E-mail | 21:00 each day |

## 8. Reports

All export to Excel and PDF; schedulable.

| Report | For | Key columns |
|---|---|---|
| Daily collection by cashier and mode | Billing Manager | Shift, UPI, card, cash, cheque, variance |
| Revenue by service group and department | Management | Gross, discount, net |
| Revenue by payer | Management, Accounts | Cash, corporate, insurer, scheme |
| Doctor-wise revenue | Management | OPD, IPD, procedures |
| Discounts and concessions | Billing Manager, Auditor | Approver, reason, amount |
| Cancellations and refunds | Auditor | Bill, reason, approver |
| Unbilled and manual charges | Billing Manager | Source, user, reason |
| Receivables ageing | Accounts | 0-30, 31-60, 61-90, over 90 days |
| Deposits held | Accounts | Patient, deposit, used, balance |
| GST summary | Accounts | Taxable value, GST by rate, exempt value |
| Reprinted bills | Auditor | User, reason, count |
| Package variance | Admin | Package, price, actual cost |

## 9. Measures and formulas

Used on the Billing analytics screen.

| Measure | Formula | Notes |
|---|---|---|
| Collection efficiency | Amount collected × 100 ÷ amount billed (same period) | Excludes insurer and corporate credit until due |
| Days to collect (DSO) | Receivables ÷ average daily billing | By payer type |
| Discount rate | Discounts × 100 ÷ gross billing | Target under 2% |
| Refund and cancellation rate | Refunds and credit notes × 100 ÷ gross billing | By reason |
| Manual charge share | Manual lines × 100 ÷ all lines | Leakage and fraud signal |
| Unbilled at discharge | Charges posted after final bill | Should be zero |
| Digital payment share | UPI, card and transfer × 100 ÷ all receipts | Rising is better |
| Cash variance | Counted cash − expected cash | Per shift |
| Claim deduction rate | Deductions × 100 ÷ claimed amount | By insurer |

## 10. Edge cases

How the system behaves.

| Case | Behaviour |
|---|---|
| UPI paid but app timed out | Bill shows Payment pending; webhook confirms; no second charge allowed |
| Patient pays for two family members | One receipt, split across both bills |
| Price changes mid-stay | Charges keep the price on the date of service |
| Corporate letter expires mid-stay | Later charges move to patient share unless renewed; desk alerted |
| Insurer approves less than billed | Difference to patient share; deposit asked |
| Cheque bounces after discharge | Receipt reversed, dues reopened, patient informed |
| Refund to a closed card | Bank transfer with patient consent and ID |
| Network down at counter | Offline receipts from a reserved series; synced and checked when back |
| Two cashiers on one counter | Blocked; each cashier has own shift and drawer |
| Cash of ₹2 lakh or more offered | Blocked at the counter; other modes suggested; attempt logged |
| Bill needed in patient’s company name | Corporate details and GSTIN on the invoice; e-invoice if taxable |

## 11. Acceptance tests (sample)

Run on staging with pilot hospital masters.

| Test | Steps | Pass when |
|---|---|---|
| Payer pricing | Bill the same test for cash and corporate patients | Prices match each price list |
| Discount approval | Cashier asks 15% | Billing Manager then Super Admin approve; bill updates |
| Cancel after payment | Cancel a paid bill | Credit note issued; number kept; refund approval created |
| Cash limit | Try ₹2,10,000 cash for one patient in a day | Blocked with message |
| Room GST | Admit to a ₹6,500 private room | 5% GST on room rent only |
| Shift close | Close with ₹300 short | Reason required; Billing Manager must verify |
| Payment pending | Simulate UPI timeout | Bill pending; webhook confirms; no double charge |
| Day lock | Edit a bill after lock | Blocked; reopen request to Finance Controller |
| Ledger posting | Run a day of 100 bills | Revenue, receivables and GST ledgers match the bills |

## 12. Role-wise flows

Each role works in its own panel and sees only its own billing work.

### Patient and payer

Sees every bill, pays from the phone and gets receipts without visiting a counter. Families pay for each other.

1. Sees the fee before booking or the estimate before admission
2. Pays online by UPI or card, or at the counter
3. Gets the receipt on WhatsApp and SMS
4. Sees the running bill and deposit during a stay
5. Tops up the deposit or wallet by UPI
6. Asks for a refund or raises a billing complaint
7. Downloads bills for insurance reimbursement
8. Sees dues and pays them on the next visit

- **Screens:** Patient payments on the phone (PortalPay), Patient portal home (Portal), Attendant stay screens (PortalStay), Receipt print (PrintReceipt)
- **Can:** Pay own and family bills; Download bills and receipts; Top up wallet and deposit; Ask for a refund; Raise a billing complaint
- **Cannot:** Change a bill; Pay cash of ₹2,00,000 or more in a day (law); See another family's bills
- **Notified when:** Bill ready or changed; Payment received; Deposit 80% used; Refund paid; Dues reminder
- **Measured by:** Online share of payments (Rising month on month); Billing complaints (Under 1% of bills); Refund time (Same day); Receipts sent digitally (95% or more)

### Cashier

Runs one counter for one shift: bills, deposits, payments and receipts. Cannot change prices or give discounts alone.

1. Opens shift with opening cash
2. Finds the patient; charges already on the bill
3. Adds services not ordered electronically (with reason)
4. Collects by UPI, card, cash, cheque, wallet or split
5. Prints or sends the receipt
6. Asks for discount or cancellation with reason
7. Collects deposits and pays approved refunds
8. Counts cash by note at shift end
9. Matches card and UPI totals to the devices
10. Hands over to the next cashier or closes

- **Screens:** Billing counter (Billing), Cashier shift (BillShift), In-patient bill (IpdBill), Receipt print (PrintReceipt)
- **Can:** Create bills and receipts; Collect deposits; Request discounts, cancellations and refunds; Close own shift
- **Cannot:** Change tariffs; Approve any discount or refund; Delete a bill (only cancel with approval); Bill without an open shift; Accept cash of ₹2,00,000 or more from one person in a day
- **Notified when:** Discount approved or rejected; Refund approved; Payment pending confirmation; Shift variance found
- **Measured by:** Bill time per patient (Under 2 min); Shift variance (Under ₹100); Digital payment share (70% or more); Manual charges (Under 5% of lines)

### Billing manager

Owns pricing exceptions, approvals and the daily close. Checker for discounts, cancellations and refunds.

1. Starts with pending approvals
2. Approves discounts within limit, routes the rest
3. Approves cancellations and refunds
4. Audits IPD final bills before release
5. Watches unbilled charges and package variance
6. Verifies every cashier shift at day end
7. Locks the day after variances are explained
8. Reviews dues and approves write-off requests
9. Sends corporate invoices each month

- **Screens:** Approvals (Approvals), Shifts and day-end (BillShift), Corporate and credit (BillCorporate), Billing analytics (BillAnalytics)
- **Can:** Approve discounts up to 10% or ₹10,000; Approve cancellations and refunds up to ₹25,000; Verify shifts and lock the day; Issue corporate invoices
- **Cannot:** Approve own requests; Change tariffs (Admin with Super Admin approval); Write off dues alone
- **Notified when:** New approval request; Shift variance over ₹100; Final bill waiting for audit; Corporate over credit limit
- **Measured by:** Approvals within 30 min (90%); Day locked by 23:00 (Every day); Discounts (Under 2% of gross); Unbilled charges at discharge (Zero)

### Corporate and credit desk

Looks after companies, PSUs and partner organisations whose employees are treated on credit.

1. Sets up the corporate: rate card, credit limit and period
2. Checks the letter of credit at the visit
3. Watches utilisation against the limit
4. Raises the monthly invoice with supporting bills
5. Generates the e-invoice (IRN) for taxable lines
6. Sends the invoice and tracks acceptance
7. Matches payments and books short payments
8. Chases dues by age; stops credit when overdue

- **Screens:** Corporate and credit (BillCorporate), Billing counter (Billing), Finance receivables (Finance)
- **Can:** Manage corporate accounts and rate cards; Issue invoices and e-invoices; Record payments and deductions; Put a corporate on hold
- **Cannot:** Extend credit above the limit without approval; Write off balances
- **Notified when:** Credit limit 90% used; Invoice overdue; Payment received; e-Invoice failed
- **Measured by:** Invoices sent by the 5th (100%); Days to collect (Under 45); Disputed amount (Under 3%); Over-limit visits (Zero without approval)

### Insurance desk

Turns insurer and scheme approvals into paid claims. The full in-patient flow is on the IPD pages.

1. Pre-authorisation and reply timers
2. Approved amount sits on the bill
3. Bill split into insurer and patient share
4. Final approval before discharge
5. Claim filed with documents
6. Settlement matched; deductions booked
7. Denials reviewed and reasons coded

- **Screens:** Insurance and TPA desk (IpdTpa), In-patient bill (IpdBill), IPD role flow (IpdRoleTpa)
- **Can:** Send pre-authorisations and claims; Split bills by payer; Record settlements and deductions
- **Cannot:** Change clinical records; Write off deductions without approval
- **Notified when:** Insurer reply; Final approval late; Settlement short-paid
- **Measured by:** Claim deductions (Under 5%); Claims unpaid over 45 days (Under 10%); Denial rate (Under 3%); Final approval time (Under 3 h)

### Pharmacy counter

Sells to out-patients with GST by HSN and issues to in-patients against their bill.

1. Prescription arrives from the doctor's queue
2. Batches picked, earliest expiry first
3. Member and corporate prices applied
4. GST shown per item
5. Paid at the pharmacy counter or added to the visit bill
6. Returns within policy give a credit note
7. Shift closed with the same cash rules

- **Screens:** Pharmacy (Pharmacy), Cashier shift (BillShift), Prescription print (PrintRx)
- **Can:** Bill pharmacy sales and returns; Issue to in-patients
- **Cannot:** Sell scheduled drugs without a prescription; Change prices; Give discounts above policy
- **Notified when:** New prescription; Return requested; Stock below minimum
- **Measured by:** Prescriptions filled in-house (85% or more); Bill time (Under 3 min); Return rate (Under 2%); Expiry write-off (Under 0.5% of sales)

### Accounts

Receives every bill and receipt as ledger entries, reconciles the bank and chases receivables.

1. Sees auto-posted revenue and receipts
2. Matches cash deposits to bank
3. Matches card and UPI settlements
4. Clears cheques; handles bounces
5. Reviews receivables by payer and age
6. Books insurer deductions and write-offs (approved)
7. Files GST returns from billing data
8. Closes the month

- **Screens:** Finance (Finance), Billing analytics (BillAnalytics), Shifts and day-end (BillShift)
- **Can:** Reconcile bank and settlements; Post approved write-offs; Run GST and revenue reports
- **Cannot:** Change bills or receipts; Reopen a locked day without Finance Controller
- **Notified when:** Settlement mismatch; Cheque bounced; Day not locked; Receivable over 90 days
- **Measured by:** Bank reconciled (Daily); Unmatched settlements (Zero after 2 days); Receivables over 90 days (Under 10%); Month closed by (5th working day)

### Auditor

Read-only. Checks that money rules were followed and that every exception has an approval and a reason.

1. Reviews system-picked exceptions
2. Samples cancelled and reprinted bills
3. Checks discounts against the approval log
4. Checks cash receipts against the legal limit
5. Matches day books to bank
6. Reports findings

- **Screens:** Auditor home (HomeAuditor), Audit log (AuditLog), Finance (Finance), Approvals history (Approvals)
- **Can:** See all billing, finance and audit data; Export reports
- **Cannot:** Change anything; Approve anything
- **Notified when:** Weekly exception summary
- **Measured by:** Exceptions explained (100%); Findings closed (Within 30 days); Cash limit breaches (Zero); Unapproved discounts (Zero)

### Management

Watches revenue, collections, leakage and dues; final approver for large discounts and write-offs.

1. Revenue today and month to date
2. Collection against billing
3. Revenue by service, payer and doctor
4. Discounts, cancellations and refunds trend
5. Dues by payer and age
6. Approves large discounts and write-offs
7. Monthly review with accounts

- **Screens:** Billing analytics (BillAnalytics), Admin dashboard (Dashboard), Approvals (Approvals), Billing settings (BillConfig)
- **Can:** See all billing data; Approve level-2 discounts and write-offs; Approve tariff changes
- **Cannot:** Approve own requests
- **Notified when:** Discount above 10%; Day not locked; Collection below 95%; Daily revenue summary at 21:00
- **Measured by:** Collection efficiency (95% or more); Discounts (Under 2% of gross); Days to collect (Under 30); Revenue leakage found (Falling)

## 13. Capabilities

Market standard = offered by most hospital systems. Advanced = leading or enterprise systems. Our edge = not found in the public material reviewed.

**Charge capture**

- Charges from orders, census and charts (Advanced)
- Payer-based price lists (Market standard)
- Packages with included and extra items (Market standard)
- Manual charges only with reason (Advanced)
- Unbilled charge alerts before discharge (Our edge)
- Miscellaneous bills (certificates, copies, meals) (Market standard)

**Bills and payments**

- OPD, IPD, pharmacy and walk-in bills (Market standard)
- UPI, card, cash, cheque, bank transfer, wallet (Market standard)
- Split payment across modes (Advanced)
- UPI and card devices matched to the bill (Our edge)
- Payment pending state for timeouts (Our edge)
- E-receipts on WhatsApp and SMS (Advanced)

**Deposits, discounts and refunds**

- Deposits and top-ups (Market standard)
- Discounts with two-level approval (Advanced)
- Concession policies (staff, free care) (Advanced)
- Cancellation by credit note, never delete (Advanced)
- Refund to original mode (Advanced)
- Dues with approval, shown at next visit (Advanced)

**Payers**

- Insurer, TPA and scheme shares on one bill (Advanced)
- Corporate credit limits and periods (Market standard)
- Monthly corporate invoices (Market standard)
- e-Invoice (IRN) for taxable B2B lines (Our edge)
- Memberships and wallet (Advanced)
- Receivables ageing by payer (Market standard)

**Counter control**

- Shift open with opening cash (Advanced)
- Note-by-note cash count (Advanced)
- Shift handover between cashiers (Advanced)
- Day-end verification and lock (Our edge)
- Duplicate prints watermarked and logged (Advanced)
- Cash limit of ₹2 lakh enforced (Our edge)

**Tax and accounts**

- GST by HSN and SAC on taxable items (Market standard)
- Room-rent GST rule for non-ICU rooms (Our edge)
- Auto-posting to ledger (Advanced)
- Bank and settlement reconciliation (Advanced)
- GST return data (Market standard)
- Tally export (Market standard)

**Analytics and audit**

- Revenue by service, payer, doctor (Market standard)
- Collection efficiency and days to collect (Advanced)
- Discount, refund and cancellation trends (Advanced)
- Revenue leakage measures (Our edge)
- Auditor exception list (Our edge)

## 14. Competitor benchmark

From public product pages, directory listings and documentation, reviewed October 2026. "Not found" means not confirmed publicly, not that the product lacks it. "Other Epic modules" means the feature sits outside Grand Central. Verify in vendor demos before quoting.

| Capability | Indian HMS vendors (MocDoc and others) | KareXpert Smart Hospital | Epic Grand Central | Bahmni | Ours |
|---|---|---|---|---|---|
| OPD and IPD billing | Yes | Yes | Yes | Via Odoo | Yes |
| Pharmacy billing | Yes | Not found | Other Epic modules | Via Odoo | Yes |
| Insurance management | Yes | Not found | Yes | Not found | Yes |
| Charge capture from clinical documentation | Not found | Not found | Yes | Not found | Yes |
| Claim follow-up work queues | Not found | Not found | Yes | Not found | Yes |
| Denial workflow and appeals | Not found | Not found | Yes | Not found | Yes |
| Revenue reports | Yes | Not found | Yes | Via Odoo | Yes |
| Discounts on invoices | Not found | Not found | Not found | Via Odoo | Yes |
| Discount approval (maker-checker) | Not found | Not found | Not found | Not found | Yes |
| Cashier shift and day-end close | Not found | Not found | Not found | Not found | Yes |
| UPI device matching | Not found | Not found | Not found | Not found | Yes |
| GST and e-invoice for hospitals | Vendor claims GST | Not found | Not found | Not found | Yes |
| Corporate credit limits | Not found | Not found | Not found | Not found | Yes |
| Patient payment portal | Some vendors | Not found | Not found | Not found | Yes |
| Cash limit (section 269ST) | Not found | Not found | Not found | Not found | Yes |
| Revenue leakage measures | Not found | Not found | Not found | Not found | Yes |

Sources:

- MocDoc HMS on G2: https://www.g2.com/products/mocdoc-hms/discuss
- MocDoc HMS on AlternativeTo: https://alternativeto.net/software/mocdoc-hms/about
- MocDoc HMS reviews on Capterra: https://www.capterra.com/p/161290/MocDoc-HMS/reviews/?page=2
- KareXpert on G2: https://www.g2.com/sellers/karexpert-technologies
- KareXpert Smart Hospital on Capterra: https://www.capterra.com/p/186949/Smart-Hospital/
- Epic charge capture (University of Iowa Epic support): https://epicsupport.sites.uiowa.edu/epic-resources/charge-capture
- Epic Hospital Billing follow-up (University of Iowa Epic support): https://epicsupport.sites.uiowa.edu/epic-resources/hospital-billing-hb-follow
- Medical billing listings with patient payment portals (IndiaMART): https://m.indiamart.com/impcat/medical-billing-software.html
- e-Invoicing under GST (Zoho Books): https://www.zoho.com/in/books/e-invoicing

GST rates, the room-rent rule, e-invoice thresholds and the section 269ST cash limit are set as defaults from public rules; the hospital’s chartered accountant must confirm them before go-live.

## 15. Screens

| Screen | Role | Board |
|---|---|---|
| Patient payments on the phone | Patient, family | PortalPay |
| Billing counter (OPD, IP, deposits, refunds, misc bill) | Cashier | Billing |
| Cashier shift and day-end | Cashier, Billing Manager | BillShift |
| In-patient bill | Cashier | IpdBill |
| Insurance and TPA desk | Insurance desk | IpdTpa |
| Corporate and credit desk | Billing Manager | BillCorporate |
| Approvals | Billing Manager, Super Admin | Approvals |
| Billing settings | Hospital Admin | BillConfig |
| Billing analytics | Management, Accounts | BillAnalytics |
| Finance (ledger, bank, GST) | Accounts | Finance |
| Bill and receipt prints | Cashier | PrintBill, PrintReceipt |
