from kit import *
from reportlab.platypus import PageBreak


def story():
    s = []
    s += H1("Support Services, Records, Quality and Patient Engagement")
    s.append(P("These modules cover the departments that keep a hospital running behind the "
               "wards and counters. Without them, hospitals fall back to paper registers or "
               "separate tools for records, kitchen, housekeeping, maintenance and quality."))

    # ---------- MRD ----------
    s += module_card("MRD", "Medical Records and Certificates", "Add-on module", "CORE "
                     "(IPD recommended)", "MRD Officer, Medical Coder, Doctors, Front Office, "
                     "Medical Superintendent",
                     "Keeps the legal medical record complete, coded, tracked and released "
                     "only with authorisation, and runs the birth, death and medico-legal "
                     "registers.")
    s += H2("Medical records features")
    s += table([
        ["Feature", "Details"],
        ["Record completion", "After discharge, a checklist of mandatory items per case "
                              "(signed summary, consents, progress notes, MAR, investigations). "
                              "Missing items create deficiencies assigned to the responsible "
                              "doctor with reminders"],
        ["Clinical coding", "Coder assigns final ICD-10 diagnoses and procedure codes; used in "
                            "morbidity and mortality statistics"],
        ["Physical file tracking", "For hospitals that still keep paper files: file number, "
                                   "rack location, issue to department or doctor, due date, "
                                   "return, overdue alerts, barcode on file jacket"],
        ["Record release", "Requests from patient, family, insurer, court or police. Identity "
                           "and authorisation checked, maker-checker approval, copy fee "
                           "billed, release logged, certified copies watermarked"],
        ["Birth register", "Birth details (date, time, sex, weight, mother, father, place, "
                           "type of delivery) captured from the ward. Generates the birth report "
                           "for the Civil Registration System within the legal time limit"],
        ["Death register", "Date, time, cause; Medical Certificate of Cause of Death (MCCD) "
                           "signed by the doctor; death report for the Civil Registration "
                           "System; death summary"],
        ["Mortuary register", "Body received, cold-storage slot, handover to relatives with "
                              "ID proof and signature, or to police in medico-legal cases"],
        ["Medico-legal cases", "MLC register with number, police station intimation, "
                               "officer details, injury certificate, linked documents"],
        ["Retention", "Retention period per record type; archival and destruction lists with "
                      "approval"],
        ["Statistics", "Monthly hospital statistics: admissions, discharges, deaths, births, "
                       "occupancy, average length of stay, gross and net death rate"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += flow([
        ("Ward", "Patient discharged; record sent to MRD"),
        ("System", "Runs completion checklist, lists deficiencies"),
        ("Doctor", "Signs pending notes from deficiency list"),
        ("Coder", "Assigns final ICD-10 codes; record closed"),
        ("Patient", "Requests copy of records at front office"),
        ("MRD Officer", "Verifies identity and authorisation"),
        ("Med. Superintendent", "Approves release (checker)"),
        ("MRD Officer", "Bills copy fee, releases certified copy"),
    ], title="User flow: record completion and release")

    # ---------- DIET ----------
    s += module_card("DIET", "Diet and Kitchen", "Add-on module", "IPD, INV (kitchen store)",
                     "Doctors, Dietitians, Nurses, Kitchen Supervisor, Billing",
                     "Turns diet orders for in-patients into a kitchen production plan, "
                     "labelled trays and delivery tracking, and bills meals where chargeable.")
    s += H2("Diet and kitchen features")
    s += table([
        ["Feature", "Details"],
        ["Diet master", "Diet types (normal, soft, liquid, diabetic, renal, cardiac, low salt, "
                        "high protein, tube feed), texture, meal schedule, menu cycle"],
        ["Diet orders", "Ordered by doctor or dietitian per admission; default diet on "
                        "admission; Nil By Mouth (NBM) with start and end time, e.g. before "
                        "a procedure; allergies pulled from the patient record"],
        ["Dietitian", "Nutrition assessment, counselling notes, diet plan at discharge; "
                      "billable consultation"],
        ["Production sheet", "Per meal: counts by diet type and ward, special requests, "
                             "printed or shown on kitchen screen"],
        ["Tray labels", "Patient name, bed, diet type, allergy warning, NBM block"],
        ["Delivery", "Ward-wise delivery confirmation with time; missed meals reported"],
        ["Charges", "Meals for private rooms and attendants posted to the running bill; "
                    "staff canteen is out of scope"],
        ["Kitchen stock", "Raw material indents and consumption through the Inventory "
                          "kitchen store; cost per meal report"],
    ], widths=[0.2, 0.8], first_col_bold=True)
    s += flow([
        ("Doctor", "Orders diabetic diet; NBM after 22:00"),
        ("System", "Updates patient diet; kitchen sees change"),
        ("Kitchen Supervisor", "Prints production sheet for breakfast"),
        ("Kitchen", "Prepares, prints tray labels"),
        ("Ward Staff", "Receives trays, confirms delivery"),
        ("System", "NBM patients blocked; charges posted"),
    ], title="User flow: diet order to tray", cols=3)

    s.append(PageBreak())
    # ---------- FAC ----------
    s += module_card("FAC", "Housekeeping, Linen and Facility", "Add-on module",
                     "CORE (IPD and INV recommended)",
                     "Housekeeping Supervisor, Laundry, Maintenance Technicians, Biomedical "
                     "Engineer, all staff (raise tickets)",
                     "Runs housekeeping, linen and laundry, maintenance tickets, biomedical "
                     "equipment upkeep and biomedical waste records.")
    s += H2("Housekeeping and linen")
    s += table([
        ["Feature", "Details"],
        ["Bed cleaning tasks", "Created automatically when a patient leaves a bed. Shown on the "
                               "housekeeping board with a TAT target; supervisor verifies; bed "
                               "returns to AVAILABLE on the live bed board"],
        ["Scheduled cleaning", "Area checklists (wards, toilets, OPD, ICU) by frequency, with "
                               "staff assignment and supervisor sign-off"],
        ["Linen par levels", "Linen types and required stock per ward"],
        ["Laundry cycle", "Soiled linen collection count per ward, dispatch to in-house or "
                          "outsourced laundry, receipt count, shortage tracking"],
        ["Condemnation", "Damaged linen written off with approval; replacement indent"],
        ["Patient transport", "Porter requests for wheelchair or stretcher moves (ward to "
                              "radiology, discharge to gate) with pickup and drop times"],
    ], widths=[0.2, 0.8], first_col_bold=True)
    s += H2("Maintenance and biomedical equipment")
    s += table([
        ["Feature", "Details"],
        ["Maintenance tickets", "Any user raises a ticket (electrical, plumbing, AC, civil, "
                                "IT) with location and photo. Priority, assignment, TAT, "
                                "closure with requester confirmation"],
        ["Equipment register", "Medical equipment from the asset register with serial number, "
                               "location, vendor, warranty, risk class"],
        ["Preventive maintenance", "PM and calibration schedules; due list; checklist "
                                   "completion; certificates uploaded to S3"],
        ["Breakdowns", "Breakdown tickets with downtime tracked; equipment marked out of "
                       "service so it is not scheduled (e.g. a radiology modality)"],
        ["AMC / CMC", "Annual and comprehensive maintenance contracts, renewal alerts 60 days "
                      "ahead, vendor visit log"],
    ], widths=[0.2, 0.8], first_col_bold=True)
    s += flow([
        ("Nurse", "Raises ticket: infusion pump error, ICU bed 4"),
        ("System", "Routes to biomedical team, high priority"),
        ("Biomedical Eng.", "Marks pump out of service; replaces"),
        ("Biomedical Eng.", "Repairs or calls AMC vendor"),
        ("Biomedical Eng.", "Calibrates and closes ticket"),
        ("Nurse", "Confirms closure; downtime recorded"),
    ], title="User flow: equipment breakdown", cols=3)
    s += H2("Biomedical waste")
    s += bullets([
        "Daily waste entry per ward by colour category (yellow, red, white, blue) with "
        "weight in kg, as required by the Bio-Medical Waste Management Rules, 2016.",
        "Handover to the authorised treatment facility with manifest number, vehicle and "
        "weights; mismatch alerts.",
        "Monthly and annual reports in the format the State Pollution Control Board asks for.",
        "Needle-stick and spill incidents link to the Quality module.",
    ])

    # ---------- QLT ----------
    s += module_card("QLT", "Quality, Feedback and Incidents", "Add-on module", "CORE",
                     "Quality Manager, Medical Superintendent, HODs, all staff, patients",
                     "Supports NABH accreditation: patient feedback, complaints, incident "
                     "reporting with root cause analysis, quality indicators, audits and "
                     "controlled documents.")
    s += H2("Quality features")
    s += table([
        ["Feature", "Details"],
        ["Patient feedback", "Short survey by SMS or WhatsApp link after OPD visit and at "
                             "discharge, plus QR posters; ratings by department and Net "
                             "Promoter Score"],
        ["Complaints", "Complaint register from feedback, front office or portal; category, "
                       "owner, TAT, escalation to Medical Superintendent, closure message to "
                       "the patient"],
        ["Incident reporting", "Any staff can report, anonymously if they choose: falls, "
                               "medication errors, needle-stick injuries, equipment failure, "
                               "near misses. Severity, investigation, root cause, corrective "
                               "and preventive actions (CAPA), closure"],
        ["Quality indicators", "Computed automatically from system data each month, e.g. OPD "
                               "waiting time, discharge TAT, lab TAT, critical value reporting "
                               "time, medication errors per 1,000 patient days, falls, bed "
                               "occupancy, return to ICU within 48 hours"],
        ["Audits", "Checklist templates (hand hygiene, MAR compliance, consent, crash cart), "
                   "scores, action items with owners"],
        ["Document control", "Policies and SOPs with version, approval, review date and staff "
                             "read-acknowledgement"],
        ["Infection control", "Surveillance of hospital-acquired infections (urinary catheter, "
                              "central line, ventilator-associated, surgical site), device "
                              "days from nursing records, infection rates, antibiogram from "
                              "the lab, isolation flags on the bed board"],
    ], widths=[0.2, 0.8], first_col_bold=True)
    s += flow([
        ("Nurse", "Reports patient fall in ward 3"),
        ("System", "Notifies Quality Manager and HOD"),
        ("Quality Manager", "Assigns investigation owner"),
        ("Investigator", "Records root cause and actions"),
        ("HOD", "Completes corrective actions"),
        ("Quality Manager", "Verifies and closes; indicator updated"),
    ], title="User flow: incident to closure", cols=3)

    s += module_card("CRM", "Patient CRM and Outreach", "Add-on module", "CORE",
                     "Call Centre Executives, Marketing / CRM Executives, Front Office, "
                     "Management",
                     "Brings patients in and keeps them coming back: call centre, leads, "
                     "health camps, campaigns, memberships and referral partners.")
    s += H2("Patient CRM features")
    s += table([
        ["Feature", "Details"],
        ["Call centre", "Agent screen with caller lookup by phone number, appointment "
                        "booking, enquiry logging and call notes. Optional cloud telephony "
                        "integration (e.g. Exotel, Knowlarity) for click-to-call, call "
                        "recording links and missed-call callbacks"],
        ["Leads", "Enquiries for surgeries, packages and health check-ups tracked through "
                  "stages (new, contacted, counselled, booked, lost) with follow-up dates "
                  "and source"],
        ["Health camps", "Camp planning, on-site registration on a tablet, screening "
                         "results, conversion of camp patients to visits, camp ROI report"],
        ["Campaigns", "SMS, WhatsApp and e-mail campaigns to filtered patient lists, e.g. "
                      "diabetics due for HbA1c. Consent and opt-out respected; DLT templates"],
        ["Memberships", "Family health cards and memberships with validity, member "
                        "discounts, free visits and a prepaid wallet usable at all counters"],
        ["Referral partners", "Referring doctors and clinics with visit history, revenue "
                              "generated, agreed referral fee where permitted by policy, and "
                              "monthly statements to Finance"],
        ["Reviews", "After a good feedback score, the patient gets a link to post a public "
                    "review (e.g. Google)"],
        ["Reports", "Lead conversion, campaign response, camp conversion, referral "
                    "revenue, membership renewals"],
    ], widths=[0.2, 0.8], first_col_bold=True)
    s += flow([
        ("Call Centre", "Patient calls about knee replacement"),
        ("System", "Creates lead with source and interest"),
        ("CRM Executive", "Counsels, shares package estimate"),
        ("System", "Follow-up reminder on due date"),
        ("Call Centre", "Books orthopaedic OPD appointment"),
        ("System", "Lead marked converted on admission"),
    ], title="User flow: lead to admission", cols=3)
    return s
