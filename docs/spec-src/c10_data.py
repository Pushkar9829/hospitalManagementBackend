from kit import *


def story():
    s = []
    s += H1("Database Design (MongoDB)")
    s += H2("Design rules")
    s += bullets([
        "Every tenant-owned collection has <font name='Mono' size='8.5'>tenantId</font> and "
        "<font name='Mono' size='8.5'>branchId</font> where relevant, and every index starts "
        "with <font name='Mono' size='8.5'>tenantId</font>.",
        "Common fields on every document: createdAt, createdBy, updatedAt, updatedBy, "
        "isDeleted (soft delete), version (optimistic locking).",
        "Money is stored as integers in paise (Decimal128 for rates with more precision), "
        "never as floating point.",
        "References use ObjectId; small, stable data needed for printing is copied "
        "(snapshot), e.g. patient name and UHID on a bill, so old bills print correctly "
        "after a name change.",
        "Writes that touch several documents (bill + payment + stock) use multi-document "
        "transactions, which need a replica set (Atlas provides this).",
        "Human-readable numbers (UHID, bill no.) come from an atomic counter collection per "
        "tenant, branch, series and year.",
        "Clinical records are never hard-deleted. Corrections create a new version with "
        "the previous one kept.",
    ])

    s += H2("Collections by module")
    s += table([
        ["Module", "Collection", "Purpose and key fields"],
        ["Platform", "tenants", "name, subdomain, status, plan, modules[{code, status, "
                                "validTill}], limits{users, beds, storageGb}, dbStrategy"],
        ["Platform", "subscriptionInvoices", "tenantId, period, lines, amount, status, "
                                             "gatewayRef"],
        ["CORE", "branches, departments", "code, name, type, parentId, hodId, costCentre, "
                                          "status"],
        ["CORE", "users", "employeeId, username, mobile, passwordHash, roles[], branchIds[], "
                          "mfa, lockedUntil, lastLoginAt"],
        ["CORE", "roles", "name, system, permissions[], dataScope"],
        ["CORE", "approvalRules, approvalRequests", "action, thresholds, levels; request: "
                                                     "maker, payload, before, status, "
                                                     "decisions[]"],
        ["CORE", "auditLogs", "actor, action, entity, entityId, diff, ip, at (time-series, "
                              "TTL none)"],
        ["CORE", "counters", "_id = tenant:branch:series:year, seq"],
        ["CORE", "patients", "uhid, name{}, gender, dob, mobile, ids[], allergies[], flags, "
                             "category, mergedInto"],
        ["CORE", "services, priceLists, packages, taxCodes", "Tariff and pricing masters"],
        ["CORE", "bills, payments, deposits, refunds", "billNo, patient snapshot, visit / "
                                                       "admission ref, lines[], totals, "
                                                       "status; payment modes[]"],
        ["CORE", "cashierShifts", "user, counter, openedAt, opening, closing, variance"],
        ["CORE", "employees", "empCode, name, department, designation, doctorProfile{}, "
                              "contacts (HR fields added by HRM)"],
        ["CORE", "files, notifications", "S3 key, mime, size, owner entity; message "
                                         "channel, template, status"],
        ["OPD", "doctorSchedules, appointments, visits", "slots, visit status timeline, "
                                                         "vitals, notes, diagnoses[], "
                                                         "prescription{items[]}"],
        ["OPD", "orders", "type (lab, rad, proc, drug), items[], source visit / admission, "
                          "status"],
        ["IPD", "wards, rooms, beds", "bed category, status, currentAdmissionId, "
                                      "statusChangedAt"],
        ["IPD", "admissions, transfers, dischargeSummaries", "ipNo, bed history[], "
                                                             "consultants, payer, status"],
        ["IPD", "preAuths, claims, settlements", "admissionId, payerId, policyNo, "
                                                  "requested, approved[], status, timers, "
                                                  "documents[], utr"],
        ["NUR", "vitals, marEntries, nursingNotes, ioCharts, handovers", "admissionId, at, "
                                                                          "by, values"],
        ["LAB", "labTests, labSamples, labResults", "parameters, ranges; barcode, status "
                                                    "history; values[], flags, "
                                                    "validatedBy"],
        ["RAD", "radStudies, radReports", "modality, schedule, accessionNo; template, "
                                          "signedBy"],
        ["PHR / INV", "items, stores, stockBatches, stockLedger", "batchNo, expiry, mrp, "
                                                                  "cost, qty; every "
                                                                  "movement as ledger row"],
        ["PHR / INV", "vendors, purchaseOrders, grns, indents, transfers", "procurement "
                                                                           "documents"],
        ["HRM", "shifts, rosters, attendance, leaveTypes, leaveRequests, leaveBalances",
         "roster cells per day; punches; accruals"],
        ["PAY", "salaryStructures, employeeSalaries, payrollRuns, payslips, loans",
         "components with formulas; run status; lines per employee"],
        ["FIN", "ledgers, vouchers, journalEntries, bankStatements, periods",
         "double-entry lines[], costCentre, source event ref"],
        ["FIN", "pettyCash, expenseClaims, budgets", "imprest, vouchers; claims with "
                                                     "receipts; budget per cost centre"],
        ["HRM", "requisitions, candidates, trainings, appraisals", "recruitment pipeline, "
                                                                  "certifications, reviews"],
        ["CORE", "enquiries, visitorPasses, circulars", "front office and notices"],
        ["MRD", "recordFiles, deficiencies, releaseRequests, births, deaths, mlcCases, "
                "mortuary", "completion status, coding, legal registers"],
        ["DIET", "dietTypes, dietOrders, mealRuns, mealDeliveries", "per admission, NBM "
                                                                    "windows, counts"],
        ["FAC", "hkTasks, linenTransactions, tickets, equipment, pmSchedules, "
                "bmwEntries", "TAT, downtime, waste weights"],
        ["QLT", "feedback, complaints, incidents, indicators, audits, documents, "
                "haiEvents", "CAPA, monthly indicator values, infection events"],
        ["CRM", "leads, calls, camps, campaigns, memberships, wallets, referralPartners",
         "stages, consent, balances, partner statements"],
        ["OPD / LAB", "specialtyForms, treatmentPlans, certificates, homeCollections, "
                      "collectionCentres", "templates, sessions, visits, rate lists"],
        ["CORE", "tokens, abhaLinks", "counter queues; ABHA to UHID links and consents"],
    ], widths=[0.11, 0.3, 0.59], mono_cols=(1,))

    s += H2("Critical indexes")
    s += code("""
patients:        { tenantId: 1, uhid: 1 }                         unique
                 { tenantId: 1, mobile: 1 }
                 { tenantId: 1, "name.searchKey": 1 }             prefix search
                 { tenantId: 1, "ids.type": 1, "ids.number": 1 }  duplicate check
appointments:    { tenantId: 1, doctorId: 1, slotStart: 1 }       unique, partial(status!=CANCELLED)
visits:          { tenantId: 1, branchId: 1, visitDate: -1, status: 1 }
beds:            { tenantId: 1, wardId: 1, status: 1 }
admissions:      { tenantId: 1, ipNo: 1 } unique ; { tenantId: 1, status: 1, wardId: 1 }
bills:           { tenantId: 1, billNo: 1 } unique ; { tenantId: 1, patientId: 1, createdAt: -1 }
stockBatches:    { tenantId: 1, storeId: 1, itemId: 1, expiry: 1 }  FEFO lookup
labSamples:      { tenantId: 1, barcode: 1 } unique ; { tenantId: 1, status: 1, deptId: 1 }
attendance:      { tenantId: 1, employeeId: 1, date: 1 }           unique
journalEntries:  { tenantId: 1, entityId: 1, date: 1 } ; { tenantId: 1, "lines.ledgerId": 1 }
auditLogs:       { tenantId: 1, entity: 1, entityId: 1, at: -1 } ; { tenantId: 1, actor: 1, at: -1 }
approvalRequests:{ tenantId: 1, status: 1, "pendingWith.role": 1 }
""", "Index plan (all indexes lead with tenantId)")

    s += H2("Sample documents")
    s += code("""
// tenants
{
  "_id": "6650f0...", "name": "CityCare Hospital", "subdomain": "citycare",
  "status": "ACTIVE", "plan": "HOSPITAL",
  "modules": [
    { "code": "CORE", "status": "ACTIVE", "validTill": "2027-03-31" },
    { "code": "OPD",  "status": "ACTIVE", "validTill": "2027-03-31" },
    { "code": "PHR",  "status": "ACTIVE", "validTill": "2027-03-31" },
    { "code": "PAY",  "status": "DISABLED" }
  ],
  "limits": { "users": 100, "beds": 120, "branches": 3, "storageGb": 250 },
  "dbStrategy": "SHARED"
}

// bills (amounts in paise)
{
  "tenantId": "6650f0...", "branchId": "6650f1...", "billNo": "OP/26-27/000154",
  "type": "OPD", "status": "PAID",
  "patient": { "id": "6651aa...", "uhid": "CC000123", "name": "Ravi Kumar" },
  "visitId": "6652bb...",
  "lines": [
    { "serviceId": "...", "name": "Consultation - Cardiology", "qty": 1,
      "rate": 80000, "discount": 0, "taxRate": 0, "amount": 80000 },
    { "serviceId": "...", "name": "Lipid Profile", "qty": 1,
      "rate": 65000, "discount": 6500, "taxRate": 0, "amount": 58500 }
  ],
  "totals": { "gross": 145000, "discount": 6500, "tax": 0, "net": 138500, "paid": 138500 },
  "payments": [ { "mode": "UPI", "amount": 138500, "ref": "UPI3487..." } ],
  "createdBy": "6640cc...", "createdAt": "2026-10-09T05:42:11Z", "version": 3
}
""", "tenants and bills")
    return s
