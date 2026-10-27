# PM-JAY cashless (module `PMJ`)

Ayushman Bharat PM-JAY cashless treatment for empanelled hospitals. It is a paid add-on module
and needs IPD. Code: `api/src/modules/pmjay`, screen `web/src/modules/pmjay` (route `/ipd/pmjay`,
menu **PM-JAY Desk**), tests `api/test/int/pmjay.int.test.js`.

## How PM-JAY works and where the HMS fits

| Step | Where it happens | What the HMS does |
| --- | --- | --- |
| Empanelment, specialties, package rates | NHA Hospital Engagement Module (HEM), State Health Agency | Holds the hospital's HBP package list at the state rate |
| Beneficiary check (Aadhaar OTP / biometric) | NHA BIS app, by the Ayushman Mitra | Records the PM-JAY ID, method and BIS reference |
| Pre-authorisation, claim | **TMS 2.0** web portal (typed in), or **NHCX** API (FHIR) | Tracks the case, clocks and documents; sends over NHCX when chosen |
| Payment | State Health Agency → hospital bank (UTR) | Settles the IP bill, writes off the deductions |

TMS has no public API for private HMS vendors, so on the **TMS channel** the desk works in TMS and
types the TMS numbers into the HMS. The **NHCX channel** sends FHIR bundles over the National
Health Claims Exchange; NHA has said PM-JAY 2.0 will route through NHCX. Ask your State Health
Agency which channel it accepts.

## Rules built in

- Registering a case moves the stay to the PM-JAY payer: no deposit, and the patient is never
  asked for money. The IP bill becomes the package rate(s); room days and charges are kept on the
  stay but not billed. Discharge needs no "dues" approval.
- Clocks (private / public hospital): pre-auth within 48 h / 72 h of registration; payer decides
  in 6 h; query reply in 24 h / 5 days; claim within 7 / 15 days of discharge; payment 15 days.
  Overdue clocks show first in the worklist and the worker publishes `pmjay.clock.overdue`.
- Document checklist per stage (standard list plus each package's own documents); pre-auth and
  claim are refused until it is complete. Death cases need the death certificate and mortality
  audit instead of the feedback form.
- Packages marked "public hospitals only" cannot be booked by a private hospital. Packages that
  need no pre-auth are approved as soon as they are sent.
- Pre-auth rejected or case cancelled: the stay goes back to cash and the itemised bill.
- Payment: the bill is marked paid; the shortfall (deductions) is written off on the bill
  (`schemeWriteOff`), never charged to the patient.

## API

`/api/v1/pmjay/…`: `settings` (GET, PUT), `packages` (GET, POST, PATCH `:id`, POST `import`),
`summary`, `stays`, `cases` (GET, POST), `cases/:id`, `cases/:id/packages` (PUT),
`cases/:id/documents`, `cases/:id/preauth`, `…/preauth/decision`, `…/preauth/answer-query`,
`cases/:id/claim`, `…/claim/decision`, `…/claim/answer-query`, `cases/:id/payment`,
`cases/:id/cancel`, `cases/:id/fhir?use=preauthorization|claim`, `cases/:id/nhcx/mock-response`,
`admissions/:id/case`. Public NHCX callback: `POST /pmjay/nhcx/{preauth|claim}/on_submit`
(JWE body).

## NHCX configuration

Settings → channel NHCX, mode MOCK / SANDBOX / LIVE, participant codes. Secrets stay in the server
environment: `NHCX_BASE_URL`, `NHCX_AUTH_URL`, `NHCX_USERNAME`, `NHCX_SECRET`,
`NHCX_PAYER_PUBLIC_KEY` (PEM), `NHCX_PRIVATE_KEY` (PEM, opens callbacks). MOCK mode sends nothing
out; "Simulate payer" answers through the same callback code. Register
`https://<api-host>/api/v1/pmjay/nhcx` as the callback base with NHCX.

## Demo data (local only)

`node --env-file=.env scripts/seed-pmjay-demo.js` then `npm run sync:roles`. It switches PMJ on
for every hospital, creates the payer and settings and 10 sample packages. The sample codes and
rates are illustrative; import the state's real list.

## Not covered yet

- No TMS API: TMS numbers are typed in.
- NHCX was tested only against the mock and a local JWE round trip, not the real sandbox
  (needs participant registration).
- The payment and write-off are published as `pmjay.claim.paid`; the finance ledger does not post
  them yet.
