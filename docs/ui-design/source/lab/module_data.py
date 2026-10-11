TITLE = "Laboratory module overview"
KICKER = "Module deep dive · 4 of 16"
H1 = "Laboratory (LIS)"
LEAD = "From the test order to the released report: barcoded collection on the ward, at the counter and at home, sample receipt and rejection, analyser interfaces, QC with Westgard rules, delta and critical checks, two-step validation, microbiology, histopathology, send-outs and NABL quality indicators."
ALTS = 13
ROLES = 9
LINKS = [("LabFlow", "1 · End-to-end flow"), ("LabAltFlows", "2 · Alternate flows"), ("LabStates", "3 · Status lifecycles"), ("LabRules", "4 · Rules, messages, reports"), ("LabConfig", "5 · Lab settings screen"), ("LabAnalytics", "6 · Lab analytics")]
ROLE_LINKS = [("LabRolePatient", "Patient"), ("LabRoleDoctor", "Doctor"), ("LabRoleNurse", "Ward nurse"), ("LabRolePhlebotomist", "Home collection"), ("LabRoleReception", "Lab reception"), ("LabRoleTechnician", "Lab technician"), ("LabRolePathologist", "Pathologist"), ("LabRoleIncharge", "Lab in-charge"), ("LabRoleManagement", "Management")]
COMPETITORS = ["Indian LIS (CrelioHealth)", "KareXpert Smart Hospital", "Epic Beaker (enterprise)", "Bahmni (OpenELIS)"]
SOURCES = 'Sources: CrelioHealth LIS product pages and release notes (Q2 2025, Q1 2026); KareXpert listings on G2 and Capterra; Epic Beaker guides by Mindbowser, Folio3 Digital Health and Healthcare IT Leaders, and CAP Today; Bahmni wiki Lab Dashboard and Laboratory Management pages (CC BY-SA 4.0); Westgard rules (Wikipedia, westgard.com); critical value reporting studies citing NABL 112. Confirm NABL clause wording with your assessor. Reviewed October 2026.'
DIFF = [("Positive ID at every hand-off.", "Wristband and barcode are scanned at collection and at receipt; collector, time and place are saved, so the wrong-blood-in-tube risk drops."),
        ("QC before patients.", "Runs start only when controls are in control. Westgard rules flag warnings and reject runs; held results rerun automatically after the fix."),
        ("Critical values never sit in a queue.", "The technician must phone within 30 minutes, record the read-back, and the system escalates if nobody answers."),
        ("One lab, every place.", "Ward rounds, counter, home collection and partner centres use the same barcodes, worklists and TAT clock."),
        ("Microbiology and histopathology built in.", "Culture with prelim and final reports, sensitivity and antibiogram, and a histopathology case flow from grossing to archived blocks."),
        ("NABL without spreadsheets.", "TAT, rejection, critical-call, QC and EQAS indicators come from time stamps, with formulas shown.")]
HEIGHT = 2720
GROUPS = 7
BENCH = 16
DATA_JS = r"""    var G = [
      ['Orders and collection', [['Orders from consultation, rounds and order sets', 's'], ['Barcode label per container', 's'], ['Ward collection list by time', 'a'], ['Wristband scan at collection', 'a'], ['Home collection with phlebotomist app', 'a'], ['Counter collection for walk-ins', 's']]],
      ['Sample receipt', [['Accession on scan at reception', 's'], ['Rejection with reason and auto recollection', 'a'], ['Sample transit and storage location', 'a'], ['Send-out tests to partner labs', 'a'], ['Add-on tests within stability', 'a']]],
      ['Testing', [['Analyser interfaces (ASTM, HL7)', 's'], ['Manual result entry with formulas', 's'], ['Reference ranges by age and sex', 's'], ['Delta check with hold', 'a'], ['Critical value call with read-back', 'o'], ['Autoverification rules (off by default)', 'a']]],
      ['Quality control', [['QC lots and targets', 'a'], ['Levey-Jennings charts', 'a'], ['Westgard rules block patient runs', 'o'], ['EQAS results', 'a'], ['Calibration and maintenance log', 'a']]],
      ['Microbiology and histopathology', [['Culture with prelim and final reports', 'a'], ['Organism and sensitivity (S, I, R)', 'a'], ['Antibiogram for infection control', 'o'], ['Histopathology grossing, blocks, slides', 'a'], ['Synoptic templates and archive', 'a']]],
      ['Reports', [['Two-step validation and release', 's'], ['Report with QR to verify and NABL marks', 'a'], ['Trends and previous values', 'a'], ['WhatsApp and ABHA delivery', 'o'], ['Amendments as new versions', 'a'], ['Sensitive results never by SMS', 'o']]],
      ['Analytics and compliance', [['TAT by test, priority and stage', 'a'], ['Rejections by ward and reason', 'a'], ['Critical-call compliance', 'o'], ['Workload by technician and analyser', 'a'], ['NABL quality indicators', 'o'], ['Full audit of every step', 's']]]
    ];
    var Y = ['Yes', 'bg'], N = ['Not found', 'bn'], P = ['Partly', 'ba'], O = ['Yes', 'bo'], X = ['Other Epic modules', 'bn'];
    var B = [
      ['Barcode labels and sample tracking', Y, N, Y, Y, O], ['Collection queue and accession', Y, N, Y, Y, O], ['Vial count per test', Y, N, N, N, O], ['Two-step validation', ['AI-driven validation', 'ba'], N, N, Y, O],
      ['Abnormal flags', N, N, N, Y, O], ['Delta check', Y, N, N, N, O], ['Critical value call-out', Y, N, N, N, O], ['Levey-Jennings QC charts', Y, N, N, N, O],
      ['QC lot management', Y, N, N, N, O], ['Westgard rule engine', N, N, N, N, O], ['Microbiology workflow', N, N, Y, N, O], ['Anatomic pathology (grossing, slides)', ['Pathology automation', 'ba'], N, Y, N, O],
      ['Refer to outside lab', N, N, N, Y, O], ['Home collection with phlebotomist app', N, N, N, N, O], ['ABHA report sharing', N, N, N, N, O], ['NABL indicator dashboard', N, N, N, N, O]];
"""
