from kit import *
from reportlab.platypus import PageBreak


def story():
    s = []
    s += H1("Billing, Finance, Inventory, HR and Payroll")
    # ---------- Billing ----------
    s += H2("Cash, billing and printing (CORE)")
    s.append(P("Billing is part of CORE because every module produces charges. One billing "
               "engine handles OPD, IPD, lab, radiology and pharmacy, so a patient can pay "
               "everything at one counter with one receipt."))
    s += table([
        ["Feature", "Details"],
        ["Bill types", "OPD bill, IPD interim and final bill, pharmacy bill, lab / "
                       "radiology walk-in bill, package bill, miscellaneous bill"],
        ["Charge posting", "Services posted automatically from orders, bed days, visits, "
                           "pharmacy issues and consumables; manual add with permission"],
        ["Pricing", "Rate from patient's price list; package inclusions; tax per item; "
                    "rounding rules"],
        ["Discounts", "Item-level or bill-level, amount or percentage, with reason; "
                      "maker-checker above thresholds"],
        ["Deposits", "Advance receipts for IPD, adjusted against final bill; refund of "
                     "excess with approval"],
        ["Payments", "Cash, card, UPI (dynamic QR on screen), cheque, bank transfer; "
                     "split payment across modes"],
        ["Refunds and cancellation", "Full or partial with reason and approval; credit "
                                     "note generated; original never deleted"],
        ["Credit / corporate", "Bill to company with credit period; outstanding tracked in "
                               "Finance receivables"],
        ["Printing", "Thermal 80 mm for OPD, A4 for IPD with item detail or summary; "
                     "duplicate print watermarked 'DUPLICATE'; reprint logged"],
        ["E-receipts", "PDF on S3, link sent by SMS / WhatsApp / e-mail"],
        ["GST", "Healthcare services exempt where applicable; pharmacy and some services "
                "taxable; GST breakup on bill; e-invoice for B2B (corporate) bills"],
        ["Cashier shift", "Opening cash, collections by mode, handover, closing count, "
                          "variance with reason; cash deposited to bank recorded"],
        ["Payment devices", "Card machine and UPI QR integration so the amount is pushed "
                            "to the device and the payment is matched automatically; "
                            "daily settlement reconciliation"],
        ["Wallet and memberships", "Prepaid patient or family wallet and membership "
                                   "discounts (from CRM) applied at any counter"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += flow([
        ("Cashier", "Opens shift with opening cash"),
        ("Cashier", "Searches patient; sees all unpaid charges"),
        ("Cashier", "Applies discount (approval if needed)"),
        ("Cashier", "Collects payment, split modes allowed"),
        ("System", "Generates bill and receipt numbers"),
        ("System", "Prints receipt; e-receipt link sent"),
        ("Cashier", "Closes shift: counts cash, notes variance"),
        ("Billing Manager", "Verifies day-end; Finance gets journal"),
    ], title="User flow: counter billing and day-end")
    s += states(["DRAFT", "FINAL", "PARTLY_PAID", "PAID"],
                branches=[(1, "CANCELLED"), (3, "REFUNDED")], title="Bill status")

    # ---------- Finance ----------
    s += H2("Financial reporting and accounts")
    s += module_card("FIN", "Finance and Accounts", "Add-on module", "CORE",
                     "Accountant, Finance Controller, Auditor, Super Admin",
                     "Replaces a separate accounting package. Every bill, receipt, GRN, "
                     "payroll and payment posts journals automatically.")
    s += table([
        ["Feature", "Details"],
        ["Chart of accounts", "Pre-loaded hospital chart (revenue by department, "
                              "receivables, payables, inventory, salaries, statutory). "
                              "Editable groups and ledgers"],
        ["Auto-posting", "Rules map each business event to debit and credit ledgers with "
                         "cost centre: bill, receipt, refund, GRN, issue, payroll, payment"],
        ["Vouchers", "Payment, receipt, journal, contra; manual journal needs approval"],
        ["Payables", "Vendor bills from GRN, due dates, payment run, TDS deduction, "
                     "vendor ledger"],
        ["Receivables", "Corporate and patient outstanding, ageing, reminders"],
        ["Bank", "Bank accounts, statement import (CSV), reconciliation"],
        ["Doctor payouts", "Visiting consultant share computed from bills; payout "
                           "voucher monthly"],
        ["Period close", "Month lock; reopening needs Super Admin approval"],
        ["Statements", "Day book, ledger, trial balance, P&amp;L, balance sheet, cash flow, "
                       "cost-centre P&amp;L by department"],
        ["Tax reports", "GSTR-1 and GSTR-3B data export, TDS summary"],
        ["Exports", "Excel and PDF; Tally-compatible XML export as an option"],
        ["Petty cash", "Imprest per department or branch, petty cash vouchers with bills, "
                       "replenishment request and approval"],
        ["Expense claims", "Employees claim travel, conference and other expenses with "
                           "receipts; manager and finance approval; paid by bank or "
                           "through payroll"],
        ["Budgets", "Annual budget per cost centre and ledger; actual vs budget report; "
                    "warning when a purchase order exceeds the remaining budget"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += H3("Management financial reports (all hospitals, CORE)")
    s += bullets(["Daily collection summary by mode, counter and cashier",
                  "Revenue by department, doctor, service and payer",
                  "OPD vs IPD vs pharmacy vs diagnostics revenue mix",
                  "Discount and refund register with approver",
                  "Patient outstanding and deposit balance",
                  "Month-on-month trend dashboard"])

    s.append(PageBreak())
    # ---------- Inventory ----------
    s += module_card("INV", "Inventory and Purchase", "Add-on module", "CORE",
                     "Store Keeper, Purchase Manager, HODs, Ward In-charge, Finance",
                     "Controls non-drug stock: consumables, surgical items, linen, "
                     "stationery, housekeeping and equipment, from requisition to "
                     "consumption.")
    s += H2("Inventory and stock tracking")
    s += table([
        ["Feature", "Details"],
        ["Item master", "Code, name, category, UoM with conversions, HSN, GST, batch and "
                        "expiry tracking flag, reorder level, preferred vendors"],
        ["Stores", "Central store, sub-stores, ward stock points; each with own stock"],
        ["Vendors", "Vendor master with GSTIN, bank details, rating, rate contracts"],
        ["Requisition to PO", "Department requisition, quotation comparison (optional), PO "
                              "with approval levels by value, PO e-mailed to vendor"],
        ["GRN", "Against PO, partial receipt, rejection, batch and expiry capture, quality "
                "check flag"],
        ["Indent and issue", "Departments raise indents; store issues; partial issue and "
                             "back-orders"],
        ["Transfers", "Between stores with in-transit status and receive confirmation"],
        ["Consumption", "Ward consumption entry; patient-chargeable items post to bill"],
        ["Valuation", "Weighted average cost; stock value by store and category"],
        ["Physical verification", "Count sheets, variance, approved adjustment"],
        ["Assets", "Basic asset register: tag, location, warranty, AMC due date, "
                   "depreciation (with FIN)"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += flow([
        ("Ward In-charge", "Raises indent for consumables"),
        ("Store Keeper", "Issues from stock, or flags shortage"),
        ("System", "Below reorder level: creates requisition"),
        ("Purchase Mgr", "Creates PO from requisition"),
        ("Approver", "Approves PO by value limit"),
        ("Store Keeper", "Receives goods, GRN with batch"),
        ("System", "Stock up; payable posted to Finance"),
        ("Store Keeper", "Issues pending indent to ward"),
    ], title="User flow: procure-to-issue")

    # ---------- HRM ----------
    s += module_card("HRM", "HR, Rosters and Attendance", "Add-on module", "CORE",
                     "HR Manager, HR Executive, HODs, all employees (self-service)",
                     "Manages the full employee lifecycle, attendance and leave, and feeds "
                     f"payroll. Rosters are described in Section {sec('clinical')}.")
    s += H2("HR management")
    s += table([
        ["Feature", "Details"],
        ["Employee master", "Personal details, contacts, family, education, experience, "
                            "bank, PAN, Aadhaar, UAN, ESI number, photo"],
        ["Job details", "Employee ID, department, designation, grade, employment type "
                        "(permanent, contract, consultant, trainee), reporting manager, "
                        "joining date, probation"],
        ["Clinical credentials", "Medical / nursing registration number and expiry; "
                                 "alerts 60 days before expiry"],
        ["Documents", "Offer letter, appointment letter, certificates, ID proofs stored on "
                      "S3; letters generated from templates"],
        ["Onboarding", "Checklist: documents, user account, uniform, ID card, training"],
        ["Attendance", "Biometric device import (CSV or connector), web punch with IP "
                       "restriction, mobile punch with geo-fence. Matched to roster"],
        ["Leave", "Leave types (CL, SL, EL, maternity, comp-off), accrual rules, "
                  "carry-forward and encashment, holiday calendar per branch"],
        ["Self-service", "Apply leave, regularise attendance, view roster, payslips, "
                         "tax declarations, update profile (with HR approval)"],
        ["Movement", "Transfers, promotions, increments with effective dates and history"],
        ["Recruitment", "Manpower requisition with approval, job openings, candidate "
                        "database, interview schedule and panel feedback, offer letter, "
                        "convert selected candidate to employee"],
        ["Training", "Training calendar, attendance, mandatory certifications (BLS, ACLS, "
                     "fire safety, infection control) with expiry alerts"],
        ["Credentialing", "Doctors' clinical privileges granted by the credentialing "
                          "committee, renewal dates, linked to what they may order or perform"],
        ["Appraisal", "Annual cycle with KRAs, self review, manager and HOD review, "
                      "increment recommendation passed to Payroll"],
        ["Exit", "Resignation, notice period, clearance checklist across departments, "
                 "full and final settlement via Payroll, experience letter"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += flow([
        ("Employee", "Applies leave in self-service"),
        ("System", "Checks balance, roster clash, minimum coverage"),
        ("Reporting Mgr / HOD", "Approves or rejects"),
        ("System", "Updates balance, roster and attendance; notifies"),
    ], title="User flow: leave application")

    # ---------- Payroll ----------
    s += module_card("PAY", "Payroll", "Add-on module", "HRM",
                     "Payroll Officer, HR Manager, Finance Controller, employees",
                     "Calculates monthly salaries from attendance, with statutory "
                     "deductions, approvals, payslips, bank transfer file and accounting.")
    s += H2("Payroll management")
    s += table([
        ["Feature", "Details"],
        ["Salary structure", "Templates by grade: Basic, HRA, DA, conveyance, special, "
                             "night shift allowance, on-call allowance. Formula-based "
                             "components (e.g. HRA = 40% of Basic)"],
        ["Statutory (India)", "PF (12% employee and employer, wage ceiling), ESI (0.75% / "
                              "3.25% under wage limit), Professional Tax by state slab, TDS "
                              "under old or new regime from declarations, LWF. All rates "
                              "in configuration tables"],
        ["Variable inputs", "Overtime hours, night shifts, on-call, incentives, arrears, "
                            "deductions (canteen, uniform), doctor variable pay"],
        ["Attendance link", "Payable days = calendar days - LOP; LOP from absent days and "
                            "unpaid leave in locked attendance"],
        ["Loans and advances", "Salary advance and loans with EMI deduction schedule"],
        ["Payroll run", "Draft run, review variances vs last month, approval, lock"],
        ["Outputs", "Payslips (PDF on S3, e-mailed), bank transfer file (bank format), "
                    "PF ECR file, ESI return, PT and TDS reports, Form 16 data"],
        ["Accounting", "Payroll journal by cost centre posted to FIN on lock"],
        ["Full and final", "Notice recovery, leave encashment, gratuity, pending dues"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += flow([
        ("HR", "Locks attendance for the month"),
        ("Payroll Officer", "Imports variable inputs, starts draft run"),
        ("System", "Calculates gross, deductions, net per employee"),
        ("Payroll Officer", "Reviews variance report, fixes, submits"),
        ("HR Manager", "Approves (checker L1)"),
        ("Finance Ctrl.", "Approves release (checker L2)"),
        ("System", "Locks run, makes payslips, bank file, journal"),
        ("Employees", "Get payslip notification in self-service"),
    ], title="User flow: monthly payroll")
    s += states(["DRAFT", "CALCULATED", "SUBMITTED", "HR_APPROVED", "RELEASED", "LOCKED"],
                branches=[(2, "RETURNED")], title="Payroll run status")
    s += callout("A locked payroll month cannot be changed. Corrections are made as arrears "
                 "in the next month. Reopening needs Super Admin approval and is audited.",
                 "warn", "Payroll lock.")
    return s
