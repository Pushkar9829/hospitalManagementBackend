import { randomUUID } from 'node:crypto';

/**
 * FHIR R4 bundles for the National Health Claims Exchange (NHCX). A pre-authorisation and a
 * claim are the same `Claim` resource with a different `use`; the payer answers with a
 * `ClaimResponse`. Profiles follow the NRCeS NHCX implementation guide; validate a sample in the
 * NHCX sandbox before going live (the IG version is pinned by the exchange).
 */
const PROFILE = 'https://nrces.in/ndhm/fhir/r4/StructureDefinition';
const SYSTEM = {
  pmjay: 'https://pmjay.gov.in/beneficiary-id',
  abha: 'https://healthid.abdm.gov.in',
  hfr: 'https://facility.abdm.gov.in',
  hbp: 'https://pmjay.gov.in/hbp-package',
  participant: 'https://hcxprotocol.io/participant-code',
};

const money = (paise) => ({ value: Math.round(paise) / 100, currency: 'INR' });

/** `use`: 'preauthorization' or 'claim'. */
export function claimBundle({ use, c, settings, bill }) {
  const ids = {
    patient: randomUUID(),
    provider: randomUUID(),
    insurer: randomUUID(),
    coverage: randomUUID(),
    claim: randomUUID(),
  };
  const total = c.packages.reduce((s, p) => s + (p.rate ?? 0), 0);
  const patient = {
    resourceType: 'Patient',
    id: ids.patient,
    meta: { profile: [`${PROFILE}/Patient`] },
    identifier: [
      { system: SYSTEM.pmjay, value: c.beneficiary.pmjayId },
      ...(c.beneficiary.abha ? [{ system: SYSTEM.abha, value: c.beneficiary.abha }] : []),
      { system: 'urn:hms:uhid', value: c.patient.uhid },
    ],
    name: [{ text: c.beneficiary.name || c.patient.name }],
    telecom: c.patient.mobile ? [{ system: 'phone', value: c.patient.mobile }] : [],
  };
  const provider = {
    resourceType: 'Organization',
    id: ids.provider,
    meta: { profile: [`${PROFILE}/Organization`] },
    identifier: [
      ...(settings.hfrId ? [{ system: SYSTEM.hfr, value: settings.hfrId }] : []),
      ...(settings.nhcx?.participantCode
        ? [{ system: SYSTEM.participant, value: settings.nhcx.participantCode }]
        : []),
      ...(settings.hospitalCode
        ? [{ system: 'urn:pmjay:hospital', value: settings.hospitalCode }]
        : []),
    ],
    name: 'Provider',
  };
  const insurer = {
    resourceType: 'Organization',
    id: ids.insurer,
    identifier: [{ system: SYSTEM.participant, value: settings.nhcx?.payerCode ?? 'pmjay-sha' }],
    name: 'PM-JAY State Health Agency',
  };
  const coverage = {
    resourceType: 'Coverage',
    id: ids.coverage,
    meta: { profile: [`${PROFILE}/Coverage`] },
    status: 'active',
    subscriberId: c.beneficiary.pmjayId,
    beneficiary: { reference: `urn:uuid:${ids.patient}` },
    payor: [{ reference: `urn:uuid:${ids.insurer}` }],
    class: [{ type: { text: 'plan' }, value: 'AB-PMJAY', name: 'Ayushman Bharat PM-JAY' }],
  };
  const claim = {
    resourceType: 'Claim',
    id: ids.claim,
    meta: { profile: [`${PROFILE}/Claim`] },
    identifier: [{ system: 'urn:hms:ip-no', value: c.ipNo }],
    status: 'active',
    type: {
      coding: [
        { system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'institutional' },
      ],
    },
    use,
    patient: { reference: `urn:uuid:${ids.patient}` },
    created: new Date().toISOString(),
    insurer: { reference: `urn:uuid:${ids.insurer}` },
    provider: { reference: `urn:uuid:${ids.provider}` },
    priority: { coding: [{ code: 'normal' }] },
    insurance: [{ sequence: 1, focal: true, coverage: { reference: `urn:uuid:${ids.coverage}` } }],
    diagnosis: c.diagnosis
      ? [{ sequence: 1, diagnosisCodeableConcept: { text: c.diagnosis } }]
      : undefined,
    supportingInfo: (c.documents ?? [])
      .filter((d) => d.fileId)
      .map((d, i) => ({
        sequence: i + 1,
        category: { text: d.stage },
        valueAttachment: { title: d.name, url: `urn:hms:file:${d.fileId}` },
      })),
    item: c.packages.map((p, i) => ({
      sequence: i + 1,
      productOrService: { coding: [{ system: SYSTEM.hbp, code: p.code, display: p.name }] },
      unitPrice: money(p.rate),
      net: money(p.rate),
    })),
    total: money(use === 'claim' && bill ? bill.total : total),
  };
  return {
    resourceType: 'Bundle',
    id: randomUUID(),
    meta: { profile: [`${PROFILE}/${use === 'claim' ? 'ClaimBundle' : 'PreauthBundle'}`] },
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: [claim, patient, provider, insurer, coverage].map((r) => ({
      fullUrl: `urn:uuid:${r.id}`,
      resource: r,
    })),
  };
}

/**
 * The payer's answer as a FHIR ClaimResponse (what NHCX delivers on the `on_submit` callback).
 * outcome: complete (approved), queued (query), error (rejected).
 */
export function claimResponse({ use, outcome, amount, text, preauthRef }) {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        resource: {
          resourceType: 'ClaimResponse',
          status: 'active',
          use,
          outcome,
          disposition: text,
          preAuthRef: preauthRef,
          total: amount != null ? [{ category: { text: 'benefit' }, amount: money(amount) }] : [],
        },
      },
    ],
  };
}

/** Reads a ClaimResponse bundle into the desk's decision. */
export function readDecision(bundle) {
  const r = bundle?.entry?.map((e) => e.resource).find((x) => x?.resourceType === 'ClaimResponse');
  if (!r) return null;
  const amount = r.total?.find((t) => t.amount)?.amount?.value;
  const outcome =
    r.outcome === 'complete' ? 'APPROVED' : r.outcome === 'queued' ? 'QUERY' : 'REJECTED';
  return {
    use: r.use,
    outcome,
    amount: amount != null ? Math.round(amount * 100) : undefined,
    text: r.disposition,
    ref: r.preAuthRef,
  };
}
