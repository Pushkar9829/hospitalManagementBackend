# Laboratory (LIS) - module specification

Module 4 of 16. Design boards: canvas pages "Lab 1 · Module flow end to end" and "Lab 2 · Role-wise flows" (https://claude.ai/artifact/Fnp7CKPFT5jbiEFyMFNRq2). Board sources are in docs/ui-design/boards (Lab*.dc.html, PhleboPhone.dc.html); generators in docs/ui-design/source/lab.

## 1. Scope

From the test order to the released report: barcoded collection on the ward, at the counter and at home, sample receipt and rejection, analyser interfaces, quality control with Westgard rules, reference ranges, delta and critical checks, two-step validation, microbiology with sensitivity and antibiogram, histopathology, send-out tests, report delivery and NABL quality indicators. Radiology is a separate module.

## 2. End-to-end flow (order to report)

| Step | Who | What happens |
|---|---|---|
| 1 | Doctor | **Tests ordered.** Order set or single tests; priority routine, urgent or STAT |
| 2 | Billing | **Order billed.** OPD pays before collection; IPD to running bill |
| 3 | System (automatic) | **Labels and list.** Barcode per container; collection list by ward and time |
| 4 | Nurse or phlebotomist | **Sample collected.** Wristband and label scanned; collector and time saved |
| 5 | Lab reception | **Received.** Label, container, volume checked; accept or reject with reason |
| 6 | System (automatic) | **Routed.** To bench and analyser worklists; orders sent to the analyser |
| 7 | Lab technician | **Run.** Only after QC for the run is in control; results uploaded |
| 8 | System (automatic) | **Checks.** Range flags, delta check, critical limits |
| 9 | Lab technician | **Critical value phoned.** To doctor or nurse in 30 min; read-back logged |
| 10 | Pathologist | **Validated.** Pathologist reviews and releases (maker-checker) |
| 11 | System (automatic) | **Report delivered.** Doctor inbox, patient WhatsApp, ABHA; print with QR |
| 12 | Doctor | **Reviews and acts.** Result acknowledged; plan changed if needed |
| 13 | Patient | **Sees report.** Phone link with trend of past results |
| 14 | Lab technician | **Sample stored.** Kept for the retention period, then discarded as waste |
| 15 | System (automatic) | **Quality logged.** TAT by stage, rejections, QC, NABL indicators |

A result cannot be released while QC for its run is out of control, the sample was rejected, or a delta or critical check is still open. Every step is time-stamped, so TAT is measured per stage.

## 3. Alternate and exception flows

- **A. STAT and emergency.** Doctor marks STAT; Collected at once; red label; Front of every worklist; Released in 1 hour; doctor alerted.
- **B. Home collection.** Slot booked on portal, call centre or WhatsApp; Phlebotomist route; patient gets ETA; Collected; payment at the door; Cool box logged; handed over in 4 h; Report on WhatsApp.
- **C. Sample rejected.** Haemolysed, clotted, wrong tube or unlabelled; Rejected with reason at reception; Recollection order created; Nurse or patient informed; Rejection counted by ward.
- **D. Critical value.** Result beyond critical limit; Technician repeats if policy says; Phones doctor or nurse; read-back; Escalates to HOD if not reached in 15 min; Call logged with time and person.
- **E. Delta check failure.** Big change from last result; Result held for pathologist; Sample identity checked or recollected; Released with comment.
- **F. QC failure.** Control breaks a Westgard rule; Run rejected; patient results held; Fault fixed, recalibrated; QC repeated and in control; Held samples rerun and released.
- **G. Send-out test.** Test not done in-house; Packed with dispatch slip; Courier and temperature logged; Result uploaded from partner lab; Report shows the performing lab.
- **H. Culture and sensitivity.** Sample plated; Prelim at 24 h: growth or no growth; Organism identified; Sensitivity S, I, R; Final report; antibiogram updated.
- **I. Histopathology.** Specimen received in formalin; Grossing with photos; Processing, blocks, slides; Pathologist reports; Blocks and slides archived.
- **J. Amend released report.** Error found after release; Pathologist amends with reason; New version; old one kept; Doctor and patient informed.
- **K. Add-on test.** Doctor adds a test; Same sample used if stable; Billed and run; Added to the same report.
- **L. Walk-in with outside prescription.** Quick registration; Tests billed and paid; Collected at the counter; Report on WhatsApp and portal.
- **M. Analyser down.** Analyser fault logged; Work moved to backup or manual method; Doctors told about delays; Service ticket raised.

## 4. Status lifecycles

| Object | Normal path | Side exits (from) |
|---|---|---|
| Test order | Ordered → Billed → Collected → Received → Resulted → Validated → Released | Cancelled (Ordered), Rejected: recollect (Received), Sent out (Resulted) |
| Sample | Labelled → Collected → In transit → Received → Stored → Discarded | Lost: recollect (In transit), Rejected (Received) |
| Result | Entered → Technically verified → Validated → Released | Held: delta or critical (Technically verified), Amended (new version) (Released) |
| QC run | Run → Checked → In control | Warning 1-2s (Checked), Rejected (1-3s, 2-2s) (In control) |
| Culture | Received → Plated → Growth read → Identified → Sensitivity done → Final | No growth at 48 h: final (Growth read) |
| Histopathology case | Received → Grossed → Processed → Blocks and slides → Reported → Released | Special stains or review (Reported) |

The API rejects any status change not listed; every change stores time and user.

## 5. Business rules

Enforced by the API; the UI only explains them. Values in brackets are defaults on the Lab Settings screen.

| No. | Rule | Detail |
|---|---|---|
| R1 | Positive identification | Two identifiers (name and UHID) and a barcode scan of wristband and label at collection and at receipt. No scan, no sample. |
| R2 | Pay before collection in OPD | Walk-in and OPD tests are paid before collection, except credit, corporate, scheme and emergency patients (billing rule R2). |
| R3 | Sample acceptance | Reception checks label, container, volume, time since collection and haemolysis. A rejection needs a reason, creates a recollection order and informs the ward or patient. |
| R4 | QC before patients | Analyser results are accepted only when QC for that analyser and run is in control. |
| R5 | Westgard rules | 1-2s is a warning; 1-3s or 2-2s rejects the run; patient results from the run are held and rerun after the fault is fixed [rules per analyser]. |
| R6 | Reference ranges | Chosen by test, method, age, sex and pregnancy. Out-of-range values are flagged high or low. |
| R7 | Critical values | Phoned to the treating doctor or nurse within [30 min] with read-back recorded; escalated to the HOD if nobody is reached in [15 min]. |
| R8 | Delta check | A change beyond the delta limit from a result in the last [7 days] holds the result for pathologist review. |
| R9 | Two-step release | The technician enters and verifies; the pathologist validates and releases. Autoverification of normal results is [off] by default. |
| R10 | No editing after release | Released reports are never edited. An amendment is a new version with a reason; doctor and patient are told. |
| R11 | TAT targets | STAT [1 h], urgent [2 h], routine [4 h], culture [48 to 72 h], histopathology [3 working days]; from collection for in-patients and from receipt for walk-ins. |
| R12 | Accreditation marks | The NABL mark prints only on accredited tests. Send-out results name the performing lab. |
| R13 | Sensitive tests | Results such as HIV are never sent by SMS or WhatsApp; they go to the doctor and are given in person with counselling. |
| R14 | Add-on tests | Allowed on a stored sample only within the analyte’s stability window. |
| R15 | Home collection | Visit slots by area; phlebotomist check-in at the address; cool box between [2 and 8 °C]; hand-over to the lab within [4 h]. |
| R16 | Send-outs | Only to approved partner labs; dispatch, courier, temperature and receipt are logged; TAT includes transport. |
| R17 | Retention | Serum and plasma [7 days], slides and blocks [10 years], reports permanently; then disposal as biomedical waste. |
| R18 | Repeat policy | Critical or implausible results are repeated once when the policy for that test says so; both values are kept. |
| R19 | Reagent use | Optional: reagent and consumable use is posted to inventory per test to show cost per test. |
| R20 | Audit | Who ordered, collected, received, ran, entered, verified, validated, released, printed and viewed: every step is logged. |

## 6. Settings (Lab Settings screen)

Per branch unless noted.

| Setting | Level | Default |
|---|---|---|
| Test master (sample, container, method, TAT, price) | Branch | As configured |
| Panels and profiles | Branch | As configured |
| Reference ranges | Test | By age, sex, pregnancy |
| Critical limits and call time | Test | 30 min, escalate after 15 min |
| Delta rules | Test | 7 days look-back |
| Westgard rules | Analyser | 1-2s warn; 1-3s, 2-2s reject |
| Autoverification | Test | Off |
| Rejection reasons | Branch | 8 standard reasons |
| Retention | Branch | 7 days serum, 10 years blocks |
| Partner labs for send-outs | Branch | Approved list |
| Home collection areas and slots | Branch | 30-minute slots |
| Report templates and signatures | Department | With QR and NABL mark |

## 7. Notifications

SMS uses DLT-approved templates; WhatsApp needs patient consent.

| Event | To | Channel | Message |
|---|---|---|---|
| Samples due | Ward nurse | In-app | Collection list by time |
| Sample rejected | Nurse or patient | In-app, SMS | Reason and recollection |
| Critical value | Doctor, nurse | Phone call, in-app, sound | Value and time; read-back |
| Report ready | Doctor, patient | In-app, WhatsApp, SMS | Secure link (7 days) |
| QC failure | Lab in-charge | In-app | Analyser, rule, run held |
| TAT breach | Lab in-charge | In-app | Test, stage, delay |
| Home visit ETA | Patient | SMS, WhatsApp | Phlebotomist name and time |
| Send-out result received | Lab reception | In-app | Test, partner lab |

## 8. Reports

All export to Excel and PDF; schedulable.

| Report | For | Key columns |
|---|---|---|
| TAT by test and stage | Lab in-charge | Median, % within target |
| Rejections by ward and reason | Lab in-charge, nursing | Count, rate |
| Critical value log | Quality | Value, called to, time, read-back |
| Workload | Lab in-charge | Tests by technician and analyser |
| QC summary and Levey-Jennings | Lab in-charge | Runs, rejections, CV |
| EQAS results | Pathologist | Scheme, score |
| Test volume and revenue | Management | By test, department, payer |
| Referral doctor test report | Management, CRM | Doctor, tests, revenue |
| Pending worklist by department | Lab in-charge | Sample, stage, age |
| Send-out register | Lab reception | Partner, sent, received, TAT |
| Reagent consumption | Store, lab | Test, kits, cost per test |
| Antibiogram | Infection control | Organism, antibiotic, % sensitive |

## 9. Measures and formulas

Used on the Lab analytics screen and for NABL reporting.

| Measure | Formula | Notes |
|---|---|---|
| TAT within target | Tests released within target × 100 ÷ tests released | By test and priority |
| Sample rejection rate | Rejected samples × 100 ÷ samples received | By ward and reason |
| Critical calls in time | Critical calls within 30 min × 100 ÷ critical results | NABL indicator |
| QC rejection rate | Rejected runs × 100 ÷ QC runs | By analyser |
| EQAS performance | Acceptable results × 100 ÷ EQAS results | By scheme |
| Amended report rate | Amended reports × 100 ÷ released reports | Should be near zero |
| Repeat test rate | Repeated tests × 100 ÷ tests done | Excludes ordered repeats |
| Tests per technician | Tests done ÷ technician shifts | Workload |
| Cost per test | Reagent and consumable cost ÷ tests done | When reagent use is posted |

## 10. Edge cases

How the system behaves.

| Case | Behaviour |
|---|---|
| Label printed but sample not taken | Label voided after [2 h]; reprint logged |
| Two samples swapped on the ward | Delta check holds; both recollected; incident raised |
| Analyser sends a result for an unknown barcode | Held in an exceptions list; never attached to a patient by guess |
| Patient discharged before result | Result still released to the doctor and patient; discharge summary updated |
| Doctor unreachable for a critical value | Escalation to HOD then Medical Superintendent; all attempts logged |
| QC fails mid-day | Results since the last good QC are reviewed and rerun if needed |
| Sample stable too short for send-out | Send-out blocked; recollect near dispatch time |
| Same test ordered twice in a day | Duplicate warning to the doctor; second order needs a reason |
| Newborn with mother’s UHID | Baby record used; labels show baby of mother |

## 11. Acceptance tests (sample)

Run on staging with pilot hospital masters.

| Test | Steps | Pass when |
|---|---|---|
| Positive ID | Scan wrong wristband at collection | Blocked with message |
| Rejection | Reject a haemolysed sample | Recollection order and SMS created |
| QC block | Enter a control at 3.2 SD | Run rejected; patient results held |
| Critical value | Enter platelets 38,000 | Call task created; release blocked until call logged |
| Delta hold | Haemoglobin falls 4 g/dL in 2 days | Held for pathologist |
| Two-step release | Technician tries to release | Blocked; pathologist must validate |
| Amendment | Amend a released report | New version; old kept; doctor and patient notified |
| Sensitive test | Release an HIV result | No SMS or WhatsApp sent |
| TAT report | Run a day of 500 tests | TAT per stage matches time stamps |

## 12. Role-wise flows

Each role works in its own panel and sees only its own laboratory work.

### Patient

Books tests or home collection, pays, and gets reports with past trends on the phone.

1. Gets tests ordered by the doctor or books a package
2. Books a home collection slot if wanted
3. Pays online or at the counter
4. Gives the sample; sees the time it was taken
5. Gets an SMS if the sample must be taken again
6. Gets the report link on WhatsApp
7. Sees trends of past results
8. Shares the report with any doctor or ABHA

- **Screens:** Patient portal home (Portal), Lab report print (PrintLab), Patient payments (PortalPay)
- **Can:** Book home collection; Download reports and trends; Share reports through ABHA
- **Cannot:** See reports before the pathologist releases them; Get sensitive results (for example HIV) by SMS
- **Notified when:** Sample due or home visit ETA; Recollection needed; Report ready
- **Measured by:** Report within promised time (95% or more); Recollections (Under 1%); Reports opened on phone (Rising); Patient rating (4.5 / 5 or more)

### Doctor

Orders tests with the reason, gets results in one inbox and is phoned for critical values.

1. Orders tests or an order set with priority
2. Adds clinical notes for the lab
3. Sees status from ordered to released
4. Gets a call and an alert for critical values
5. Reviews and acknowledges results
6. Sees trends and delta flags
7. Adds a test to the same sample if stable
8. Discusses an unexpected result with the pathologist

- **Screens:** Laboratory results (Lab), Consultation (Consult), In-patient rounds (IpdRounds)
- **Can:** Order, cancel before collection, add on tests; Acknowledge results; Ask the pathologist for review
- **Cannot:** Edit results; See a result before release (except critical calls)
- **Notified when:** Critical value; Result released; Sample rejected; STAT result ready
- **Measured by:** Critical results acknowledged in 30 min (100%); Unacknowledged results (Under 2%); Repeat tests ordered (Falling); STAT orders (Under 15% of orders)

### Ward nurse

Collects ward samples on the collection round and receives critical calls.

1. Sees the collection list by time
2. Prints barcode labels at the bedside
3. Scans wristband and label, collects
4. Sends samples by porter or tube
5. Recollects rejected samples
6. Takes critical calls and reads back
7. Tells the doctor at once

- **Screens:** Nursing station (Nursing), Sample collection (LabSample), Laboratory results (Lab)
- **Can:** Collect and label samples; Record critical call read-back
- **Cannot:** Collect without scanning the wristband; Change orders
- **Notified when:** Samples due; Recollection needed; Critical value
- **Measured by:** Samples collected on time (95%); Rejections from the ward (Under 1%); Critical calls passed to doctor (Within 10 min); Unlabelled samples (Zero)

### Home collection phlebotomist

Collects at the patient's home with the phone app, keeps the cold chain and hands over to the lab.

1. Sees the day's route on the phone
2. Patient gets an ETA when the visit starts
3. Checks ID; prints or sticks barcode labels
4. Collects; takes payment by UPI or cash
5. Logs cool-box temperature
6. Hands over at the lab within 4 hours
7. Reception scans and accepts the bag

- **Screens:** Phlebotomist phone screens (PhleboPhone), Home collection home (HomePhlebo), Sample collection (LabSample)
- **Can:** See own visits; Collect payment; Mark visit done or missed
- **Cannot:** See other patients' results; Accept cash above the legal limit
- **Notified when:** New or changed visit; Fasting patient first; Hand-over due
- **Measured by:** Visits on time (90%); Hand-over within 4 h (100%); Cold chain breaks (Zero); Recollections (Under 1%)

### Lab reception and collection

The front door of the lab: walk-in collection, sample receipt, rejection and send-outs.

1. Registers walk-ins; checks payment
2. Collects at the counter
3. Receives ward and home samples by scan
4. Checks label, tube, volume, time
5. Accepts or rejects with reason
6. Packs send-out tests for the partner lab
7. Gives printed reports to walk-ins

- **Screens:** Sample collection and receipt (LabSample), Laboratory worklists (Lab), Billing counter (Billing)
- **Can:** Collect, receive and reject samples; Dispatch send-outs; Reprint reports (logged)
- **Cannot:** Enter or release results; Accept unlabelled samples
- **Notified when:** STAT sample arriving; Home collection bag arriving; Send-out result received
- **Measured by:** Receipt within 30 min of collection (95%); Rejection rate (Under 1%); Walk-in waiting time (Under 15 min); Send-out TAT met (95%)

### Lab technician

Runs QC, analysers and manual tests, enters results and phones critical values.

1. Runs QC at the start of each run
2. Starts the run only if QC is in control
3. Gets results from analysers; enters manual ones
4. Checks flags, delta and critical alerts
5. Phones critical values; logs read-back
6. Technically verifies the results
7. Sets up cultures and reads plates
8. Stores samples for the retention time

- **Screens:** Laboratory worklists (Lab), Quality control (LabQC), Microbiology (LabMicro), Histopathology (LabHisto)
- **Can:** Enter results and verify them technically; Run QC and reject a run; Log critical calls
- **Cannot:** Release reports (pathologist only); Run patients when QC is out of control
- **Notified when:** QC rule broken; Critical value; STAT sample; Analyser error
- **Measured by:** Routine TAT met (95%); Critical calls within 30 min (100%); QC runs in control (98% or more); Repeats per 100 tests (Under 2)

### Pathologist

Validates and releases reports, reports histopathology and owns the lab's quality.

1. Reviews held results (delta, critical, flags)
2. Validates and releases with comments
3. Reports histopathology and cytology
4. Signs culture and sensitivity reports
5. Reviews QC and EQAS results
6. Amends a released report with reason when needed
7. Talks to doctors about unexpected results

- **Screens:** Laboratory worklists (Lab), Histopathology (LabHisto), Microbiology (LabMicro), Quality control (LabQC)
- **Can:** Validate, release and amend reports; Approve rejections and repeat policies
- **Cannot:** Release own technician entries without review (two-step rule); Delete a released report
- **Notified when:** Results waiting for validation; Delta hold; QC failure; Histopathology case ready
- **Measured by:** Validation within 30 min of entry (90%); Amended reports (Under 0.1%); Histopathology in 3 working days (90%); EQAS acceptable (95% or more)

### Lab in-charge

Sets up tests, ranges, critical limits, analysers, send-out labs and watches TAT and quality.

1. Maintains test master and reference ranges
2. Sets critical limits and delta rules
3. Sets Westgard rules per analyser
4. Approves partner labs for send-outs
5. Watches TAT, rejections and workload
6. Runs NABL quality indicators monthly
7. Plans reagents with the store

- **Screens:** Lab settings (LabConfig), Lab analytics (LabAnalytics), Quality control (LabQC), Inventory (Inventory)
- **Can:** Edit lab masters (price changes need approval); Set QC and critical rules; Assign worklists
- **Cannot:** Change prices without Super Admin approval; Delete a test with history (retire only)
- **Notified when:** TAT breach; QC failure; Reagent below minimum; EQAS result due
- **Measured by:** TAT within target (95%); Rejection rate (Under 1%); QC rejections (Under 2% of runs); NABL indicators on time (Monthly)

### Management

Watches lab volume, revenue, TAT, quality and send-out cost.

1. Volume and revenue by test and department
2. TAT and critical-call compliance
3. Rejections by ward
4. Send-out share and cost
5. QC and EQAS status
6. Approves new tests and price changes

- **Screens:** Lab analytics (LabAnalytics), Admin dashboard (Dashboard), Approvals (Approvals)
- **Can:** See all lab data; Approve new tests and prices
- **Cannot:** Edit results
- **Notified when:** TAT below target for a week; Critical call missed; Monthly lab summary
- **Measured by:** Lab revenue (Rising); Tests done in-house (90% or more); TAT within target (95%); Critical calls in 30 min (100%)

## 13. Capabilities

Market standard = offered by most hospital systems. Advanced = leading or enterprise systems. Our edge = not found in the public material reviewed.

**Orders and collection**

- Orders from consultation, rounds and order sets (Market standard)
- Barcode label per container (Market standard)
- Ward collection list by time (Advanced)
- Wristband scan at collection (Advanced)
- Home collection with phlebotomist app (Advanced)
- Counter collection for walk-ins (Market standard)

**Sample receipt**

- Accession on scan at reception (Market standard)
- Rejection with reason and auto recollection (Advanced)
- Sample transit and storage location (Advanced)
- Send-out tests to partner labs (Advanced)
- Add-on tests within stability (Advanced)

**Testing**

- Analyser interfaces (ASTM, HL7) (Market standard)
- Manual result entry with formulas (Market standard)
- Reference ranges by age and sex (Market standard)
- Delta check with hold (Advanced)
- Critical value call with read-back (Our edge)
- Autoverification rules (off by default) (Advanced)

**Quality control**

- QC lots and targets (Advanced)
- Levey-Jennings charts (Advanced)
- Westgard rules block patient runs (Our edge)
- EQAS results (Advanced)
- Calibration and maintenance log (Advanced)

**Microbiology and histopathology**

- Culture with prelim and final reports (Advanced)
- Organism and sensitivity (S, I, R) (Advanced)
- Antibiogram for infection control (Our edge)
- Histopathology grossing, blocks, slides (Advanced)
- Synoptic templates and archive (Advanced)

**Reports**

- Two-step validation and release (Market standard)
- Report with QR to verify and NABL marks (Advanced)
- Trends and previous values (Advanced)
- WhatsApp and ABHA delivery (Our edge)
- Amendments as new versions (Advanced)
- Sensitive results never by SMS (Our edge)

**Analytics and compliance**

- TAT by test, priority and stage (Advanced)
- Rejections by ward and reason (Advanced)
- Critical-call compliance (Our edge)
- Workload by technician and analyser (Advanced)
- NABL quality indicators (Our edge)
- Full audit of every step (Market standard)

## 14. Competitor benchmark

From public product pages, directory listings and documentation, reviewed October 2026. "Not found" means not confirmed publicly, not that the product lacks it. "Other Epic modules" means the feature sits outside Grand Central. Verify in vendor demos before quoting.

| Capability | Indian HMS vendors (MocDoc and others) | KareXpert Smart Hospital | Epic Grand Central | Bahmni | Ours |
|---|---|---|---|---|---|
| Barcode labels and sample tracking | Yes | Not found | Yes | Yes | Yes |
| Collection queue and accession | Yes | Not found | Yes | Yes | Yes |
| Vial count per test | Yes | Not found | Not found | Not found | Yes |
| Two-step validation | AI-driven validation | Not found | Not found | Yes | Yes |
| Abnormal flags | Not found | Not found | Not found | Yes | Yes |
| Delta check | Yes | Not found | Not found | Not found | Yes |
| Critical value call-out | Yes | Not found | Not found | Not found | Yes |
| Levey-Jennings QC charts | Yes | Not found | Not found | Not found | Yes |
| QC lot management | Yes | Not found | Not found | Not found | Yes |
| Westgard rule engine | Not found | Not found | Not found | Not found | Yes |
| Microbiology workflow | Not found | Not found | Yes | Not found | Yes |
| Anatomic pathology (grossing, slides) | Pathology automation | Not found | Yes | Not found | Yes |
| Refer to outside lab | Not found | Not found | Not found | Yes | Yes |
| Home collection with phlebotomist app | Not found | Not found | Not found | Not found | Yes |
| ABHA report sharing | Not found | Not found | Not found | Not found | Yes |
| NABL indicator dashboard | Not found | Not found | Not found | Not found | Yes |

Sources:

- CrelioHealth medical lab LIS: https://creliohealth.com/lis/medical-lab/medical-lab-information-system
- CrelioHealth LIS for multi-site labs (QC, Levey-Jennings): https://creliohealth.com/us/lis/lis-system/texas-laboratory-information-system
- CrelioHealth Q1 2026 updates (delta check, QC lots): https://blog.creliohealth.com/smarter-faster-better-transformative-lis-updates-q1-2026/
- CrelioHealth Q2 2025 updates (vial tracking): https://blog.creliohealth.com/q2-2025-recap-catch-up-on-whats-new-at-creliohealth
- CrelioHealth pathology lab automation: https://creliohealth.com/lims/pathology-lab/pathology-lab-automation
- KareXpert Smart Hospital on Capterra: https://www.capterra.com/p/186949/Smart-Hospital/
- Epic Beaker (Mindbowser): https://www.mindbowser.com/epic-beaker-for-healthcare-it-teams/
- Epic Beaker (Folio3 Digital Health): https://digitalhealth.folio3.com/blog/?p=15406
- Epic Beaker in practice (CAP Today): https://www.captodayonline.com/benefits-bumps-shifting-beaker/
- Bahmni Lab Dashboard: https://bahmni.atlassian.net/wiki/spaces/BAH/pages/32014460/Using+Lab+Dashboard
- Bahmni Laboratory Management: https://bahmni.atlassian.net/wiki/spaces/BAH/pages/32604211/Laboratory+Management
- Westgard rules: https://en.wikipedia.org/wiki/Westgard_rules
- Critical value reporting and NABL 112 (Thieme): https://www.thieme-connect.com/products/ejournals/html/10.1055/s-0043-1775573

Critical-value timings, QC rules and retention periods are defaults; confirm the exact NABL 112 clause wording with the lab’s assessor.

## 15. Screens

| Screen | Role | Board |
|---|---|---|
| Laboratory worklists (collect, receive, result entry, validate, released, home) | Lab technician, pathologist | Lab |
| Sample collection and receipt | Lab reception, nurse | LabSample |
| Quality control (Levey-Jennings, Westgard, EQAS) | Lab technician, pathologist | LabQC |
| Microbiology (cultures, sensitivity, antibiogram) | Microbiologist | LabMicro |
| Histopathology | Pathologist | LabHisto |
| Lab settings (tests, ranges, critical values, analysers, partners) | Lab in-charge | LabConfig |
| Lab analytics | Management, lab in-charge | LabAnalytics |
| Phlebotomist phone screens | Phlebotomist | PhleboPhone |
| Lab report print | Patient, doctor | PrintLab |
