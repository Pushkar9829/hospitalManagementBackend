from kit import *
from reportlab.platypus import PageBreak


def story():
    s = []
    s += H1("Patient Operations: OPD, IPD and Beds")

    # ---------- OPD ----------
    s += module_card("OPD", "OPD and Appointments", "Add-on module", "CORE",
                     "Front Office, Doctors, Nurses (triage), Cashier, Patients (via SMS)",
                     "Runs the outpatient day: doctor schedules, booking, walk-ins, queue, "
                     "vitals, consultation, prescription and follow-up.")
    s += H2("Doctor schedules and slots")
    s += bullets([
        "Schedule template per doctor: days, sessions (e.g. 10:00-13:00, 17:00-20:00), "
        "branch, room, slot length (e.g. 10 minutes), max patients per session.",
        "Visit types with own fee and slot length: new, follow-up (free within N days, "
        "configurable), review, tele-consultation link.",
        "Leave and blocks: doctor leave (from HRM if active) or ad-hoc blocks automatically "
        "remove slots and trigger reschedule messages to booked patients.",
        "Overbooking allowed up to a per-doctor limit. Emergency slots can be reserved.",
    ])
    s += H2("Booking channels")
    s += table([
        ["Channel", "How it works"],
        ["Front desk", "Pick department or doctor, see slot grid with colours, book in "
                       "3 clicks"],
        ["Phone", "Same screen as front desk, marked as phone booking, unpaid until arrival"],
        ["Walk-in", "Token issued immediately in the doctor's queue"],
        ["Online booking page", "Public page per hospital (React, on S3) with OTP "
                                "verification. Optional pre-payment via payment gateway"],
        ["Follow-up", "Doctor sets follow-up date in prescription; system books or reminds"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += flow([
        ("Front Office", "Finds or registers patient, books slot"),
        ("System", "Sends confirmation SMS; reminder 2 hours before"),
        ("Front Office", "Checks in patient on arrival, token generated"),
        ("Cashier", "Collects consultation fee (or marks free follow-up)"),
        ("Nurse", "Records vitals, weight, chief complaint at triage"),
        ("Queue screen", "Shows token on TV display and calls next patient"),
        ("Doctor", "Consults: history, exam, diagnosis, prescription, orders"),
        ("System", "Sends lab/radiology orders and prescription to pharmacy"),
        ("Cashier", "Bills ordered tests; patient pays once"),
        ("Patient", "Gets prescription print / SMS link and follow-up date"),
        ("System", "Marks visit closed, records time stamps for each step"),
    ], title="User flow: OPD visit end to end", box_h=48)
    s += H2("Consultation screen (doctor)")
    s += bullets([
        "Left panel: patient banner with photo, age, allergies, VIP or medico-legal flags, "
        "past visits timeline, past reports and prescriptions.",
        "Centre: chief complaints, history, examination, vitals (from triage), provisional "
        "and final diagnosis with ICD-10 search, clinical notes.",
        "Orders: lab tests, radiology, procedures from service master, with favourites and "
        "order sets (e.g. 'Fever panel').",
        "E-prescription: drug search from pharmacy master with generic name, dose, "
        "frequency, duration, route, instructions in local language. Allergy and duplicate "
        "drug warnings. Templates per doctor.",
        "Advice, diet, follow-up date, referral to another doctor or admission request.",
        "Print or send prescription with the doctor's digital signature and QR code.",
    ])
    s += H3("Queue states")
    s += states(["BOOKED", "CHECKED_IN", "VITALS_DONE", "IN_CONSULT", "COMPLETED"],
                branches=[(0, "CANCELLED / NO_SHOW")])
    s += H3("Business rules")
    s += bullets([
        "Follow-up is free if within the configured window and same doctor; system applies "
        "it automatically.",
        "A doctor cannot close a visit without at least one diagnosis or a 'no diagnosis' "
        "reason, so morbidity reports stay accurate.",
        "No-show is set automatically at session end for un-arrived bookings.",
        "Time stamps (booked, arrived, vitals, consult start, consult end, billed) feed the "
        "Phase 2 'patient time spent in OPD' analytics.",
    ])
    s += H2("Specialty templates and treatment plans")
    s += table([
        ["Specialty", "Template content"],
        ["Dental", "Tooth chart (FDI numbering) with conditions per tooth, treatment plan "
                   "per tooth, procedures done, lab work for crowns and dentures"],
        ["Ophthalmology", "Visual acuity, refraction, IOP, slit lamp and fundus findings, "
                          "spectacle prescription print"],
        ["Obstetrics and gynaecology", "LMP and EDD calculator, antenatal card with visits, "
                                       "weight, BP, fundal height, scans; gravida and para"],
        ["Paediatrics", "Growth charts (weight, height, head circumference against WHO "
                        "curves), immunisation schedule with due dates and reminders"],
        ["Dermatology", "Body map to mark lesions, clinical photos with before and after "
                        "comparison"],
        ["Physiotherapy", "Assessment, goals, session-wise exercises and progress"],
        ["General", "Hospitals can build their own templates with a form designer"],
    ], widths=[0.25, 0.75], first_col_bold=True)
    s += bullets([
        "<b>Treatment plans.</b> Multi-session treatments such as dental work, "
        "physiotherapy, dressings and laser are planned with sessions, cost estimate and "
        "patient consent. Each session is tracked and billed "
        "per session or as a package.",
        "<b>Resource scheduling.</b> Procedure rooms, equipment (e.g. laser) and therapists "
        "can be booked like doctors, so a session needs the doctor, room and machine free.",
        "<b>Medical certificates.</b> Fitness, sick leave, medical and disability "
        "certificate templates filled from the consultation and signed digitally.",
        "<b>Drug interaction checks.</b> Optional licensed drug database adds drug-drug and "
        "drug-allergy interaction warnings and dose checks to e-prescriptions.",
    ])

    s += H2("Health check-up packages")
    s += bullets([
        "Package master: tests, radiology, consultations and the order of stations, e.g. "
        "'Executive Health Check' or 'Pre-employment'. Gender and age variants.",
        "Booking by date with daily capacity. Corporate bulk bookings by uploading an "
        "employee list, billed to the company.",
        "Check-in creates every order and a route sheet. A tracker shows which stations "
        "each person has finished, so the coordinator can move people along.",
        "When all results are in, a physician reviews and writes the summary. One "
        "consolidated report is released to the patient and, with consent, to the employer.",
    ])
    s += H2("Tele-consultation")
    s += bullets([
        "Tele-consult is a visit type with its own fee and slots. Payment is taken online "
        "before the slot.",
        "A secure video link from an integrated video provider is sent by SMS and shown in "
        "the patient portal. The doctor uses the same consultation screen and e-prescription.",
        "Consent for tele-consultation is captured as required by the Telemedicine Practice "
        "Guidelines.",
    ])
    s += H3("Reports")
    s += bullets(["Daily OPD register", "Doctor-wise and department-wise footfall",
                  "New vs follow-up", "Average waiting and consultation time",
                  "No-show rate", "Diagnosis (morbidity) report", "Referral source report"])

    s.append(PageBreak())
    # ---------- IPD ----------
    s += module_card("IPD", "IPD: Admission, Transfer and Discharge", "Add-on module "
                     "(includes Bed Management)", "CORE",
                     "Admission desk, Doctors, Ward In-charge, Billing, Medical Superintendent",
                     "Manages the in-patient stay from admission request to final bill and "
                     "discharge, including bed allocation, a live running bill, cashless "
                     "insurance and government schemes, day care and IPD analytics.")
    s += H2("Admission")
    s += table([
        ["Step", "Details"],
        ["Admission request", "Raised by doctor from OPD consultation or directly at the "
                              "admission desk. Captures reason, provisional diagnosis, "
                              "expected stay, preferred bed category"],
        ["Bed allocation", "Desk sees live bed board filtered by ward and category. "
                           "Selected bed is locked for 15 minutes during admission"],
        ["Admission details", "Admitting and attending consultant, department, admission "
                              "type (planned, from OPD), payer (self, corporate), "
                              "attendant details, medico-legal flag"],
        ["Deposit", "Suggested deposit based on bed category and package; receipt printed"],
        ["Consent", "Consent forms printed for signature and scanned back, or captured on "
                    "tablet with signature pad"],
        ["Wristband", "Printed with name, UHID, IP number, barcode, allergy colour code"],
        ["Notifications", "Ward In-charge and attending doctor notified; nursing station "
                          "shows the new patient"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += flow([
        ("Doctor", "Raises admission request from OPD"),
        ("Admission Desk", "Opens request, checks bed board"),
        ("Admission Desk", "Allocates bed, enters payer and attendant"),
        ("Cashier", "Collects deposit, prints receipt"),
        ("System", "Creates IP number, starts bed charge clock"),
        ("Ward Nurse", "Receives patient, confirms arrival on bed"),
        ("Doctor", "Writes admission notes and initial orders"),
        ("System", "Orders flow to Lab, Radiology, Pharmacy"),
    ], title="User flow: admission")

    s += H2("During the stay")
    s += bullets([
        "Daily doctor rounds with progress notes, orders and visit charges posted "
        "automatically to the running bill.",
        "Transfers: bed to bed, ward to ward or department to department. Each transfer "
        "records time so bed charges switch category at the right moment.",
        "Running bill visible to billing and, on request, to the patient's attendant. "
        "Alerts when bill crosses deposit by a set percentage.",
        "Additional deposits at any time; low-deposit SMS to attendant.",
        "Package admissions track inclusions and post only excluded services.",
        "Medication reconciliation at admission (home medicines recorded and continued, "
        "changed or stopped) and at discharge, as NABH requires.",
    ])

    s += H2("Discharge")
    s += flow([
        ("Consultant", "Marks discharge planned with expected time"),
        ("Resident", "Drafts discharge summary from template"),
        ("Departments", "Clearance: pharmacy returns, pending lab, nursing"),
        ("Billing", "Prepares final bill, applies deposit, settles"),
        ("Consultant", "Signs discharge summary digitally"),
        ("Billing", "Issues final bill and gate pass"),
        ("Ward Nurse", "Confirms patient left; bed to Cleaning"),
        ("Housekeeping", "Marks bed cleaned; bed becomes Available"),
    ], title="User flow: discharge")
    s += table([
        ["Discharge type", "Rule"],
        ["Normal", "All clearances and full settlement required"],
        ["With dues (credit)", "Maker-checker approval by Medical Superintendent; dues "
                               "tracked in patient outstanding report"],
        ["LAMA / DAMA", "Left against medical advice; signed form uploaded, mandatory reason"],
        ["Transfer out", "Referral hospital captured, summary printed"],
        ["Death", "Time and cause recorded, death summary, medico-legal steps if flagged"],
    ], widths=[0.25, 0.75], first_col_bold=True)
    s += callout("The discharge summary includes diagnosis, procedures, course in hospital, "
                 "investigations, condition at discharge, medicines, advice and follow-up. "
                 "Medicines are pulled from the active medication chart so nothing is "
                 "retyped.", "note", "Discharge summary.")

    s += H2("Insurance, TPA and government schemes")
    s.append(P("The insurance desk gets cashless approvals on time and turns them into paid "
               "claims. It works with insurers directly, through third-party administrators "
               "(TPAs), with corporates and with government schemes. Treatment never waits "
               "for an approval: emergencies are admitted first."))
    s += flow([
        ("Admission desk", "Captures payer, policy and ID at admission"),
        ("Insurance desk", "Verifies policy, sum insured and room-rent limit"),
        ("Insurance desk", "Sends pre-authorisation with notes and reports"),
        ("Insurer", "Approves, queries or denies (target 1 hour)"),
        ("System", "Approved amount on the bill; alerts at 90% used"),
        ("Insurance desk", "Sends enhancement with updated notes"),
        ("Billing", "Final bill split into insurer and patient share"),
        ("Insurer", "Final approval (target 3 hours); claim filed"),
    ], title="User flow: cashless admission")
    s += states(["DRAFT", "SENT", "APPROVED", "ENHANCED", "FINAL_APPROVED", "SETTLED"],
                branches=[(1, "QUERY / DENIED"), (5, "SHORT_PAID")],
                title="Pre-authorisation lifecycle")
    s += table([
        ["Rule", "Detail"],
        ["Payers", "Cash, corporate, insurer (direct), TPA, PM-JAY, CGHS, ECHS. Each payer has "
                   "a rate card and its own documents checklist."],
        ["Time limits", "IRDAI Master Circular (May 2024): insurer decides a cashless request "
                        "within 1 hour and final discharge approval within 3 hours. The desk "
                        "sees both timers and escalates when they run out."],
        ["Room-rent limit", "A room above the policy limit shows the proportionate deduction "
                            "warning and needs signed upgrade consent before transfer."],
        ["Enhancement", "Suggested automatically at 90% of the approved amount."],
        ["Split bill", "Every line is payable by insurer, patient or corporate; non-payable "
                       "items and co-pay go to the patient share."],
        ["Government schemes", "Beneficiary check and package pre-authorisation are done on "
                               "the scheme portal; the number and package are recorded here; "
                               "scheme rates apply and the patient pays nothing for the "
                               "package."],
        ["Claims", "Filed with the documents checklist within the payer's window; payments "
                   "are matched by UTR and short payments booked as deductions with reason."],
        ["Denial", "Patient informed with reason; converted to cash or corporate; papers "
                   "given for a reimbursement claim."],
    ], widths=[0.22, 0.78], first_col_bold=True)

    s += H2("Packages and day care")
    s += bullets([
        "Packages fix the price of a stay or procedure (for example normal delivery, knee "
        "arthroscopy, cataract). Items outside the package are billed separately and shown "
        "to the attendant every day; package variance is reported.",
        "Day care uses day-care beds for same-day admissions such as dialysis, chemotherapy "
        "and cataract: short admission, procedure, observation and same-day discharge on a "
        "day-care package, with the next session booked.",
    ])

    s += H2("OPD and IPD analytics")
    s += bullets([
        "OPD: visits, booked versus walk-in, median wait per stage (arrival, check-in, "
        "triage, doctor, billing, pharmacy), no-show rate, doctor utilisation and late starts.",
        "IPD: occupancy by ward from the midnight census, average length of stay, bed turnover "
        "rate and interval, discharge and bed turnaround, revenue per occupied bed day, "
        "deaths, LAMA and readmissions within 30 days.",
        "Formulas, targets and the full module flows are in docs/modules/OPD.md and "
        "docs/modules/IPD.md.",
    ])

    s += H2("Real-time bed management")
    s.append(P("The bed board is a live screen that every admission desk, ward and "
               "administrator sees at the same time. Changes appear within a second on every "
               "screen, using WebSockets."))
    s += table([
        ["Bed status", "Colour", "Meaning"],
        ["AVAILABLE", "Green", "Clean and free"],
        ["RESERVED", "Blue", "Held for a planned admission until a set time"],
        ["OCCUPIED", "Red", "Patient on bed; shows name, consultant, days stayed"],
        ["DISCHARGE_DUE", "Orange", "Discharge planned today; helps plan admissions"],
        ["CLEANING", "Yellow", "Patient left; housekeeping pending"],
        ["MAINTENANCE", "Grey", "Out of service"],
        ["BLOCKED", "Dark grey", "Blocked by admin (e.g. isolation)"],
    ], widths=[0.2, 0.15, 0.65], mono_cols=(0,))
    s += bullets([
        "Structure: Branch > Building > Floor > Ward > Room > Bed. Each bed has a category "
        "(General, Semi-private, Private, Deluxe, ICU, NICU, HDU) that drives the daily rate.",
        "Bed board views: floor map, ward grid, list; filters by category, gender, status.",
        "Occupancy summary by ward and category, with expected discharges today.",
        "Bed charges: charge per calendar day or 24-hour cycle (configurable), with "
        "half-day rule for short stays. ICU and nursing charges follow the bed category.",
        "Attendant bed and extra bed can be billed separately.",
        "Allocation uses an atomic database update, so two desks can never give the same "
        "bed to two patients.",
    ])
    s += H3("IPD reports")
    s += bullets(["Admission and discharge register", "Bed occupancy and average length of "
                  "stay", "Census at midnight", "Deposit vs bill outstanding",
                  "Doctor-wise admissions", "Discharge TAT (decision to exit)"])
    return s
