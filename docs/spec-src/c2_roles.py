from kit import *
from reportlab.platypus import PageBreak


def story():
    s = []
    s += H1("Roles, Logins and Approvals")
    s.append(P("Access is controlled at three levels. The <b>subscription</b> decides which "
               "modules exist for the hospital. The <b>role</b> decides what a user may do "
               "inside those modules. The <b>data scope</b> decides which records the user "
               "sees, for example only their own department. On top of this, sensitive "
               "actions go through <b>maker-checker</b> approval."))

    s += H2("Permission model")
    s += bullets([
        "A permission is written as <font name='Mono' size='8.5'>module:resource:action</font>, "
        "for example <font name='Mono' size='8.5'>billing:invoice:create</font> or "
        "<font name='Mono' size='8.5'>pharmacy:stock:adjust</font>.",
        "A role is a named set of permissions plus a data scope: <b>OWN</b> (records the user "
        "created or is assigned to), <b>DEPARTMENT</b>, <b>BRANCH</b> or <b>ALL</b>.",
        "A user can hold several roles, for example a doctor who is also Head of Department. "
        "The effective permission set is the union of all roles.",
        "System roles ship with the product and cannot be deleted. Hospitals can clone them "
        "into custom roles and edit those.",
        "Permissions that belong to a module that is not subscribed are ignored, even if a "
        "role contains them.",
        "Every permission check happens on the server. The React app only hides buttons for "
        "convenience.",
    ])

    s += H2("System roles")
    s += table([
        ["Role", "Scope", "Main responsibilities"],
        ["Platform Super Admin", "All tenants", "SaaS owner. Tenants, plans, modules, "
         "platform invoices. Cannot see clinical data."],
        ["Hospital Super Admin", "Tenant", "Final approver for critical changes, user and "
         "role administration, subscription view, hospital settings."],
        ["Hospital Admin", "Branch", "Day-to-day setup: departments, masters, tariffs, "
         "users. Acts as maker for critical changes."],
        ["Medical Superintendent", "Branch", "Clinical oversight, discharge approvals, "
         "bed escalations, clinical reports."],
        ["Department Head (HOD)", "Department", "Approves department rosters, leave and "
         "indents. Views department reports."],
        ["Consultant Doctor", "Own patients", "Consultation, orders, prescriptions, IPD "
         "rounds, discharge summary sign-off."],
        ["Resident / Duty Doctor", "Department", "Rounds notes, orders under a consultant, "
         "draft discharge summaries."],
        ["Nursing Superintendent", "Branch", "All wards, nurse rosters, nursing audits."],
        ["Ward In-charge (Sister)", "Ward", "Ward census, bed status, nurse assignment, "
         "indents, handover sign-off."],
        ["Staff Nurse", "Assigned ward", "Vitals, medication administration, nursing "
         "notes, intake and output."],
        ["Front Office Executive", "Branch", "Registration, appointments, check-in, "
         "admission desk, enquiries."],
        ["Cashier", "Own counter", "Bills, receipts, deposits, refunds requests, day-end "
         "cash closing."],
        ["Billing Manager", "Branch", "Approves discounts, refunds and cancellations. "
         "IPD final bills."],
        ["Accountant", "Entity", "Journals, payables, bank reconciliation, financial "
         "reports, GST."],
        ["Finance Controller", "Entity", "Approves payments and journals above limits, "
         "closes periods."],
        ["Lab Technician", "Lab", "Sample collection, accession, result entry."],
        ["Pathologist / Lab In-charge", "Lab", "Result validation and report release."],
        ["Radiology Technician", "Radiology", "Study scheduling, acquisition status."],
        ["Radiologist", "Radiology", "Reporting and sign-off."],
        ["Pharmacist", "Pharmacy store", "Dispensing, OPD sales, IPD issues, returns."],
        ["Pharmacy In-charge", "Pharmacy", "Purchase, GRN approval, stock adjustment "
         "requests, controlled drug register."],
        ["Store Keeper", "Store", "GRN, issues, transfers, physical stock."],
        ["Purchase Manager", "Branch", "Vendors, quotations, purchase orders."],
        ["HR Manager", "Tenant", "Employee master, policies, approvals, exits."],
        ["HR Executive", "Branch", "Onboarding, documents, attendance corrections."],
        ["Payroll Officer", "Entity", "Payroll inputs, payroll run (maker)."],
        ["Employee (Self-service)", "Own", "Payslips, leave, attendance, roster, "
         "profile. Every staff login has this role."],
        ["Insurance Desk (TPA Coordinator)", "Branch", "Pre-authorisations, enhancements, "
         "final approvals, claims and settlements with insurers, TPAs and schemes."],
        ["Auditor", "Tenant", "Read-only access to finance, stock and audit logs."],
        ["MRD Officer / Coder", "Branch", "Record completion, coding, file tracking, record "
         "release, birth, death and MLC registers."],
        ["Dietitian", "Branch", "Diet orders and plans, nutrition assessment, counselling."],
        ["Kitchen Supervisor", "Kitchen", "Production sheets, tray labels, delivery, "
         "kitchen indents."],
        ["Housekeeping Supervisor", "Branch", "Cleaning tasks and checklists, linen and "
         "laundry."],
        ["Maintenance Technician", "Branch", "Maintenance tickets assigned to them."],
        ["Biomedical Engineer", "Branch", "Equipment register, PM, calibration, "
         "breakdowns, AMC."],
        ["Quality Manager", "Tenant", "Feedback, complaints, incidents, indicators, "
         "audits, controlled documents."],
        ["Security Desk", "Gate", "Visitor and attendant pass check-in and check-out."],
        ["Call Centre / CRM Executive", "Branch", "Calls, appointments, leads, camps, "
         "campaigns, memberships."],
        ["Home Collection Phlebotomist", "Assigned area", "Home sample visits, barcodes, "
         "payment collection."],
        ["Infection Control Nurse", "Branch", "Infection surveillance, device days, "
         "hand hygiene audits."],
    ], widths=[0.25, 0.15, 0.6], first_col_bold=True)

    s += H2("Role to module access matrix")
    s.append(P("C = create, R = read, U = update, A = approve, blank = no access. This is the "
               "default; hospitals can change it in custom roles."))
    y = "CRU"
    s += table([
        ["Role", "CORE", "OPD", "IPD", "NUR", "LAB", "RAD", "PHR", "INV", "HRM", "PAY", "FIN"],
        ["Hosp. Super Admin", "CRUA", "R", "R", "R", "R", "R", "R", "RA", "RA", "RA", "RA"],
        ["Hospital Admin", "CRU", "CRU", "CRU", "R", "CRU", "CRU", "CRU", "CRU", "R", "", "R"],
        ["Consultant", "R", y, y, "R", "CR", "CR", "R", "", "", "", ""],
        ["Staff Nurse", "R", "R", "R", y, "R", "R", "CR", "C", "", "", ""],
        ["Front Office", "CRU", y, "CR", "", "", "", "", "", "", "", ""],
        ["Cashier", "R", "R", "R", "", "R", "R", "R", "", "", "", ""],
        ["Billing Manager", "RA", "R", "RUA", "", "R", "R", "R", "", "", "", "R"],
        ["Lab Tech / Path.", "R", "", "", "", "CRU/A", "", "", "C", "", "", ""],
        ["Radiologist", "R", "", "", "", "", "CRU/A", "", "", "", "", ""],
        ["Pharmacist", "R", "R", "R", "", "", "", y, "C", "", "", ""],
        ["Store / Purchase", "R", "", "", "", "", "", "R", "CRUA", "", "", "R"],
        ["HR Manager", "R", "", "", "", "", "", "", "", "CRUA", "R", ""],
        ["Payroll Officer", "R", "", "", "", "", "", "", "", "R", "CRU", "R"],
        ["Accountant", "R", "", "R", "", "", "", "R", "R", "", "R", "CRU"],
        ["Employee", "R", "", "", "", "", "", "", "", "own", "own", ""],
    ], widths=[0.17] + [0.0755] * 11, first_col_bold=True)
    s.append(P("Support modules. Every staff login can also raise maintenance tickets "
               "(FAC) and report incidents (QLT)."))
    s += table([
        ["Role", "MRD", "DIET", "FAC", "QLT", "CRM"],
        ["Hospital Super Admin", "RA", "R", "RA", "RA", "RA"],
        ["Hospital Admin", "CRU", "CRU", "CRU", "R", "CRU"],
        ["Medical Superintendent", "RA", "R", "R", "RA", "R"],
        ["Consultant / Resident", "own records", "C (diet orders)", "C", "C", "R"],
        ["Staff Nurse", "R", "CR", "C", "C", ""],
        ["MRD Officer / Coder", "CRU", "", "C", "C", ""],
        ["Dietitian / Kitchen Supervisor", "", "CRU", "C", "C", ""],
        ["Housekeeping / Maintenance / Biomedical", "", "", "CRU", "C", ""],
        ["Quality Manager / Infection Control", "R", "R", "R", "CRUA", "R"],
        ["Call Centre / CRM Executive", "", "", "C", "C", "CRU"],
        ["Front Office", "R", "", "C", "C", "CR"],
        ["Security Desk", "", "", "C", "C", ""],
    ], widths=[0.35, 0.13, 0.13, 0.13, 0.13, 0.13], first_col_bold=True)

    s += H2("Login and session security")
    s += table([
        ["Control", "Rule"],
        ["Login identifier", "Username or mobile number or e-mail, unique per tenant. Tenant "
                             "is resolved from the sub-domain (e.g. citycare.example.com)"],
        ["Password policy", "Minimum 10 characters, at least 3 of 4 character classes, not "
                            "one of the last 5 passwords, stored with Argon2id"],
        ["Two-factor", "OTP by SMS or authenticator app. Mandatory for Super Admin, Admin, "
                       "Finance, HR and Payroll roles. Optional for others"],
        ["Lockout", "5 failed attempts locks the account for 15 minutes. Admin can unlock"],
        ["Session", "Access token 15 minutes, refresh token 12 hours for counters and 7 days "
                    "for 'remember device', rotated on every use, stored as httpOnly cookie"],
        ["Idle timeout", "15 minutes for clinical and billing screens, configurable per "
                         "hospital between 5 and 60 minutes"],
        ["Concurrent sessions", "Configurable per role. Default: 2 devices for doctors, 1 "
                                "for cashiers"],
        ["IP / time restrictions", "Optional. Restrict finance and payroll roles to hospital "
                                   "network IPs or working hours"],
        ["Shared ward terminals", "Quick switch-user with 4-digit PIN after full login on "
                                  "the same shift, so nurses do not share accounts"],
        ["Password reset", "OTP to registered mobile or e-mail. Admin-initiated reset forces "
                           "change at next login"],
    ], widths=[0.24, 0.76], first_col_bold=True)

    s += H3("User flow: first login and daily login")
    s += flow([
        ("Hospital Admin", "Creates user, picks employee record, roles and branch"),
        ("System", "If role is privileged, sends to Super Admin for approval"),
        ("Super Admin", "Approves. System sends invite link by SMS and e-mail"),
        ("User", "Opens link, sets password, enrols 2FA if required"),
        ("User (daily)", "Opens hospital URL, enters ID and password"),
        ("System", "Checks lockout, IP rule, 2FA, subscription state"),
        ("System", "Issues tokens, loads modules and permissions"),
        ("User", "Lands on role-specific home dashboard"),
    ])

    s += H2("Maker-checker approvals")
    s.append(P("Maker-checker means one person proposes a change and a different person "
               "approves it before it takes effect. The proposal is stored as an "
               "<b>approval request</b>. The real record does not change until approval."))
    s += bullets([
        "The maker and checker must be different users. A user holding both roles still "
        "cannot approve their own request.",
        "Each rule defines the checker role, an optional second level, a threshold and an "
        "expiry. For example, discounts up to 10% need the Billing Manager, above 10% also "
        "need the Hospital Super Admin.",
        "Checkers see a single <b>Approvals inbox</b> across all modules, with a badge count, "
        "and get push notifications in the app plus optional SMS.",
        "The checker sees a side-by-side view of old and new values before deciding. A "
        "rejection needs a reason.",
        "Requests expire after a configured time (default 48 hours) and must be raised again.",
        "Every request, decision and comment is stored permanently in the audit log.",
    ])
    s += states(["DRAFT", "PENDING_L1", "PENDING_L2", "APPROVED", "APPLIED"],
                branches=[(1, "REJECTED"), (2, "EXPIRED")],
                title="Approval request lifecycle")

    s += H3("Default maker-checker rules")
    s += table([
        ["Action", "Maker", "Checker L1", "Checker L2 (if)"],
        ["Bill discount", "Cashier", "Billing Manager", "Super Admin (&gt; 10% or &gt; INR 10,000)"],
        ["Bill cancellation / refund", "Cashier", "Billing Manager", "Finance Controller (&gt; INR 25,000)"],
        ["Tariff / price change", "Hospital Admin", "Super Admin", "-"],
        ["Discharge with pending dues", "Billing", "Medical Superintendent", "-"],
        ["Lab result release", "Lab Technician", "Pathologist", "-"],
        ["Amend released lab report", "Pathologist", "Lab In-charge", "-"],
        ["Radiology report sign-off", "Resident / Tech", "Radiologist", "-"],
        ["Stock adjustment / write-off", "Store Keeper / Pharmacist", "Pharmacy In-charge", "Finance (&gt; INR 5,000)"],
        ["Purchase order", "Purchase Manager", "HOD / Admin", "Super Admin (&gt; INR 1,00,000)"],
        ["GRN with price variance", "Store Keeper", "Purchase Manager", "-"],
        ["Employee salary change", "HR Executive", "HR Manager", "Super Admin"],
        ["Payroll run release", "Payroll Officer", "HR Manager", "Finance Controller"],
        ["Manual journal entry", "Accountant", "Finance Controller", "-"],
        ["Patient record merge", "Front Office", "Hospital Admin", "-"],
        ["Department create / close", "Hospital Admin", "Super Admin", "-"],
        ["User with privileged role", "Hospital Admin", "Super Admin", "-"],
        ["Role permission change", "Hospital Admin", "Super Admin", "-"],
        ["Medical record release", "MRD Officer", "Medical Superintendent", "-"],
        ["Linen / asset condemnation", "Housekeeping / Biomedical", "Hospital Admin", "-"],
        ["Expense claim / petty cash", "Employee / Custodian", "Manager", "Finance (&gt; INR 10,000)"],
        ["Incident closure", "Investigator", "Quality Manager", "-"],
    ], widths=[0.3, 0.2, 0.2, 0.3])

    s += H3("User flow: discount approval")
    s += flow([
        ("Cashier", "Adds 15% discount on bill with reason"),
        ("System", "Rule matched. Bill held as Pending Approval"),
        ("Billing Manager", "Sees request in inbox, reviews, approves L1"),
        ("System", "Above 10%, routes to Super Admin L2"),
        ("Super Admin", "Approves on mobile browser"),
        ("System", "Applies discount, recalculates bill, writes audit"),
        ("Cashier", "Gets notification, collects payment, prints"),
        ("Patient", "Receives receipt by SMS / WhatsApp link"),
    ])

    s += H2("Super Admin approvals")
    s.append(P("The Hospital Super Admin is the owner-level account of a hospital. It is the "
               "final checker for anything that changes money rules, access rights or the "
               "structure of the hospital. A hospital can have up to three Super Admins so "
               "approvals do not stall when one is away."))
    s += bullets([
        "Creating, closing or merging departments and branches.",
        "Creating users with privileged roles, and any change to role permissions.",
        "Changes to tariffs, price lists, tax settings and discount policy.",
        "Reopening a closed financial period or a locked payroll month.",
        "High-value discounts, refunds, write-offs and purchase orders above thresholds.",
        "Approving data export requests and support-agent access to the tenant.",
        "Viewing subscription, usage and platform invoices. Requesting module changes.",
    ])
    s += callout("Super Admin accounts must use two-factor authentication and cannot be "
                 "deleted, only deactivated by another Super Admin. The last active Super "
                 "Admin cannot be deactivated.", "warn", "Safeguard.")

    s += H2("Audit trail")
    s += bullets([
        "Every create, update, delete, print, export, login and approval writes an audit "
        "event: who, when, from which IP and device, which record, and the before and after "
        "values of changed fields.",
        "Viewing a patient's clinical record is also logged (access log), so the hospital can "
        "answer 'who opened this record'.",
        "Audit events are append-only. No role, including Super Admin, can edit or delete "
        "them. They are kept for at least 7 years.",
        "Screens: audit search by user, patient, record or date; daily exception report "
        "of out-of-hours access, failed logins and bulk exports.",
    ])
    return s
