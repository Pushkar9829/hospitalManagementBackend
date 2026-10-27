/**
 * PM-JAY turnaround rules (NHA TMS 2.0 provider manual). Private and public hospitals run on
 * different clocks; the scheme auto-rejects or auto-approves when a clock runs out, so the desk
 * is warned before that happens.
 */
const H = 3_600_000;
const D = 24 * H;

export const CLOCKS = Object.freeze({
  PRIVATE: {
    PREAUTH_INITIATE: 48 * H, // after registration, else auto-rejected
    PREAUTH_DECISION: 6 * H, // payer side, else deemed approved
    PREAUTH_QUERY_REPLY: 24 * H,
    CLAIM_SUBMIT: 7 * D, // after discharge
    CLAIM_QUERY_REPLY: 7 * D,
    CLAIM_PAYMENT: 15 * D, // in-state; 30 days for portability cases
  },
  PUBLIC: {
    PREAUTH_INITIATE: 72 * H,
    PREAUTH_DECISION: 6 * H,
    PREAUTH_QUERY_REPLY: 5 * D,
    CLAIM_SUBMIT: 15 * D,
    CLAIM_QUERY_REPLY: 15 * D,
    CLAIM_PAYMENT: 15 * D,
  },
});

export const clock = (hospitalType, kind, from = new Date()) =>
  new Date(from.getTime() + CLOCKS[hospitalType === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE'][kind]);

/** The scheme's standard documents per stage; packages may add their own. */
export const STANDARD_DOCUMENTS = Object.freeze({
  PREAUTH: ['Beneficiary ID (e-card)', 'Clinical notes', 'Supporting investigation reports'],
  DISCHARGE: ['Discharge summary', 'Post-procedure photograph', 'Patient feedback form'],
  DEATH: ['Death certificate', 'Mortality audit report'],
  CLAIM: ['Final bill'],
});

/** Documents still missing for a stage, given the case's packages and discharge outcome. */
export function missingDocuments(c, stage) {
  const have = new Set(
    (c.documents ?? []).filter((d) => d.fileId).map((d) => d.name.trim().toLowerCase()),
  );
  let need = [];
  if (stage === 'PREAUTH') need = [...STANDARD_DOCUMENTS.PREAUTH];
  if (stage === 'CLAIM') {
    need =
      c.outcome === 'DEATH'
        ? ['Discharge summary', ...STANDARD_DOCUMENTS.DEATH, ...STANDARD_DOCUMENTS.CLAIM]
        : [...STANDARD_DOCUMENTS.DISCHARGE, ...STANDARD_DOCUMENTS.CLAIM];
  }
  for (const p of c.packages ?? [])
    for (const d of (stage === 'PREAUTH' ? p.documents?.preauth : p.documents?.claim) ?? [])
      need.push(d);
  return [...new Set(need)].filter((n) => !have.has(n.toLowerCase()));
}
