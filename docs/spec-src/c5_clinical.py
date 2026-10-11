from kit import *


def story():
    s = []
    s += H1("Clinical Workflows: Nursing, Doctors and Rosters")
    s += module_card("NUR", "Nursing Station", "Add-on module", "IPD",
                     "Staff Nurses, Ward In-charge, Nursing Superintendent, Doctors (view)",
                     "Gives each ward a digital nursing station: census, tasks, vitals, "
                     "medication administration, notes, handover and indents.")
    s += H2("Nursing station screen")
    s += bullets([
        "Ward census: every bed with patient name, age, consultant, diagnosis, days in, "
        "allergy and fall-risk icons, pending task count.",
        "Task list for the shift, generated from doctor orders: medicines due, vitals due, "
        "samples to collect, dressings, procedures. Overdue tasks turn red.",
        "Patient chart tabs: vitals graph, medication administration record (MAR), intake "
        "and output, nursing notes, assessments, orders, results.",
        "Works on tablets at the bedside, with barcode scan of the wristband to open the "
        "right patient.",
    ])
    s += H2("Features")
    s += table([
        ["Feature", "Details"],
        ["Vitals charting", "Temperature, pulse, BP, respiration, SpO2, pain score, GCS, "
                            "blood sugar. Frequency set by order. Out-of-range values alert "
                            "the duty doctor. Early warning score (NEWS2) calculated"],
        ["Medication administration (MAR)", "Each dose from the doctor's order shows as "
                                            "due. Nurse scans wristband and marks given, "
                                            "held or refused with reason. Late doses flagged"],
        ["Nursing notes", "Free text plus templates (SOAP, shift note), time-stamped, "
                          "signed. Cannot be edited after 24 hours, only addended"],
        ["Assessments", "Admission assessment, fall risk (Morse), pressure ulcer risk "
                        "(Braden), pain"],
        ["Intake and output", "Oral, IV, feeds vs urine, drains, vomit. Shift and 24-hour "
                              "totals"],
        ["Care plans", "Nursing diagnosis, goals, interventions, evaluation"],
        ["ICU charting", "Hourly ICU flowsheet: vitals, ventilator settings, infusions and "
                         "titrations, GCS, lines and drains with device days, fluid balance; "
                         "severity scores (SOFA, APACHE II)"],
        ["Handover", "Shift handover summary generated per patient (ISBAR format), "
                     "acknowledged by incoming nurse"],
        ["Indents", "Pharmacy indent for patient medicines and ward stock indent to store, "
                    "with status tracking"],
        ["Consumables charging", "Consumables used on patient posted to running bill"],
    ], widths=[0.27, 0.73], first_col_bold=True)
    s += flow([
        ("Doctor", "Writes medication order: drug, dose, frequency"),
        ("Pharmacy", "Receives indent, issues medicines to ward"),
        ("System", "Creates MAR schedule for each dose time"),
        ("Nurse", "Sees dose due on task list at bedside"),
        ("Nurse", "Scans wristband and medicine barcode"),
        ("System", "Checks right patient, drug, dose, time"),
        ("Nurse", "Marks given; system records time and nurse"),
        ("Doctor", "Sees administration status on chart"),
    ], title="User flow: medication order to administration")

    s += H2("Doctor profiles and scheduling")
    s.append(P(f"Doctor profiles are kept in CORE. Scheduling for OPD is covered in Section {sec('patient')}. "
               "This section covers the clinical side of a doctor's day."))
    s += bullets([
        "Profile: photo, qualifications, registration number and council, specialties, "
        "experience, languages, signature, consultation fees per visit type.",
        "Calendar view combining OPD sessions, IPD rounds, on-call duty and leave.",
        "In-patient list across wards with pending results and orders to review.",
        "Payout rules for visiting consultants: fixed per visit, percentage of collection "
        "or per procedure. Monthly doctor payout statement feeds Finance.",
        "Order sets and prescription templates owned by the doctor.",
    ])

    s += H2("Shift rosters")
    s.append(P("Rosters are part of the HRM module but are used every day by wards, so they "
               "are described here. Without HRM, the hospital can still keep a simple duty "
               "list in CORE."))
    s += table([
        ["Feature", "Details"],
        ["Shift master", "Morning 07-14, Evening 14-21, Night 21-07, General 09-18, custom. "
                         "Grace time and minimum hours per shift"],
        ["Roster planner", "Drag-and-drop weekly or monthly grid per department or ward. "
                           "Copy last week, auto-fill rotating patterns"],
        ["Coverage rules", "Minimum staff per shift and skill (e.g. 1 ICU-trained nurse per "
                           "4 ICU beds). Planner warns on shortfall"],
        ["Constraints", "No more than N nights in a row, rest hours between shifts, weekly "
                        "off. Approved leave blocks roster cells"],
        ["Publish", "HOD or Ward In-charge publishes; staff get notification and see the "
                    "roster in self-service"],
        ["Swap requests", "Staff request a swap with a colleague; colleague accepts; "
                          "In-charge approves"],
        ["Attendance link", "Published roster is the expected attendance; punches are "
                            "matched to it for late, early and overtime"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += flow([
        ("Ward In-charge", "Builds next month roster from template"),
        ("System", "Checks coverage, leave, rest-hour rules"),
        ("HOD", "Reviews and approves roster"),
        ("System", "Publishes; staff notified on phone"),
        ("Nurse", "Requests shift swap with colleague"),
        ("Colleague", "Accepts swap"),
        ("Ward In-charge", "Approves swap; roster updated"),
        ("System", "Attendance compares punches to roster"),
    ], title="User flow: roster planning and swap")
    return s
