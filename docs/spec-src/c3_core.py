from kit import *
from reportlab.platypus import PageBreak


def story():
    s = []
    s += H1("Core Platform: Setup, Departments and Patients")
    s += module_card("CORE", "Core Platform", "Mandatory for every tenant",
                     "Nothing", "Super Admin, Hospital Admin, Front Office, all staff",
                     "Holds everything every other module needs: hospital structure, "
                     "departments, masters, patient identity, staff identity, billing "
                     "engine, notifications, documents and dashboards.")

    s += H2("Hospital and branch setup")
    s += table([
        ["Setting", "Details"],
        ["Legal entity", "Name, registration number, GSTIN, PAN, address, logo, letterhead, "
                         "authorised signatory. One tenant can have several entities"],
        ["Branches", "Each branch has its own address, GSTIN, counters, stores, wards, "
                     "numbering series and print headers"],
        ["Numbering series", "Prefix and format for UHID, visit, admission, bill, receipt, "
                             "PO, GRN, employee ID. Reset yearly, monthly or never"],
        ["Financial year", "Start month, open and closed periods"],
        ["Working calendar", "Working days, OPD hours, public holidays per branch"],
        ["Print templates", "A4, A5 and 80 mm thermal layouts for bills, receipts, "
                            "prescriptions, lab reports, discharge summary, payslips. "
                            "Editable header, footer, signature and QR code"],
        ["Communication", "SMS sender ID, e-mail domain, WhatsApp Business number, "
                          "message templates in English and local languages"],
        ["Localisation", "Currency, date format, time zone, languages (English, Hindi; "
                         "others added as translation files)"],
    ], widths=[0.22, 0.78], first_col_bold=True)

    s += H2("Department registration")
    s.append(P("Departments are the backbone of reporting, rostering and billing. Every "
               "doctor, nurse, service, ward, store and cost belongs to a department."))
    s += table([
        ["Field", "Description"],
        ["Code and name", "Unique short code (e.g. CARD) and display name (Cardiology)"],
        ["Type", "Clinical, Diagnostic, Support (e.g. CSSD, housekeeping) or Administrative"],
        ["Parent", "Optional parent for sub-departments (e.g. Paediatrics > NICU)"],
        ["Head of department", "Employee who approves rosters, leave and indents"],
        ["Location", "Branch, building, floor, room numbers"],
        ["Services offered", "OPD, IPD, procedures, diagnostics flags; drives which screens "
                             "show this department"],
        ["Cost centre", "Accounting cost centre for revenue and expense reports"],
        ["OPD timings", "Days and hours when this department runs OPD"],
        ["Status", "Draft, Pending approval, Active, Inactive"],
    ], widths=[0.25, 0.75], first_col_bold=True)
    s += flow([
        ("Hospital Admin", "Fills department form and links HOD and cost centre"),
        ("System", "Validates code is unique, saves as Pending approval"),
        ("Super Admin", "Reviews in approvals inbox and approves or rejects"),
        ("System", "Activates department. It appears in doctors, wards, services"),
    ], title="User flow: register a department")
    s += bullets([
        "A department with active staff, beds or open bills cannot be deactivated. The "
        "system lists what must be moved first.",
        "Departments are never deleted, only deactivated, so history stays intact.",
    ])

    s += H2("Master data")
    s += table([
        ["Master", "Used by", "Notes"],
        ["Service / tariff master", "Billing, OPD, IPD, LAB, RAD",
         "Every chargeable item: consultation, procedure, bed day, test, package. Rate per "
         "price list, tax code, department, revenue head"],
        ["Price lists", "Billing", "General, staff, senior citizen, corporate. Insurance "
                                    "price lists added in Phase 2"],
        ["Packages", "Billing, IPD", "Bundled price for a set of services and days, with "
                                     "rules for exclusions and over-limit charges"],
        ["Tax codes", "Billing, PHR, INV", "GST rates, HSN / SAC codes, exempt healthcare "
                                           "services"],
        ["Payment modes", "Billing", "Cash, card, UPI, cheque, bank transfer, wallet, "
                                     "advance adjustment"],
        ["Diagnosis codes", "OPD, IPD", "ICD-10 preloaded, searchable, with hospital "
                                        "favourites"],
        ["Referral sources", "Registration", "Doctors, camps, websites, walk-in, for referral "
                                             "reports"],
        ["Designations, grades", "HRM", "Used in employee master and salary structure"],
        ["Units of measure", "PHR, INV", "Strip, tablet, bottle, box, with conversions"],
    ], widths=[0.22, 0.2, 0.58], first_col_bold=True)
    s += callout("Bulk import from Excel is available for every master, with a validation "
                 "preview before saving. This is how a hospital migrates from its old "
                 "software in days, not weeks.", "tip", "Go-live accelerator.")

    s += H2("Patient registration")
    s.append(P("Each patient gets one permanent <b>UHID</b> (Unique Health ID) valid across "
               "all branches. Every visit, admission, bill, sample and prescription links to "
               "it."))
    s += table([
        ["Group", "Fields"],
        ["Identity", "Title, first, middle, last name, gender, date of birth or age, photo, "
                     "blood group, marital status"],
        ["Contact", "Mobile (verified by OTP optional), alternate number, e-mail, address "
                    "with PIN code lookup"],
        ["Documents", "ID type and number (Aadhaar, PAN, passport, voter ID), ABHA number "
                      "optional, scanned copies stored on S3"],
        ["Emergency contact", "Name, relation, phone"],
        ["Clinical flags", "Allergies, chronic conditions, VIP flag, medico-legal case flag"],
        ["Commercial", "Patient category (general, staff, senior, corporate), default price "
                       "list, corporate employer"],
        ["Source", "Referral source and referring doctor"],
    ], widths=[0.2, 0.8], first_col_bold=True)
    s += flow([
        ("Front Office", "Searches by mobile, name or UHID first"),
        ("System", "Shows likely duplicates by phone, name and DOB match"),
        ("Front Office", "Selects existing patient or opens new form"),
        ("Front Office", "Captures details, photo and ID scan from webcam"),
        ("System", "Generates UHID, prints card / wristband with barcode"),
        ("System", "Sends welcome SMS with UHID"),
        ("Front Office", "Continues to appointment, admission or billing"),
    ], title="User flow: register a new patient", box_h=46)
    s += H3("Business rules")
    s += bullets([
        "Quick registration needs only name, gender, age and mobile, so a queue never stops. "
        "Missing fields are flagged until completed.",
        "Duplicate detection uses a score: same mobile and similar name, or same ID number. "
        "Score above threshold shows a warning, never a silent merge.",
        "Merging two UHIDs is a maker-checker action. All visits, bills and reports move to "
        "the surviving UHID and the merged one redirects to it.",
        "Age is stored as an estimated date of birth so it stays correct over time.",
        "Patient photos and documents are stored in the private S3 bucket and served only "
        "through short-lived signed links.",
    ])

    s += H2("Front office: enquiries and visitor passes")
    s += table([
        ["Feature", "Details"],
        ["Enquiry desk", "Log phone and walk-in enquiries: doctor availability, tariffs, "
                         "packages, bed availability. Convert an enquiry to an appointment in "
                         "one click; enquiry-to-visit conversion report"],
        ["Attendant passes", "Issued at admission. Number allowed per bed category, photo and "
                             "QR code, printed or sent by SMS. Revoked automatically at "
                             "discharge"],
        ["Visitor entry", "Security desk scans the QR pass or records a visitor with ID, "
                          "patient, ward and time in and out. Visiting-hours rules and ICU "
                          "restrictions enforced"],
        ["Help desk", "Patient information desk can look up a patient's ward and bed, but "
                      "never clinical details; VIP and medico-legal patients hidden"],
        ["Counter tokens", "One token system for registration, billing, pharmacy, sample "
                           "collection and radiology counters, with TV display and voice "
                           "call-out; average wait per counter"],
        ["Self check-in", "Patients with a booking scan a QR code at a kiosk or on their "
                          "phone to check in and get a token"],
    ], widths=[0.2, 0.8], first_col_bold=True)

    s += H2("ABDM integration (Ayushman Bharat Digital Mission)")
    s += bullets([
        "Create or verify a patient's ABHA number with Aadhaar or mobile OTP at "
        "registration, and link it to the UHID.",
        "Scan and Share: patients scan the hospital's QR code with an ABHA app to share "
        "their profile, which creates a registration and a counter token instantly.",
        "Link prescriptions, lab reports and discharge summaries to the patient's ABHA so "
        "they appear in the patient's health locker, with consent.",
        "Records are mapped to FHIR resources as ABDM requires. The hospital registers in "
        "the Health Facility Registry and doctors in the Health Professional Registry.",
    ])

    s += H2("Patient portal")
    s.append(P("A mobile-friendly web portal at {hospital}.example.com/my, built in React and "
               "hosted on S3 like the main app. Patients log in with an OTP on their "
               "registered mobile; one login can manage linked family members."))
    s += bullets([
        "Book, reschedule and cancel appointments; join tele-consultations.",
        "Download lab and radiology reports, prescriptions, discharge summaries and bills.",
        "Pay OPD fees, IPD deposits and outstanding dues online through the payment gateway.",
        "View upcoming follow-ups and medicine reminders; update address and e-mail.",
        "Give feedback and raise complaints, which go to the Quality module.",
        "Every portal download is written to the patient's access log.",
    ])

    s += H2("Staff directory")
    s.append(P("Every person who logs in or appears on a document is an employee record. "
               "CORE keeps a light staff directory. The HRM module extends the same record "
               "with HR and payroll data."))
    s += bullets([
        "Search staff by name, department, designation, skill or phone. Shows photo, "
        "extension, current shift and on-duty status (when HRM is active).",
        "Doctor profile: qualifications, registration council and number, specialties, "
        "languages, signature image for reports, consultation fees per visit type.",
        "Visiting consultants and external doctors are supported with payout rules.",
        "Directory export and printable department-wise contact lists.",
    ])

    s += H2("Notifications and documents")
    s += table([
        ["Capability", "Description"],
        ["Channels", "In-app bell, SMS, e-mail, WhatsApp Business API. Provider adapters so "
                     "the hospital can change SMS vendor without code changes"],
        ["Templates", "Per event and language, with variables such as {patientName}, "
                      "{doctor}, {time}. DLT template IDs for India"],
        ["Patient events", "Registration, appointment booked, reminder, report ready with "
                           "secure link, bill receipt, discharge, follow-up due"],
        ["Staff events", "Approval pending, roster published, leave approved, payslip "
                         "ready, low stock, near expiry"],
        ["Document store", "All generated PDFs and uploads go to S3 with tenant prefix. "
                           "Patients get time-limited links, never public URLs"],
        ["Delivery log", "Status per message (queued, sent, delivered, failed) with retry"],
        ["Circulars", "Hospital-wide or department circulars and notices with read "
                      "acknowledgement tracking"],
    ], widths=[0.22, 0.78], first_col_bold=True)

    s += H2("Dashboards")
    s += table([
        ["Role", "Home dashboard widgets"],
        ["Super Admin / Admin", "Today's OPD count, admissions, discharges, occupancy, "
                                "collection, pending approvals, low stock alerts"],
        ["Doctor", "My queue today, my in-patients, pending results, follow-ups due"],
        ["Nurse", "Ward census, meds due in next hour, vitals due, pending indents"],
        ["Front Office", "Appointments by doctor, waiting time, bed availability"],
        ["Cashier", "My collection by mode, pending bills, cash in hand"],
        ["Lab / Radiology", "Pending samples, in-process, awaiting validation, TAT breaches"],
        ["Pharmacy / Store", "Prescriptions waiting, near expiry, reorder, pending GRN"],
        ["HR / Payroll", "Headcount, absent today, leave pending, payroll status"],
        ["MRD", "Records pending completion, deficiencies by doctor, release requests"],
        ["Kitchen", "Meal counts by diet for next meal, NBM patients, missed deliveries"],
        ["Housekeeping / Facility", "Beds awaiting cleaning, open tickets, PM due, AMC "
                                    "renewals"],
        ["Quality", "Open incidents and complaints, indicator trends, audits due"],
        ["CRM", "Leads due for follow-up, campaign results, camp bookings, renewals"],
    ], widths=[0.25, 0.75], first_col_bold=True)
    return s
