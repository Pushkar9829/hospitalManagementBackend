from kit import *


def story():
    s = []
    s += H1("End-to-End Journeys and Screen Map")
    s.append(P("Modules are useful only when they hand work to each other without "
               "re-entry. This section shows how data flows across modules in the four "
               "journeys a hospital runs every day."))

    s += H2("In-patient journey across modules")
    s += flow([
        ("CORE", "Patient registered, UHID created"),
        ("OPD", "Consultation; doctor raises admission request"),
        ("IPD", "Bed allocated on live bed board; deposit taken"),
        ("NUR", "Ward receives patient; assessment, vitals"),
        ("LAB / RAD", "Orders processed; results to chart"),
        ("PHR", "Medicines issued to ward; posted to bill"),
        ("NUR", "MAR records every dose given"),
        ("INV", "Consumables used; posted to bill"),
        ("IPD", "Discharge summary signed"),
        ("CORE Billing", "Final bill; deposit adjusted; settled"),
        ("FIN", "Revenue and receipts journals posted"),
        ("OPD", "Follow-up booked; reminder SMS scheduled"),
    ], box_h=44)
    s += H2("Money journey: charge to ledger")
    s += table([
        ["Event", "Created by", "Bill effect", "Accounting entry (FIN)"],
        ["Consultation fee", "OPD check-in", "OPD bill line", "Dr Cash / Cr OPD revenue"],
        ["Bed day", "Nightly job", "IP running bill line", "Dr Patient receivable / Cr Room revenue"],
        ["Lab test", "Order", "Bill line", "Dr Cash or receivable / Cr Lab revenue"],
        ["Pharmacy issue", "Pharmacy", "Bill line with GST", "Dr Receivable / Cr Pharmacy sales, "
                                                            "Cr GST output; Dr COGS / Cr Inventory"],
        ["Deposit", "Cashier", "Advance receipt", "Dr Cash / Cr Patient advance"],
        ["Discount", "Cashier + approver", "Negative line", "Dr Discount allowed / Cr Receivable"],
        ["GRN", "Store", "-", "Dr Inventory, Dr GST input / Cr Vendor payable"],
        ["Payroll lock", "Payroll", "-", "Dr Salaries by cost centre / Cr Salary payable, "
                                         "Cr PF, ESI, PT, TDS payable"],
    ], widths=[0.17, 0.17, 0.2, 0.46])

    s += H2("People journey: hire to pay")
    s += flow([
        ("HR", "Creates employee; documents to S3"),
        ("Super Admin", "Approves privileged user role"),
        ("Ward In-charge", "Adds employee to roster"),
        ("Employee", "Punches attendance daily"),
        ("Employee", "Applies leave; HOD approves"),
        ("HR", "Locks month attendance"),
        ("Payroll", "Runs payroll; approvals; lock"),
        ("FIN", "Salary journal; bank file paid"),
    ])

    s += H2("Stock journey: purchase to patient")
    s += flow([
        ("PHR / INV", "Reorder alert raised"),
        ("Purchase", "PO approved and sent"),
        ("Store", "GRN with batch and expiry"),
        ("FIN", "Vendor payable; payment later"),
        ("Store", "Transfer to ward or satellite pharmacy"),
        ("Nurse / Pharm.", "Issue to patient with FEFO"),
        ("Billing", "Charged on patient bill"),
        ("FIN", "COGS and stock value updated"),
    ])

    s += H2("Screen map")
    s.append(P("The left menu is built from subscribed modules and the user's permissions. "
               "Each line below is a top-level menu with its main screens."))
    s += table([
        ["Menu", "Screens", "Module"],
        ["Home", "Role dashboard, approvals inbox, notifications, global search", "CORE"],
        ["Patients", "Register, search, patient profile (timeline, documents, bills), merge",
         "CORE"],
        ["Appointments", "Slot calendar, book, check-in, queue display, doctor schedules",
         "OPD"],
        ["Consultation", "My queue, consultation workspace, templates, order sets", "OPD"],
        ["In-patients", "Admission desk, bed board, admitted list, transfers, discharge desk",
         "IPD"],
        ["Nursing", "Ward census, task list, patient chart, MAR, handover, indents", "NUR"],
        ["Laboratory", "Collection worklist, receiving, result entry, validation, reports, QC",
         "LAB"],
        ["Radiology", "Schedule, worklist, reporting, sign-off", "RAD"],
        ["Pharmacy", "Rx queue, sale, IPD issue, returns, purchase, GRN, stock, alerts",
         "PHR"],
        ["Billing", "Billing counter, IP billing, deposits, refunds, cashier shift", "CORE"],
        ["Inventory", "Indents, issues, requisitions, PO, GRN, transfers, stock, audit, assets",
         "INV"],
        ["HR", "Employees, onboarding, roster planner, attendance, leave, exit", "HRM"],
        ["Payroll", "Structures, inputs, payroll runs, payslips, statutory files", "PAY"],
        ["Finance", "Vouchers, payables, receivables, bank, ledgers, statements, GST", "FIN"],
        ["Records", "Completion, deficiencies, coding, file tracking, release requests, "
                    "birth, death, mortuary and MLC registers", "MRD"],
        ["Diet", "Diet orders, NBM board, production sheet, tray labels, deliveries", "DIET"],
        ["Facility", "Housekeeping board, checklists, linen, tickets, equipment, PM, AMC, "
                     "biomedical waste", "FAC"],
        ["Quality", "Feedback, complaints, incidents, indicators, audits, documents", "QLT"],
        ["Front Office", "Enquiries, counter tokens, attendant and visitor passes, help "
                         "desk", "CORE"],
        ["CRM", "Call centre, leads, camps, campaigns, memberships, referral partners",
         "CRM"],
        ["Reports", "Every module's reports, export to Excel / PDF, scheduled e-mail", "All"],
        ["Settings", "Hospital, branches, departments, masters, users, roles, approval "
                     "rules, templates, subscription", "CORE"],
        ["My Space", "My profile, roster, attendance, leave, payslips, password, 2FA",
         "CORE / HRM"],
    ], widths=[0.16, 0.7, 0.14], first_col_bold=True)
    return s
