    var S = [
      ['Business rules', 'Enforced by the API; the UI only explains them. Values in brackets are defaults on the Lab Settings screen.', ['No.', 'Rule', 'Detail'], [
        ['R1', 'Positive identification', 'Two identifiers (name and UHID) and a barcode scan of wristband and label at collection and at receipt. No scan, no sample.'],
        ['R2', 'Pay before collection in OPD', 'Walk-in and OPD tests are paid before collection, except credit, corporate, scheme and emergency patients (billing rule R2).'],
        ['R3', 'Sample acceptance', 'Reception checks label, container, volume, time since collection and haemolysis. A rejection needs a reason, creates a recollection order and informs the ward or patient.'],
        ['R4', 'QC before patients', 'Analyser results are accepted only when QC for that analyser and run is in control.'],
        ['R5', 'Westgard rules', '1-2s is a warning; 1-3s or 2-2s rejects the run; patient results from the run are held and rerun after the fault is fixed [rules per analyser].'],
        ['R6', 'Reference ranges', 'Chosen by test, method, age, sex and pregnancy. Out-of-range values are flagged high or low.'],
        ['R7', 'Critical values', 'Phoned to the treating doctor or nurse within [30 min] with read-back recorded; escalated to the HOD if nobody is reached in [15 min].'],
        ['R8', 'Delta check', 'A change beyond the delta limit from a result in the last [7 days] holds the result for pathologist review.'],
        ['R9', 'Two-step release', 'The technician enters and verifies; the pathologist validates and releases. Autoverification of normal results is [off] by default.'],
        ['R10', 'No editing after release', 'Released reports are never edited. An amendment is a new version with a reason; doctor and patient are told.'],
        ['R11', 'TAT targets', 'STAT [1 h], urgent [2 h], routine [4 h], culture [48 to 72 h], histopathology [3 working days]; from collection for in-patients and from receipt for walk-ins.'],
        ['R12', 'Accreditation marks', 'The NABL mark prints only on accredited tests. Send-out results name the performing lab.'],
        ['R13', 'Sensitive tests', 'Results such as HIV are never sent by SMS or WhatsApp; they go to the doctor and are given in person with counselling.'],
        ['R14', 'Add-on tests', 'Allowed on a stored sample only within the analyte’s stability window.'],
        ['R15', 'Home collection', 'Visit slots by area; phlebotomist check-in at the address; cool box between [2 and 8 °C]; hand-over to the lab within [4 h].'],
        ['R16', 'Send-outs', 'Only to approved partner labs; dispatch, courier, temperature and receipt are logged; TAT includes transport.'],
        ['R17', 'Retention', 'Serum and plasma [7 days], slides and blocks [10 years], reports permanently; then disposal as biomedical waste.'],
        ['R18', 'Repeat policy', 'Critical or implausible results are repeated once when the policy for that test says so; both values are kept.'],
        ['R19', 'Reagent use', 'Optional: reagent and consumable use is posted to inventory per test to show cost per test.'],
        ['R20', 'Audit', 'Who ordered, collected, received, ran, entered, verified, validated, released, printed and viewed: every step is logged.']]],
      ['Settings (Lab Settings screen)', 'Per branch unless noted', ['Setting', 'Level', 'Default'], [
        ['Test master (sample, container, method, TAT, price)', 'Branch', 'As configured'], ['Panels and profiles', 'Branch', 'As configured'], ['Reference ranges', 'Test', 'By age, sex, pregnancy'], ['Critical limits and call time', 'Test', '30 min, escalate after 15 min'],
        ['Delta rules', 'Test', '7 days look-back'], ['Westgard rules', 'Analyser', '1-2s warn; 1-3s, 2-2s reject'], ['Autoverification', 'Test', 'Off'], ['Rejection reasons', 'Branch', '8 standard reasons'],
        ['Retention', 'Branch', '7 days serum, 10 years blocks'], ['Partner labs for send-outs', 'Branch', 'Approved list'], ['Home collection areas and slots', 'Branch', '30-minute slots'], ['Report templates and signatures', 'Department', 'With QR and NABL mark']]],
      ['Notifications', 'SMS uses DLT-approved templates; WhatsApp needs patient consent', ['Event', 'To', 'Channel', 'Message'], [
        ['Samples due', 'Ward nurse', 'In-app', 'Collection list by time'], ['Sample rejected', 'Nurse or patient', 'In-app, SMS', 'Reason and recollection'], ['Critical value', 'Doctor, nurse', 'Phone call, in-app, sound', 'Value and time; read-back'],
        ['Report ready', 'Doctor, patient', 'In-app, WhatsApp, SMS', 'Secure link (7 days)'], ['QC failure', 'Lab in-charge', 'In-app', 'Analyser, rule, run held'], ['TAT breach', 'Lab in-charge', 'In-app', 'Test, stage, delay'],
        ['Home visit ETA', 'Patient', 'SMS, WhatsApp', 'Phlebotomist name and time'], ['Send-out result received', 'Lab reception', 'In-app', 'Test, partner lab']]],
      ['Reports', 'All export to Excel and PDF; schedulable', ['Report', 'For', 'Key columns'], [
        ['TAT by test and stage', 'Lab in-charge', 'Median, % within target'], ['Rejections by ward and reason', 'Lab in-charge, nursing', 'Count, rate'], ['Critical value log', 'Quality', 'Value, called to, time, read-back'],
        ['Workload', 'Lab in-charge', 'Tests by technician and analyser'], ['QC summary and Levey-Jennings', 'Lab in-charge', 'Runs, rejections, CV'], ['EQAS results', 'Pathologist', 'Scheme, score'],
        ['Test volume and revenue', 'Management', 'By test, department, payer'], ['Referral doctor test report', 'Management, CRM', 'Doctor, tests, revenue'], ['Pending worklist by department', 'Lab in-charge', 'Sample, stage, age'],
        ['Send-out register', 'Lab reception', 'Partner, sent, received, TAT'], ['Reagent consumption', 'Store, lab', 'Test, kits, cost per test'], ['Antibiogram', 'Infection control', 'Organism, antibiotic, % sensitive']]],
      ['Measures and formulas', 'Used on the Lab analytics screen and for NABL reporting', ['Measure', 'Formula', 'Notes'], [
        ['TAT within target', 'Tests released within target × 100 ÷ tests released', 'By test and priority'], ['Sample rejection rate', 'Rejected samples × 100 ÷ samples received', 'By ward and reason'], ['Critical calls in time', 'Critical calls within 30 min × 100 ÷ critical results', 'NABL indicator'],
        ['QC rejection rate', 'Rejected runs × 100 ÷ QC runs', 'By analyser'], ['EQAS performance', 'Acceptable results × 100 ÷ EQAS results', 'By scheme'], ['Amended report rate', 'Amended reports × 100 ÷ released reports', 'Should be near zero'],
        ['Repeat test rate', 'Repeated tests × 100 ÷ tests done', 'Excludes ordered repeats'], ['Tests per technician', 'Tests done ÷ technician shifts', 'Workload'], ['Cost per test', 'Reagent and consumable cost ÷ tests done', 'When reagent use is posted']]],
      ['Edge cases', 'How the system behaves', ['Case', 'Behaviour'], [
        ['Label printed but sample not taken', 'Label voided after [2 h]; reprint logged'], ['Two samples swapped on the ward', 'Delta check holds; both recollected; incident raised'], ['Analyser sends a result for an unknown barcode', 'Held in an exceptions list; never attached to a patient by guess'],
        ['Patient discharged before result', 'Result still released to the doctor and patient; discharge summary updated'], ['Doctor unreachable for a critical value', 'Escalation to HOD then Medical Superintendent; all attempts logged'], ['QC fails mid-day', 'Results since the last good QC are reviewed and rerun if needed'],
        ['Sample stable too short for send-out', 'Send-out blocked; recollect near dispatch time'], ['Same test ordered twice in a day', 'Duplicate warning to the doctor; second order needs a reason'], ['Newborn with mother’s UHID', 'Baby record used; labels show baby of mother']]],
      ['Acceptance tests (sample)', 'Run on staging with pilot hospital masters', ['Test', 'Steps', 'Pass when'], [
        ['Positive ID', 'Scan wrong wristband at collection', 'Blocked with message'], ['Rejection', 'Reject a haemolysed sample', 'Recollection order and SMS created'], ['QC block', 'Enter a control at 3.2 SD', 'Run rejected; patient results held'],
        ['Critical value', 'Enter platelets 38,000', 'Call task created; release blocked until call logged'], ['Delta hold', 'Haemoglobin falls 4 g/dL in 2 days', 'Held for pathologist'], ['Two-step release', 'Technician tries to release', 'Blocked; pathologist must validate'],
        ['Amendment', 'Amend a released report', 'New version; old kept; doctor and patient notified'], ['Sensitive test', 'Release an HIV result', 'No SMS or WhatsApp sent'], ['TAT report', 'Run a day of 500 tests', 'TAT per stage matches time stamps']]]
    ];
