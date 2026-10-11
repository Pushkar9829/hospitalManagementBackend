from kit import *


def ep(rows):
    """Endpoint table: method, path, permission, description."""
    return table([["Method", "Path", "Permission", "Description"]] + rows,
                 widths=[0.08, 0.42, 0.28, 0.22], mono_cols=(0, 1, 2))


def story():
    s = []
    s += H1("REST API Documentation")
    s += H2("Conventions")
    s += kv([
        ["Base URL", "https://{hospital}.example.com/api/v1 (same origin as the web app)"],
        ["Format", "JSON, UTF-8. Dates in ISO 8601 UTC. Money in paise as integers"],
        ["Authentication", "httpOnly cookie access_token (web) or Authorization: Bearer "
                           "&lt;token&gt; (integrations). Refresh via POST /auth/refresh"],
        ["Branch", "Header x-branch-id selects the working branch for multi-branch users"],
        ["Idempotency", "POST endpoints that create money or stock records accept "
                        "Idempotency-Key header; repeats within 24 h return the first result"],
        ["Pagination", "?page=1&amp;limit=25 (max 100). Response: { items, page, limit, "
                       "total }"],
        ["Filtering, sorting", "?status=PAID&amp;from=2026-10-01&amp;sort=-createdAt"],
        ["Concurrency", "Updates send version; mismatch returns 409 VERSION_CONFLICT"],
        ["Rate limits", "Login: 10/min per IP. API: 600/min per user. Headers "
                        "RateLimit-Remaining, RateLimit-Reset"],
        ["Versioning", "/api/v1. Breaking changes go to /api/v2 with 6 months overlap"],
        ["Live docs", "OpenAPI 3.1 at /api/docs (Swagger UI) and /api/docs/openapi.json"],
    ])
    s += H3("Error format and status codes")
    s += code("""
HTTP/1.1 422 Unprocessable Entity
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some fields are invalid",
    "details": [ { "path": "mobile", "message": "Must be 10 digits" } ],
    "requestId": "c1b7e0a2-4f0e-4c3e-9a51-0d8f3f8e2a11"
  }
}
""")
    s += table([
        ["Status", "Code examples", "Meaning"],
        ["400", "BAD_REQUEST", "Malformed request"],
        ["401", "UNAUTHENTICATED, TOKEN_INVALID", "Not logged in or session expired"],
        ["402", "MODULE_NOT_SUBSCRIBED, TENANT_READ_ONLY, LIMIT_REACHED",
         "Subscription does not allow this"],
        ["403", "FORBIDDEN, MAKER_CANNOT_CHECK", "Logged in but not permitted"],
        ["404", "NOT_FOUND, TENANT_NOT_FOUND", "Record or hospital not found"],
        ["409", "VERSION_CONFLICT, BED_NOT_AVAILABLE, POSSIBLE_DUPLICATE",
         "State conflict; reload and retry"],
        ["422", "VALIDATION_FAILED, INSUFFICIENT_STOCK", "Business or field validation"],
        ["202", "APPROVAL_PENDING", "Accepted, waiting for maker-checker approval"],
        ["429", "RATE_LIMITED", "Too many requests"],
        ["500", "INTERNAL", "Unexpected error; requestId helps support"],
    ], widths=[0.1, 0.48, 0.42], mono_cols=(0, 1))

    s += H2("Authentication")
    s += ep([
        ["POST", "/auth/login", "public", "Username or mobile + password"],
        ["POST", "/auth/2fa/verify", "public (temp token)", "Verify OTP or TOTP"],
        ["POST", "/auth/refresh", "refresh cookie", "Rotate tokens"],
        ["POST", "/auth/logout", "any", "Revoke current session"],
        ["POST", "/auth/password/forgot", "public", "Send reset OTP"],
        ["POST", "/auth/password/reset", "public (OTP)", "Set new password"],
        ["GET", "/auth/me", "any", "User, roles, permissions, modules, branches"],
        ["POST", "/auth/switch-user", "any (ward PIN)", "Quick switch on shared terminal"],
    ])
    s += code("""
POST /api/v1/auth/login
{ "username": "anita.nurse", "password": "********" }

200 OK   (Set-Cookie: access_token=...; HttpOnly; Secure; SameSite=Strict)
{ "mfaRequired": true, "tempToken": "eyJhbGciOi...", "channels": ["SMS", "TOTP"] }

POST /api/v1/auth/2fa/verify
{ "tempToken": "eyJhbGciOi...", "code": "482913" }

200 OK
{
  "user": { "id": "6640cc...", "name": "Anita Sharma", "employeeCode": "EMP0042" },
  "roles": ["STAFF_NURSE"], "branches": [{ "id": "6650f1...", "name": "Main" }],
  "modules": ["CORE", "OPD", "IPD", "NUR", "LAB", "PHR"],
  "permissions": ["nursing:vitals:create", "nursing:mar:create", "ipd:bed:read", "..."]
}
""", "Login with two-factor authentication")

    s += H2("Platform, settings and approvals")
    s += ep([
        ["GET", "/subscription", "settings:subscription:read", "Plan, modules, limits, usage"],
        ["POST", "/subscription/module-requests", "settings:subscription:edit",
         "Request module add or removal"],
        ["CRUD", "/branches", "settings:branch:*", "Branches"],
        ["CRUD", "/departments", "settings:department:*", "Create goes to approval"],
        ["CRUD", "/users", "settings:user:*", "Users; privileged roles need approval"],
        ["CRUD", "/roles", "settings:role:*", "Custom roles and permissions"],
        ["CRUD", "/masters/{type}", "settings:master:*", "Services, price lists, tax codes..."],
        ["POST", "/masters/{type}/import", "settings:master:import", "Excel import with preview"],
        ["GET", "/approvals?status=PENDING", "approvals:inbox:read", "My approvals inbox"],
        ["POST", "/approvals/{id}/decision", "approvals:{role}:decide", "Approve or reject"],
        ["GET", "/audit", "audit:log:read", "Search audit log"],
        ["POST", "/files/upload-url", "files:file:create", "Presigned S3 upload URL"],
        ["GET", "/files/{id}/download-url", "files:file:read", "Presigned S3 download URL"],
    ])
    s += code("""
POST /api/v1/approvals/66a1f0.../decision
{ "decision": "APPROVE", "comment": "Senior citizen, approved as per policy" }

200 OK
{ "id": "66a1f0...", "action": "billing.discount", "status": "PENDING",
  "levelIndex": 1, "levels": [
    { "role": "BILLING_MANAGER", "decision": "APPROVE", "decidedBy": "Rahul M",
      "at": "2026-10-09T06:10:00Z" },
    { "role": "SUPER_ADMIN" } ] }
""", "Approve a request (moves to level 2)")

    s += H2("Patients")
    s += ep([
        ["GET", "/patients?q=", "patients:patient:read", "Search by UHID, mobile, name"],
        ["POST", "/patients", "patients:patient:create", "Register (duplicate check)"],
        ["GET", "/patients/{id}", "patients:patient:read", "Profile (access logged)"],
        ["PATCH", "/patients/{id}", "patients:patient:update", "Update with version"],
        ["GET", "/patients/{id}/timeline", "patients:patient:read", "Visits, admissions, "
                                                                   "reports, bills"],
        ["POST", "/patients/merge", "patients:patient:merge", "Merge (approval)"],
    ])
    s += code("""
POST /api/v1/patients
{
  "name": { "title": "Mr", "first": "Ravi", "last": "Kumar" },
  "gender": "M", "dob": "1979-05-14", "mobile": "9876543210",
  "address": { "line1": "12 MG Road", "city": "Pune", "state": "MH", "pin": "411001" },
  "ids": [{ "type": "AADHAAR", "number": "XXXX-XXXX-4321" }],
  "allergies": [{ "substance": "Penicillin", "reaction": "Rash", "severity": "MODERATE" }],
  "category": "GENERAL"
}

201 Created
{ "id": "6651aa...", "uhid": "CC0000123", "name": { "first": "Ravi", "last": "Kumar" },
  "age": "47Y", "createdAt": "2026-10-09T05:30:00Z", "version": 0 }

409 Conflict   (likely duplicate; resend with "confirmNotDuplicate": true)
{ "error": { "code": "POSSIBLE_DUPLICATE", "message": "Similar patients found",
  "details": { "dupes": [ { "id": "65ff...", "uhid": "CC0000077", "score": 0.91 } ] } } }
""", "Register a patient")

    s += H2("OPD and appointments")
    s += ep([
        ["CRUD", "/opd/schedules", "opd:schedule:*", "Doctor schedule templates"],
        ["GET", "/opd/slots?doctorId=&amp;date=", "opd:appointment:read", "Free slots"],
        ["POST", "/opd/appointments", "opd:appointment:create", "Book"],
        ["PATCH", "/opd/appointments/{id}", "opd:appointment:update", "Reschedule / cancel"],
        ["POST", "/opd/appointments/{id}/check-in", "opd:visit:create", "Check in, token"],
        ["GET", "/opd/queue?doctorId=", "opd:visit:read", "Live queue"],
        ["POST", "/opd/visits/{id}/vitals", "opd:vitals:create", "Triage vitals"],
        ["PUT", "/opd/visits/{id}/consultation", "opd:consultation:write",
         "Notes, diagnoses, Rx, orders"],
        ["POST", "/opd/visits/{id}/complete", "opd:consultation:write", "Close visit"],
        ["GET", "/opd/visits/{id}/prescription.pdf", "opd:visit:read", "Prescription PDF"],
    ])
    s += code("""
POST /api/v1/opd/appointments
{ "patientId": "6651aa...", "doctorId": "6640dd...", "slotStart": "2026-10-10T04:30:00Z",
  "visitType": "NEW", "channel": "FRONT_DESK" }

201 Created
{ "id": "6653cc...", "status": "BOOKED", "slotStart": "2026-10-10T04:30:00Z",
  "slotEnd": "2026-10-10T04:40:00Z", "doctor": { "name": "Dr. Meera Iyer" },
  "fee": 80000, "notifications": ["SMS_CONFIRMATION_QUEUED"] }
""", "Book an appointment")
    s += code("""
PUT /api/v1/opd/visits/6654dd.../consultation
{
  "complaints": [{ "text": "Chest pain on exertion", "duration": "2 weeks" }],
  "diagnoses": [{ "icd10": "I20.9", "text": "Angina pectoris, unspecified", "type": "PROVISIONAL" }],
  "prescription": { "items": [
    { "itemId": "66a0...", "drug": "Aspirin 75 mg tab", "dose": "1", "frequency": "OD",
      "durationDays": 30, "route": "ORAL", "instructions": "After lunch" } ] },
  "orders": [ { "type": "LAB", "serviceId": "65e1...", "name": "Lipid Profile" },
              { "type": "RAD", "serviceId": "65e2...", "name": "ECG" } ],
  "followUp": { "date": "2026-10-24" }, "version": 2
}
""", "Save consultation")

    s += H2("IPD and beds")
    s += ep([
        ["GET", "/ipd/beds?wardId=&amp;status=", "ipd:bed:read", "Bed board (plus socket)"],
        ["POST", "/ipd/beds/{id}/reserve", "ipd:bed:reserve", "Hold bed until a time"],
        ["PATCH", "/ipd/beds/{id}/status", "ipd:bed:update", "Cleaning, maintenance, block"],
        ["POST", "/ipd/admission-requests", "ipd:admission:request", "From OPD"],
        ["POST", "/ipd/admissions", "ipd:admission:create", "Admit and allocate bed"],
        ["POST", "/ipd/admissions/{id}/transfer", "ipd:admission:transfer", "Bed/ward transfer"],
        ["GET", "/ipd/admissions/{id}/running-bill", "billing:bill:read", "Live bill"],
        ["POST", "/ipd/admissions/{id}/discharge/initiate", "ipd:discharge:initiate",
         "Start clearances"],
        ["PUT", "/ipd/admissions/{id}/discharge-summary", "ipd:summary:write", "Draft or sign"],
        ["POST", "/ipd/admissions/{id}/discharge/complete", "ipd:discharge:complete",
         "Exit; bed to CLEANING"],
        ["POST", "/ipd/admissions/{id}/preauths", "ipd:preauth:create", "Send pre-authorisation"],
        ["POST", "/ipd/preauths/{id}/replies", "ipd:preauth:update", "Approval, query or denial"],
        ["POST", "/ipd/preauths/{id}/enhancements", "ipd:preauth:create", "Request more"],
        ["POST", "/ipd/preauths/{id}/final", "ipd:preauth:create", "Final bill for approval"],
        ["POST", "/ipd/claims", "ipd:claim:create", "File claim with documents"],
        ["POST", "/ipd/claims/{id}/settlements", "ipd:claim:settle", "Match payment, deductions"],
        ["GET", "/reports/ipd-indicators", "reports:ipd:read", "Occupancy, stay, turnover"],
    ])
    s += code("""
POST /api/v1/ipd/admissions
Idempotency-Key: 5d9a1c2e-...
{ "patientId": "6651aa...", "admissionRequestId": "66b1...", "bedId": "6620be...",
  "attendingDoctorId": "6640dd...", "departmentId": "6610ca...", "payer": { "type": "SELF" },
  "attendant": { "name": "Sunita Kumar", "relation": "Wife", "mobile": "9876500000" },
  "deposit": { "amount": 2000000, "modes": [{ "mode": "CARD", "amount": 2000000 }] } }

201 Created
{ "id": "66b2...", "ipNo": "IP/26-27/000871", "status": "ADMITTED",
  "bed": { "id": "6620be...", "label": "W2-204-B", "category": "SEMI_PRIVATE" },
  "depositReceiptNo": "RC/26-27/004512", "wristbandPdf": "/api/v1/files/66b3.../download-url" }

409 Conflict
{ "error": { "code": "BED_NOT_AVAILABLE", "message": "Bed was just taken, pick another" } }
""", "Admit a patient")

    s += H2("Nursing")
    s += ep([
        ["GET", "/nursing/wards/{id}/census", "nursing:ward:read", "Ward patients and tasks"],
        ["POST", "/nursing/admissions/{id}/vitals", "nursing:vitals:create", "Record vitals"],
        ["GET", "/nursing/admissions/{id}/mar", "nursing:mar:read", "Medication chart"],
        ["POST", "/nursing/mar/{doseId}/administer", "nursing:mar:create",
         "Given / held / refused"],
        ["POST", "/nursing/admissions/{id}/notes", "nursing:note:create", "Nursing note"],
        ["POST", "/nursing/admissions/{id}/io", "nursing:io:create", "Intake / output"],
        ["POST", "/nursing/handovers", "nursing:handover:create", "Shift handover"],
        ["POST", "/nursing/indents", "nursing:indent:create", "Pharmacy or store indent"],
    ])

    s += H2("Laboratory and radiology")
    s += ep([
        ["GET", "/lab/worklists?stage=", "lab:sample:read", "Collect / receive / result"],
        ["POST", "/lab/samples/collect", "lab:sample:collect", "Collect, print barcodes"],
        ["POST", "/lab/samples/{barcode}/receive", "lab:sample:receive", "Accept or reject"],
        ["PUT", "/lab/tests/{id}/results", "lab:result:enter", "Enter results (maker)"],
        ["POST", "/lab/results/import", "lab:result:import", "Analyser file import"],
        ["POST", "/lab/tests/{id}/validate", "lab:result:validate", "Validate (checker)"],
        ["GET", "/lab/reports/{orderId}.pdf", "lab:report:read", "Signed report"],
        ["GET", "/rad/schedule?modalityId=&amp;date=", "rad:study:read", "Modality schedule"],
        ["PATCH", "/rad/studies/{id}/status", "rad:study:update", "Arrived / performed"],
        ["PUT", "/rad/studies/{id}/report", "rad:report:write", "Draft report"],
        ["POST", "/rad/studies/{id}/sign", "rad:report:sign", "Radiologist sign-off"],
    ])
    s += code("""
PUT /api/v1/lab/tests/66c4.../results
{ "values": [
    { "parameterId": "hb", "value": 9.1 },
    { "parameterId": "wbc", "value": 14200 },
    { "parameterId": "plt", "value": 38000 } ],
  "remarks": "Platelets verified on smear", "version": 1 }

200 OK
{ "status": "RESULTED", "flags": [
    { "parameterId": "hb", "flag": "LOW", "range": "13.0-17.0 g/dL" },
    { "parameterId": "wbc", "flag": "HIGH", "range": "4000-11000 /uL" },
    { "parameterId": "plt", "flag": "CRITICAL_LOW", "range": "150000-410000 /uL" } ],
  "criticalAlertSentTo": ["Dr. Meera Iyer"], "awaiting": "PATHOLOGIST_VALIDATION" }
""", "Enter lab results with automatic flags")

    s += H2("Pharmacy and inventory")
    s += ep([
        ["CRUD", "/inventory/items", "inventory:item:*", "Drug and item master"],
        ["GET", "/pharmacy/rx-queue", "pharmacy:sale:read", "Prescriptions to dispense"],
        ["POST", "/pharmacy/sales", "pharmacy:sale:create", "OPD / counter sale (FEFO)"],
        ["POST", "/pharmacy/ipd-issues", "pharmacy:issue:create", "Issue to in-patient"],
        ["POST", "/pharmacy/returns", "pharmacy:return:create", "Patient / vendor returns"],
        ["GET", "/inventory/stock?storeId=&amp;itemId=", "inventory:stock:read",
         "Stock by batch"],
        ["POST", "/inventory/purchase-orders", "inventory:po:create", "PO (approval by value)"],
        ["POST", "/inventory/grns", "inventory:grn:create", "Goods receipt"],
        ["POST", "/inventory/indents", "inventory:indent:create", "Department indent"],
        ["POST", "/inventory/issues", "inventory:issue:create", "Issue against indent"],
        ["POST", "/inventory/transfers", "inventory:transfer:create", "Store to store"],
        ["POST", "/inventory/adjustments", "inventory:stock:adjust", "Adjustment (approval)"],
        ["GET", "/inventory/alerts", "inventory:stock:read", "Reorder and expiry alerts"],
    ])
    s += code("""
POST /api/v1/pharmacy/sales
Idempotency-Key: 0b7e...
{ "storeId": "66d0...", "patientId": "6651aa...", "prescriptionId": "6654dd...",
  "lines": [ { "itemId": "66a0...", "qty": 30 } ],
  "payment": { "modes": [{ "mode": "UPI", "amount": 4350 }] } }

201 Created
{ "billNo": "PH/26-27/010233", "lines": [
    { "itemId": "66a0...", "name": "Aspirin 75 mg tab",
      "batches": [ { "batchNo": "AS2401", "expiry": "2027-01-31", "qty": 20 },
                   { "batchNo": "AS2407", "expiry": "2027-07-31", "qty": 10 } ],
      "mrp": 145, "amount": 4350, "gstRate": 12 } ],
  "totals": { "net": 4350, "paid": 4350 }, "receiptPdf": "/api/v1/files/66d1.../download-url" }
""", "Pharmacy sale with FEFO batch selection")

    s += H2("Billing")
    s += ep([
        ["POST", "/billing/shifts/open", "billing:shift:open", "Open cashier shift"],
        ["POST", "/billing/shifts/close", "billing:shift:close", "Close with cash count"],
        ["GET", "/billing/patients/{id}/unbilled", "billing:bill:read", "Pending charges"],
        ["POST", "/billing/bills", "billing:bill:create", "Create bill from charges"],
        ["POST", "/billing/bills/{id}/discount", "billing:discount:request", "202 if approval"],
        ["POST", "/billing/bills/{id}/payments", "billing:payment:create", "Collect payment"],
        ["POST", "/billing/deposits", "billing:deposit:create", "IPD advance"],
        ["POST", "/billing/bills/{id}/cancel", "billing:bill:cancel", "Approval required"],
        ["POST", "/billing/refunds", "billing:refund:request", "Approval required"],
        ["GET", "/billing/bills/{id}/pdf?format=A4|THERMAL", "billing:bill:print",
         "Print / reprint"],
    ])
    s += code("""
POST /api/v1/billing/bills/66e1.../discount
{ "type": "PERCENT", "value": 15, "reason": "Senior citizen, financial hardship" }

202 Accepted
{ "code": "APPROVAL_PENDING", "approvalId": "66a1f0...",
  "pendingWith": "BILLING_MANAGER", "levels": 2, "expiresAt": "2026-10-11T06:00:00Z" }
""", "Discount that triggers maker-checker")

    s += H2("HR, attendance and payroll")
    s += ep([
        ["CRUD", "/hr/employees", "hr:employee:*", "Employee master"],
        ["CRUD", "/hr/shifts", "hr:shift:*", "Shift master"],
        ["GET", "/hr/rosters?deptId=&amp;month=", "hr:roster:read", "Roster grid"],
        ["PUT", "/hr/rosters", "hr:roster:write", "Save draft roster"],
        ["POST", "/hr/rosters/{id}/publish", "hr:roster:publish", "Publish"],
        ["POST", "/hr/roster-swaps", "self", "Request swap"],
        ["POST", "/hr/attendance/punches/import", "hr:attendance:import", "Biometric file"],
        ["POST", "/hr/attendance/punch", "self", "Web / mobile punch (geo)"],
        ["POST", "/hr/attendance/lock", "hr:attendance:lock", "Lock month"],
        ["POST", "/hr/leave-requests", "self", "Apply leave"],
        ["POST", "/hr/leave-requests/{id}/decision", "hr:leave:approve", "Approve / reject"],
        ["CRUD", "/payroll/structures", "payroll:structure:*", "Salary templates"],
        ["POST", "/payroll/runs", "payroll:run:create", "Start draft run for month"],
        ["GET", "/payroll/runs/{id}/variance", "payroll:run:read", "Compare with last month"],
        ["POST", "/payroll/runs/{id}/submit", "payroll:run:create", "Submit for approval"],
        ["GET", "/payroll/runs/{id}/bank-file", "payroll:run:export", "Bank transfer file"],
        ["GET", "/payroll/payslips/me", "self", "My payslips"],
    ])
    s += code("""
POST /api/v1/payroll/runs
{ "month": "2026-09", "branchIds": ["6650f1..."] }

202 Accepted   (calculation runs in the background worker)
{ "id": "66f0...", "status": "DRAFT", "jobId": "payroll:66f0...", "employees": 412 }

GET /api/v1/payroll/runs/66f0...
{ "id": "66f0...", "month": "2026-09", "status": "CALCULATED",
  "summary": { "employees": 412, "gross": 1842345000, "deductions": 211230000,
               "net": 1631115000, "employerPf": 98450000, "employerEsi": 12345000 },
  "warnings": [ { "employeeCode": "EMP0187", "message": "Net pay changed by +38%" } ] }
""", "Payroll run")

    s += H2("Finance and reports")
    s += ep([
        ["CRUD", "/finance/ledgers", "finance:ledger:*", "Chart of accounts"],
        ["POST", "/finance/vouchers", "finance:voucher:create", "Manual voucher (approval)"],
        ["GET", "/finance/ledgers/{id}/statement", "finance:ledger:read", "Ledger statement"],
        ["GET", "/finance/trial-balance?asOn=", "finance:report:read", "Trial balance"],
        ["GET", "/finance/pnl?from=&amp;to=&amp;costCentre=", "finance:report:read", "P&amp;L"],
        ["GET", "/finance/balance-sheet?asOn=", "finance:report:read", "Balance sheet"],
        ["GET", "/finance/gst/gstr1?month=", "finance:gst:read", "GSTR-1 data"],
        ["POST", "/finance/periods/{id}/close", "finance:period:close", "Close month"],
        ["GET", "/reports/{code}?params", "reports:{module}:read", "Any module report"],
        ["POST", "/reports/{code}/export", "reports:{module}:export", "Async Excel / PDF to S3"],
    ])
    s += H2("Medical records, diet, facility and quality")
    s += ep([
        ["GET", "/mrd/deficiencies?doctorId=", "mrd:record:read", "Pending record items"],
        ["PUT", "/mrd/records/{admissionId}/coding", "mrd:coding:write", "Final ICD-10 codes"],
        ["POST", "/mrd/files/{id}/issue", "mrd:file:issue", "Issue physical file"],
        ["POST", "/mrd/release-requests", "mrd:release:request", "Record copy (approval)"],
        ["POST", "/mrd/births", "mrd:birth:create", "Birth register entry"],
        ["POST", "/mrd/deaths", "mrd:death:create", "Death register entry"],
        ["GET", "/mrd/deaths/{id}/mccd.pdf", "mrd:death:read", "Cause of death certificate"],
        ["CRUD", "/mrd/mlc", "mrd:mlc:*", "Medico-legal register"],
        ["PUT", "/diet/orders/{admissionId}", "diet:order:write", "Diet and NBM"],
        ["GET", "/diet/production?date=&amp;meal=", "diet:kitchen:read", "Production sheet"],
        ["POST", "/diet/deliveries", "diet:kitchen:write", "Confirm ward delivery"],
        ["GET", "/facility/hk-tasks?status=", "facility:hk:read", "Housekeeping board"],
        ["POST", "/facility/hk-tasks/{id}/done", "facility:hk:write", "Bed or area cleaned"],
        ["POST", "/facility/linen/transactions", "facility:linen:write", "Issue / laundry"],
        ["POST", "/facility/tickets", "any staff", "Raise maintenance ticket"],
        ["PATCH", "/facility/tickets/{id}", "facility:ticket:update", "Assign, resolve"],
        ["CRUD", "/facility/equipment", "facility:equipment:*", "Equipment, PM, AMC"],
        ["POST", "/facility/bmw/entries", "facility:bmw:write", "Biomedical waste weights"],
        ["POST", "/quality/incidents", "any staff", "Report incident"],
        ["PATCH", "/quality/incidents/{id}", "quality:incident:update", "RCA, CAPA, close"],
        ["CRUD", "/quality/complaints", "quality:complaint:*", "Complaint register"],
        ["GET", "/quality/indicators?month=", "quality:indicator:read", "Indicator values"],
        ["POST", "/public/feedback/{token}", "patient link", "Submit feedback"],
    ])

    s += H2("CRM, ABDM and clinic features")
    s += ep([
        ["GET", "/crm/callers/{phone}", "crm:call:read", "Caller lookup"],
        ["CRUD", "/crm/leads", "crm:lead:*", "Leads and follow-ups"],
        ["CRUD", "/crm/camps", "crm:camp:*", "Health camps"],
        ["POST", "/crm/campaigns", "crm:campaign:create", "Send campaign (consent-aware)"],
        ["CRUD", "/crm/memberships", "crm:membership:*", "Memberships and wallet"],
        ["CRUD", "/crm/referral-partners", "crm:partner:*", "Referral partners"],
        ["POST", "/abdm/abha/verify", "patients:abha:link", "Create or verify ABHA"],
        ["POST", "/abdm/scan-share/callback", "ABDM gateway (signed)", "Scan and Share"],
        ["POST", "/abdm/care-contexts/link", "patients:abha:link", "Link records to ABHA"],
        ["POST", "/front-office/tokens", "frontoffice:token:create", "Issue counter token"],
        ["CRUD", "/opd/specialty-forms", "opd:template:*", "Specialty templates"],
        ["CRUD", "/opd/treatment-plans", "opd:plan:*", "Multi-session plans"],
        ["POST", "/opd/visits/{id}/certificates", "opd:certificate:create",
         "Medical certificate"],
        ["CRUD", "/lab/home-collections", "lab:home:*", "Home sample visits"],
        ["CRUD", "/lab/collection-centres", "lab:centre:*", "Partner centres"],
        ["POST", "/nursing/admissions/{id}/icu-chart", "nursing:icu:write", "ICU flowsheet"],
        ["POST", "/facility/transport-requests", "any staff", "Porter request"],
    ])

    s += H2("Front office, portal and other additions")
    s += ep([
        ["CRUD", "/front-office/enquiries", "frontoffice:enquiry:*", "Enquiry log"],
        ["POST", "/front-office/passes", "frontoffice:pass:create", "Attendant / visitor pass"],
        ["POST", "/front-office/passes/{code}/scan", "frontoffice:pass:scan", "Gate in / out"],
        ["POST", "/portal/auth/otp", "patient (public)", "Portal login OTP"],
        ["GET", "/portal/me/documents", "patient", "Reports, bills, summaries"],
        ["POST", "/portal/me/payments", "patient", "Pay dues online"],
        ["CRUD", "/opd/health-check-packages", "opd:package:*", "Check-up packages"],
        ["POST", "/opd/health-checks", "opd:healthcheck:create", "Book and route sheet"],
        ["POST", "/rad/studies/{id}/form-f", "rad:pcpndt:write", "PCPNDT Form F"],
        ["CRUD", "/hr/requisitions, /hr/candidates", "hr:recruitment:*", "Recruitment"],
        ["CRUD", "/hr/trainings, /hr/appraisals", "hr:training:*, hr:appraisal:*",
         "Training, appraisal"],
        ["POST", "/finance/expense-claims", "self", "Claim with receipts"],
        ["CRUD", "/finance/petty-cash, /finance/budgets", "finance:pettycash:*",
         "Petty cash, budgets"],
    ])

    s += H2("WebSocket events")
    s += table([
        ["Channel / event", "Payload", "Who receives"],
        ["beds / bed:update", "bedId, wardId, status, patient summary", "Bed board viewers"],
        ["queue / queue:update", "doctorId, token, status", "Doctor screen, TV display"],
        ["approvals / approval:new", "approvalId, action, summary", "Users with checker role"],
        ["alerts / lab:critical", "patient, test, value", "Ordering doctor, ward"],
        ["nursing / task:due", "admissionId, task, dueAt", "Assigned ward nurses"],
        ["jobs / job:done", "jobId, fileUrl", "User who started an export or payroll run"],
    ], widths=[0.28, 0.42, 0.3], mono_cols=(0,))
    return s
