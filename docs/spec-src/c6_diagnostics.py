from kit import *
from reportlab.platypus import PageBreak


def story():
    s = []
    s += H1("Diagnostics and Pharmacy")
    # ---------- LAB ----------
    s += module_card("LAB", "Laboratory (LIS)", "Add-on module", "CORE",
                     "Phlebotomist, Lab Technician, Pathologist, Doctors, Front Office",
                     "Tracks every test from order to signed report, with barcodes, "
                     "validation, turnaround time and patient report delivery.")
    s += H2("Laboratory features")
    s += table([
        ["Feature", "Details"],
        ["Test master", "Test code, name, department (biochemistry, haematology, "
                        "microbiology, pathology), sample type, container colour, volume, "
                        "method, TAT target, price"],
        ["Parameters", "Each test has parameters with units, reference ranges by age and "
                       "gender, critical limits, formula fields (e.g. LDL calculated)"],
        ["Panels and profiles", "Groups of tests, e.g. Lipid profile, LFT, with one price"],
        ["Orders", "From OPD, IPD, nursing or walk-in at lab counter. Billing rule: OPD pays "
                   "before collection, IPD posts to running bill"],
        ["Sample collection", "Worklist of pending collections; barcode label printed per "
                              "container; collection time and collector recorded"],
        ["Accession", "Lab receives sample by scanning barcode; reject with reason "
                      "(haemolysed, insufficient) triggers recollection"],
        ["Result entry", "Grid entry per worklist or per patient; machine results imported "
                         "by file or connector; delta check against previous result"],
        ["Flags", "High, low and critical flags; critical values notify the doctor "
                  "immediately and must be acknowledged"],
        ["Validation", "Technician enters (maker), pathologist validates (checker). Only "
                       "validated results are released"],
        ["Reports", "Branded PDF with signature, QR verification code, interpretation "
                    "notes; trend graph for repeat tests"],
        ["Delivery", "Doctor sees results instantly; patient gets SMS / WhatsApp link; "
                     "printing at counter"],
        ["Outsourced tests", "Send-out tests to partner labs tracked with expected date "
                             "and uploaded report"],
        ["Home collection", "Book home sample collection online or by phone; assign "
                            "phlebotomist by area and slot; mobile web app for collection, "
                            "barcode printing and payment at home; live status to patient"],
        ["Collection centres", "Partner clinics and collection centres with their own rate "
                               "lists, credit billing, sample pick-up runs and monthly "
                               "statements"],
        ["Quality control", "QC lot entries and Levey-Jennings chart per analyser "
                            "(basic in Phase 1)"],
        ["Microbiology", "Culture workflow with preliminary and final reports: organism, "
                         "colony count, antibiotic sensitivity panel (S / I / R); "
                         "antibiogram report for infection control"],
        ["Histopathology", "Specimen accession, gross description, blocks and slides "
                           "tracking, microscopic findings, diagnosis, synoptic templates; "
                           "longer TAT targets"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += flow([
        ("Doctor", "Orders CBC and LFT in consultation"),
        ("Cashier", "Bills tests (OPD) or posts to IP bill"),
        ("Phlebotomist", "Collects sample, prints barcode labels"),
        ("Lab Tech", "Scans barcode at receiving, accepts sample"),
        ("Analyser / Tech", "Results imported or entered"),
        ("Pathologist", "Reviews flags and validates"),
        ("System", "Releases PDF report to S3 and EMR"),
        ("Patient / Doctor", "Notified; report viewed or printed"),
    ], title="User flow: lab order to report")
    s += states(["ORDERED", "BILLED", "COLLECTED", "RECEIVED", "RESULTED", "VALIDATED",
                 "RELEASED"], branches=[(3, "REJECTED")], title="Lab test status")
    s += H3("Reports")
    s += bullets(["Pending worklist by department", "TAT by test and by stage",
                  "Critical value log with acknowledgement", "Sample rejection report",
                  "Test-wise volume and revenue", "Referral-doctor test report"])

    # ---------- RAD ----------
    s += H2("Radiology workflows")
    s += module_card("RAD", "Radiology (RIS)", "Add-on module", "CORE",
                     "Radiology Front Desk, Technician, Radiologist, Doctors",
                     "Schedules and tracks imaging studies and produces signed radiology "
                     "reports, with links to images in the PACS.")
    s += table([
        ["Feature", "Details"],
        ["Modality master", "X-Ray, USG, CT, MRI, Mammography, with rooms, machines and "
                            "slot lengths"],
        ["Study master", "Study name, modality, preparation instructions (e.g. fasting), "
                         "contrast flag, price, report template"],
        ["Scheduling", "Slot booking per modality; preparation SMS sent to patient"],
        ["Study tracking", "Arrived, in progress, completed, with technician and time"],
        ["Contrast and consent", "Consent form and creatinine check prompt for contrast "
                                 "studies"],
        ["Reporting", "Template-based reporting with normal-report macros; draft by "
                      "resident, sign-off by radiologist (maker-checker)"],
        ["Images", "Accession number sent to PACS via DICOM worklist (optional); 'View "
                   "images' button opens PACS web viewer. Small JPEG key images can be "
                   "uploaded to S3 if no PACS"],
        ["Delivery", "Same as lab: EMR, SMS link, print, film issue register"],
        ["PCPNDT compliance", "For ultrasound on pregnant women, Form F is mandatory under the "
                              "PCPNDT Act: captured digitally with doctor declaration, "
                              "patient signature, register kept for the statutory period "
                              "and monthly report to the appropriate authority"],
    ], widths=[0.22, 0.78], first_col_bold=True)
    s += states(["ORDERED", "SCHEDULED", "ARRIVED", "PERFORMED", "REPORTED", "SIGNED"],
                title="Radiology study status")

    s.append(PageBreak())
    # ---------- PHR ----------
    s += module_card("PHR", "Pharmacy", "Add-on module", "CORE (IPD for ward issues)",
                     "Pharmacist, Pharmacy In-charge, Purchase, Nurses, Cashier",
                     "Runs the hospital pharmacy back-end and counter: purchase, batch and "
                     "expiry stock, dispensing, sales, returns and controlled drugs.")
    s += H2("Pharmacy features")
    s += table([
        ["Feature", "Details"],
        ["Drug master", "Brand name, generic, strength, form, manufacturer, HSN, GST rate, "
                        "schedule (H, H1, X, narcotic), pack size and units, rack location, "
                        "reorder level, substitutes"],
        ["Multiple stores", "Main pharmacy, OPD counter, IPD satellite, OT pharmacy; each "
                            "with own stock and transfers between them"],
        ["Purchase", "Purchase order to distributor, GRN against PO or direct, free "
                     "quantity, scheme discounts, batch, expiry, MRP, purchase rate"],
        ["Batch and expiry", "Stock is held per batch. Dispensing picks First-Expiry-First-"
                             "Out automatically; pharmacist can override with reason"],
        ["OPD dispensing", "Prescription from consultation appears in pharmacy queue. "
                           "Pharmacist checks, picks batches, bills, prints label and bill"],
        ["Counter sales", "Walk-in sale against external prescription (upload image)"],
        ["IPD issues", "Nurse indent or doctor order issued to patient; posted to running "
                       "bill; returns credited back"],
        ["Substitution", "Generic substitution suggestions when out of stock, with doctor "
                         "consent flag"],
        ["Controlled drugs", "Schedule H1 and narcotic register with prescriber, patient, "
                             "quantity; mandatory prescription copy"],
        ["Returns", "Patient returns (within policy), returns to vendor, expiry returns "
                    "with credit notes"],
        ["Alerts", "Reorder level, near-expiry (90/60/30 days), slow-moving, dead stock"],
        ["Stock audit", "Physical count by rack; variance goes to maker-checker adjustment"],
        ["Pricing", "Sale at MRP or MRP minus discount by patient category; margin report"],
    ], widths=[0.2, 0.8], first_col_bold=True)
    s += flow([
        ("Doctor", "Prescribes in OPD consultation"),
        ("Pharmacist", "Opens prescription from queue"),
        ("System", "Suggests FEFO batches and stock"),
        ("Pharmacist", "Confirms quantities, substitutes if needed"),
        ("Cashier / Pharm.", "Bills and collects payment"),
        ("System", "Deducts batch stock in one transaction"),
        ("Pharmacist", "Prints labels with dosage instructions"),
        ("Patient", "Receives medicines and bill"),
    ], title="User flow: OPD prescription dispensing")
    s += flow([
        ("Pharmacy In-charge", "Reviews reorder suggestions"),
        ("Purchase", "Raises PO to distributor; approval if above limit"),
        ("Store / Pharmacist", "Receives goods; GRN with batch, expiry, MRP"),
        ("System", "Checks price vs PO; variance needs approval"),
        ("System", "Adds stock; posts payable to Finance"),
        ("Accountant", "Pays vendor against GRN invoices"),
    ], title="User flow: pharmacy purchase", cols=3)
    s += H3("Business rules")
    s += bullets([
        "Expired batches are blocked from sale automatically at midnight of expiry date.",
        "Stock can never go negative. Sale and issue run in a database transaction that "
        "checks and deducts each batch together.",
        "Schedule H1 and narcotic drugs cannot be sold without prescriber details.",
        "Rates on GRN higher than PO rate by more than a set percentage need approval.",
    ])
    s += H3("Reports")
    s += bullets(["Daily sales and collection", "Stock valuation (purchase and MRP)",
                  "Expiry report", "Fast and slow moving", "Purchase register and GST input",
                  "Sales GST register (HSN-wise)", "Schedule H1 / narcotic register",
                  "Doctor-wise prescription value"])
    return s
