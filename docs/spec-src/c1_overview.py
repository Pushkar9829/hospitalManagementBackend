from kit import *
from reportlab.platypus import PageBreak, Spacer


def story():
    s = []
    # ---------------- 1. Overview ----------------
    s += H1("Executive Summary and Scope")
    s.append(P(
        "This document is the complete Phase 1 specification for the <b>Hospital Management System</b>, "
        "a multi-tenant SaaS product that runs every operational, "
        "clinical, financial and people process of a hospital from one product. The goal is "
        "simple: once a hospital goes live, it should not need a separate billing tool, "
        "pharmacy package, HR tool, payroll tool, inventory tool or accounting package."))
    s.append(P(
        "The product is sold as a <b>module-wise subscription</b>. A hospital always buys the "
        "Core platform, then switches on only the modules it needs, such as Pharmacy, "
        "Laboratory or Payroll. Modules can be added or removed later without migration or "
        "reinstallation. The same codebase serves a 10-bed clinic and a 500-bed hospital."))
    s.append(P(
        "The stack is <b>React</b> for the web application, <b>Node.js</b> for the API and "
        "background workers, and <b>MongoDB</b> for data. The React build is hosted on "
        "<b>Amazon S3 behind CloudFront</b>. Patient documents, reports and payslips are "
        "stored in a separate private S3 bucket. The API runs in containers on AWS."))

    s += H2("What this document contains")
    s += table([
        ["Section", "Contents", "Primary reader"],
        [f"{sec('overview')}-{sec('product')}",
         "Scope, product model, module catalogue and subscription rules",
         "Founders, sales, product"],
        [f"{sec('saas')}", "SaaS platform: signup, provisioning, subscription billing, "
                           "metering, custom domains, platform console, SaaS metrics",
         "Founders, sales, finance, developers"],
        [f"{sec('roles')}", "Roles, permissions, maker-checker and Super Admin approvals",
         "Product, security, QA"],
        [f"{sec('core')}-{sec('support')}",
         "Module-by-module features, user flows, business rules, data and screens",
         "Product, developers, QA, trainers"],
        [f"{sec('journeys')}", "End-to-end patient, money and people journeys across modules",
         "Everyone"],
        [f"{sec('arch')}-{sec('code')}", "Architecture, database design and reference source code",
         "Developers, architects"],
        [f"{sec('api')}", "REST API documentation with request and response examples",
         "Frontend and backend developers"],
        [f"{sec('deploy')}-{sec('security')}",
         "AWS deployment on S3 and CloudFront, CI/CD, security and operations",
         "DevOps, security"],
        [f"{sec('quality')}-{sec('plan')}",
         "Non-functional requirements, testing, delivery plan and acceptance",
         "Project managers, QA, client"],
    ], widths=[0.1, 0.62, 0.28])

    s += H2("Phase 1 scope")
    s.append(P("Phase 1 delivers the five pillars from the roadmap, plus the people, money and "
               "support-service modules a hospital needs so that it can retire every other "
               "tool."))
    s += table([
        ["Roadmap pillar", "Phase 1 modules in this document"],
        ["<b>Security and Foundations</b>",
         "System roles and logins, maker-checker approvals, Super Admin approvals, "
         "department registration, hospital setup and masters, audit trail, notifications"],
        ["<b>Patient Operations</b>",
         "Patient registration (UHID), OPD appointment scheduling and queue, IPD admission, "
         "transfer and discharge, real-time bed management, insurance and TPA "
         "pre-authorisation and claims, government schemes (PM-JAY, CGHS, ECHS), packages, "
         "day care, OPD and IPD analytics"],
        ["<b>Clinical Workflows</b>",
         "Nursing stations and nursing notes, shift rosters, doctor profiles and scheduling, "
         "staff directory, OPD consultation and e-prescription"],
        ["<b>Diagnostics and Core Departments</b>",
         "Laboratory and diagnostics tracking, radiology workflows, pharmacy back-end and "
         "dispensing"],
        ["<b>Billing and Reporting</b>",
         "Cash, billing and printing, financial reporting and accounts, inventory and stock "
         "tracking, purchase, HR, recruitment, training, attendance, leave and payroll "
         "management"],
        ["<b>Support services and quality</b> (added so no other software is needed)",
         "Medical records with birth, death and medico-legal registers; diet and kitchen; "
         "housekeeping, linen, maintenance, biomedical equipment and waste; quality, "
         "feedback, complaints, incident reporting and infection control; patient "
         "portal; visitor passes; patient CRM and outreach; ABDM integration"],
    ], widths=[0.28, 0.72])

    s += H2("Out of scope for Phase 1")
    s.append(P("These items belong to Phase 2. The Phase 1 design leaves hooks for them so "
               "they plug in later as new subscription modules without rework."))
    s += table([
        ["Phase 2 item", "Phase 1 hook already in place"],
        ["Emergency Room, Operation Theatre (with CSSD)",
         "Admission source field, bed categories, service master and billing engine accept "
         "new departments"],
        ["Direct insurer exchange (National Health Claims Exchange) and scheme portal APIs",
         "Phase 1 insurance desk keeps pre-authorisations, replies, documents and claims with "
         "insurer reference numbers; staff key them into insurer and scheme portals"],
        ["Blood bank, ambulance, global referrals",
         "Generic order and service model, partner master, notification engine"],
        ["Advanced analytics (staff, doctor and nurse performance scorecards, forecasting)",
         "Every event is timestamped (check-in, consult start, consult end, billing, exit) "
         "and kept in an event log"],
        ["AI features (follow-up bots, smart registration, dictation, OCR, remote care)",
         "Structured prescriptions, notification queue, document store on S3, open API"],
    ], widths=[0.38, 0.62])

    s += H2("Delivery and commercials")
    s += kv([
        ["Delivery", "All Phase 1 modules delivered and live within 1 month of kickoff"],
        ["Price", "INR 1,00,000 one-time for Phase 1 delivery, plus GST"],
        ["Details", f"Week-by-week plan, delivery assumptions and payment milestones are in "
                    f"Section {sec('plan')}"],
    ])

    s += H2("Key assumptions")
    s += bullets([
        "The first market is India. Examples use INR, GST, PF, ESI, Professional Tax and TDS. "
        "All taxes and statutory deductions are configuration, not code, so other countries "
        "can be supported by changing masters.",
        "The product is multi-tenant SaaS. Each hospital is a tenant. A hospital group can "
        "run several branches under one tenant.",
        "Users work on desktop browsers at counters and on tablets in wards. A responsive "
        "layout covers both. Native mobile apps are not part of Phase 1.",
        "Lab analysers and biometric devices connect through file import or a small "
        "connector service. Full HL7 / ASTM bidirectional interfacing is optional in Phase 1.",
        "Prices shown in this document are indicative and must be finalised by the business.",
        "Web addresses use example.com as a stand-in for the product's own domain, chosen "
        "when the brand is decided.",
    ])

    s.append(PageBreak())
    # ---------------- 2. Product model ----------------
    s += H1("Product Model and Module Subscription")
    s.append(P("The product is one application with many modules. What a hospital sees is "
               "decided by its subscription. A module that is not subscribed is hidden from "
               "the menu and its APIs refuse requests, so there is no way to use it by "
               "accident or by calling the API directly."))

    s += H2("Module catalogue")
    s += table([
        ["Code", "Module", "Type", "Requires", "Key capabilities"],
        ["CORE", "Core Platform", "Mandatory", "-",
         "Logins, roles, maker-checker, Super Admin approvals, hospital and department "
         "setup, patient registration, basic billing and receipts, staff directory, "
         "audit, notifications, dashboards"],
        ["OPD", "OPD and Appointments", "Add-on", "CORE",
         "Doctor schedules, slots, booking, walk-in tokens, queue screen, vitals, "
         "consultation notes, e-prescription, follow-ups, OPD analytics (wait time per "
         "stage)"],
        ["IPD", "IPD, ADT and Beds", "Add-on", "CORE",
         "Admission, transfer, discharge, real-time bed board, running bill, deposits, "
         "discharge summary, insurance and TPA desk (pre-authorisation, enhancement, final "
         "approval, claims), government schemes, packages, day care, IPD analytics"],
        ["NUR", "Nursing Station", "Add-on", "IPD",
         "Ward census, vitals chart, medication administration, nursing notes, intake and "
         "output, handover, indents"],
        ["LAB", "Laboratory (LIS)", "Add-on", "CORE",
         "Test masters, sample collection, barcodes, result entry, validation, reports, "
         "TAT tracking"],
        ["RAD", "Radiology (RIS)", "Add-on", "CORE",
         "Modality scheduling, study tracking, report templates, radiologist sign-off, "
         "PACS viewer link"],
        ["PHR", "Pharmacy", "Add-on", "CORE",
         "Drug master, purchase and GRN, batch and expiry, FEFO dispensing, OPD sales, IPD "
         "issues, returns, controlled drugs register"],
        ["INV", "Inventory and Purchase", "Add-on", "CORE",
         "Item master, vendors, requisitions, purchase orders, GRN, stores, indents, "
         "transfers, audits, assets"],
        ["HRM", "HR, Rosters and Attendance", "Add-on", "CORE",
         "Employee lifecycle, documents, shifts, rosters, attendance, leave, holidays, "
         "exit"],
        ["PAY", "Payroll", "Add-on", "HRM",
         "Salary structures, statutory deductions, loans, payroll run with approval, "
         "payslips, bank file, payroll journal"],
        ["FIN", "Finance and Accounts", "Add-on", "CORE",
         "Chart of accounts, auto journals, vendor payables, ledgers, trial balance, P&amp;L, "
         "balance sheet, GST reports, petty cash, expense claims, budgets"],
        ["MRD", "Medical Records", "Add-on", "CORE",
         "Record completion and coding, file tracking, record release, birth, death, "
         "mortuary and medico-legal registers, hospital statistics"],
        ["DIET", "Diet and Kitchen", "Add-on", "IPD",
         "Diet orders, NBM, dietitian notes, kitchen production sheet, tray labels, "
         "delivery, meal charges"],
        ["FAC", "Housekeeping and Facility", "Add-on", "CORE",
         "Bed cleaning tasks, area checklists, linen and laundry, maintenance tickets, "
         "biomedical equipment PM and AMC, biomedical waste"],
        ["QLT", "Quality and Feedback", "Add-on", "CORE",
         "Patient feedback, complaints, incident reporting with CAPA, NABH indicators, "
         "audits, document control, infection control"],
        ["CRM", "Patient CRM and Outreach", "Add-on", "CORE",
         "Call centre, leads, health camps, campaigns, memberships and wallet, referral "
         "partners, review requests"],
    ], widths=[0.08, 0.17, 0.11, 0.09, 0.55], mono_cols=(0,))
    s += callout("Bed management is part of IPD because one cannot work without the other. "
                 "Doctor profiles live in CORE because billing and lab reports need them even "
                 "when OPD is not subscribed. Doctor schedules and slots are part of OPD.",
                 "note", "Bundling decisions.")
    s += callout("Clinics get a simplified screen layout: one screen to register, consult, "
                 "prescribe, bill and print, and a doctor can also act as admin. The same "
                 "modules run underneath, so a clinic can grow into a hospital without "
                 "migrating.", "tip", "Clinic mode.")

    s += H2("Plans and indicative pricing")
    s.append(P("Hospitals can buy a bundled plan or pick modules one by one. Pricing scales "
               "by licensed beds and named users. All prices are monthly, exclude GST and "
               "are placeholders for the business to finalise."))
    s += table([
        ["", "Clinic", "Hospital", "Enterprise"],
        ["Target", "OPD clinics, polyclinics, up to 20 beds", "20-150 beds",
         "150+ beds, groups, multi-branch"],
        ["Included modules", "CORE, OPD, PHR, LAB", "All 16 Phase 1 modules",
         "All modules + dedicated database option"],
        ["Users included", "15", "100", "Unlimited"],
        ["Branches", "1", "Up to 3", "Unlimited"],
        ["Document storage", "25 GB", "250 GB", "1 TB, then metered"],
        ["Support", "Email, business hours", "Phone + email, 12x6", "24x7, named manager"],
        ["Indicative price", "INR 6,000 / month", "INR 35,000 / month", "Custom quote"],
    ], widths=[0.22, 0.26, 0.26, 0.26], first_col_bold=True)
    s += table([
        ["A-la-carte module", "Indicative price / month", "Metering"],
        ["CORE (mandatory)", "INR 3,000", "Includes 10 users; INR 150 per extra user"],
        ["OPD", "INR 2,000", "Per branch"],
        ["IPD (with beds)", "INR 40 per licensed bed", "Minimum 10 beds"],
        ["NUR", "INR 20 per licensed bed", "Follows IPD bed count"],
        ["LAB, RAD, PHR, INV", "INR 2,500 each", "Per branch"],
        ["HRM", "INR 30 per employee", "Active employees in month"],
        ["PAY", "INR 25 per payslip", "Payslips generated in month"],
        ["FIN", "INR 3,000", "Per legal entity"],
        ["MRD, DIET, QLT", "INR 1,500 each", "Per branch"],
        ["FAC, CRM", "INR 2,000 each", "Per branch"],
        ["Patient portal (in CORE)", "Included", "Online payments carry gateway fees"],
    ], widths=[0.3, 0.3, 0.4])

    s += H2("Subscription rules")
    s += bullets([
        "<b>Dependency check.</b> A module cannot be enabled unless its required modules are "
        "active. PAY needs HRM. NUR needs IPD. Disabling a module that others depend on is "
        "blocked with a clear message.",
        "<b>Trial.</b> A new tenant gets a 14-day trial of the Hospital plan with demo data "
        "that can be wiped in one click.",
        "<b>Billing cycle.</b> Monthly or annual. Annual gets two months free. Upgrades take "
        "effect immediately and are pro-rated. Downgrades apply at the next renewal.",
        "<b>Limits.</b> Users, beds, branches and storage are enforced. When a limit is "
        "reached, the action is blocked and the Hospital Super Admin is told how to upgrade.",
        "<b>Grace period.</b> On failed payment, the tenant gets 7 days of full access with "
        "a banner, then 15 days of read-only access, then suspension. Clinical data is never "
        "deleted during this window.",
        "<b>Data on cancellation.</b> Data is retained for 90 days and can be exported as "
        "JSON, CSV and PDF reports. After 90 days it is deleted, except where law requires "
        "longer retention, in which case it is archived encrypted.",
        "<b>Data on module removal.</b> Data of a removed module is kept and becomes visible "
        "again if the module is re-enabled. Historical bills and reports that reference it "
        "still print.",
        "<b>Payment collection.</b> Subscription invoices are generated by the platform and "
        "paid via Razorpay (India) or Stripe (international), with auto-debit mandates.",
    ])

    s += H2("Subscription lifecycle")
    s += states(["TRIAL", "ACTIVE", "PAST_DUE", "READ_ONLY", "SUSPENDED", "CLOSED"],
                title="Tenant subscription states")
    s += table([
        ["State", "What users can do", "Moves to"],
        ["TRIAL", "Everything in the trial plan", "ACTIVE on payment, CLOSED after 30 days idle"],
        ["ACTIVE", "Everything in subscribed modules", "PAST_DUE when an invoice is unpaid"],
        ["PAST_DUE", "Everything, with a payment banner", "ACTIVE on payment, READ_ONLY after 7 days"],
        ["READ_ONLY", "View and print only. No new bills, admissions or orders",
         "ACTIVE on payment, SUSPENDED after 15 days"],
        ["SUSPENDED", "Only the Hospital Super Admin can log in to pay or export",
         "ACTIVE on payment, CLOSED after 90 days"],
        ["CLOSED", "Nothing. Data deleted or archived per retention policy", "-"],
    ], widths=[0.16, 0.48, 0.36], mono_cols=(0,))
    s += callout("Even in READ_ONLY and SUSPENDED states, an admitted patient's current "
                 "medication chart and lab results remain viewable. Patient safety overrides "
                 "commercial enforcement.", "warn", "Clinical safety rule.")

    s += callout("Signup, tenant provisioning, subscription billing, metering, custom "
                 f"domains and the Platform Console are specified in Section {sec('saas')}.", "note",
                 "SaaS operations.")
    return s
