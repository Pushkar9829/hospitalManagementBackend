/**
 * Default test definitions for common tests, matched to billing services by code. A hospital
 * edits them on the Lab settings screen; these are adult reference ranges from common Indian
 * lab practice and must be confirmed by the lab's pathologist before go-live.
 *
 * Analyte: [code, name, unit, low, high, criticalLow, criticalHigh, deltaPct, decimals]
 * Sex-specific ranges are given as { M: [low, high], F: [low, high] }.
 */
const Y = 365;
const num = (code, name, unit, range, critLow, critHigh, deltaPct, decimals = 1) => ({
  code,
  name,
  unit,
  kind: 'NUMBER',
  decimals,
  ranges: Array.isArray(range)
    ? [{ sex: 'ANY', ageMinDays: 18 * Y, low: range[0], high: range[1] }, childRange(range)]
    : Object.entries(range).map(([sex, [low, high]]) => ({
        sex,
        ageMinDays: 18 * Y,
        low,
        high,
      })),
  criticalLow: critLow ?? undefined,
  criticalHigh: critHigh ?? undefined,
  deltaPct: deltaPct ?? undefined,
});
// Children get the adult range until the lab sets its own (flagged in the settings screen).
const childRange = ([low, high]) => ({
  sex: 'ANY',
  ageMinDays: 0,
  ageMaxDays: 18 * Y - 1,
  low,
  high,
});
const choice = (code, name, choices, abnormal, normalText = choices[0]) => ({
  code,
  name,
  kind: 'CHOICE',
  choices,
  abnormal,
  ranges: [{ sex: 'ANY', text: normalText }],
});
const text = (code, name) => ({ code, name, kind: 'TEXT', ranges: [] });

export const DEFAULT_TESTS = {
  CBC: {
    department: 'HAEMATOLOGY',
    sampleType: 'WHOLE_BLOOD',
    container: 'LAVENDER',
    analyser: 'HAEM-1',
    method: 'Impedance and flow cytometry',
    analytes: [
      num('HB', 'Haemoglobin', 'g/dL', { M: [13, 17], F: [12, 15] }, 7, 20, 20),
      num('TLC', 'Total leucocyte count', '/µL', [4000, 11000], 2000, 30000, null, 0),
      num('PLT', 'Platelet count', '/µL', [150000, 410000], 50000, 1000000, 50, 0),
      num('HCT', 'Haematocrit', '%', { M: [40, 50], F: [36, 46] }, 20, 60),
      num('NEUT', 'Neutrophils', '%', [40, 80]),
      num('LYMPH', 'Lymphocytes', '%', [20, 40]),
    ],
  },
  LFT: {
    department: 'BIOCHEMISTRY',
    analyser: 'CHEM-1',
    method: 'Photometry',
    analytes: [
      num('TBIL', 'Bilirubin, total', 'mg/dL', [0.3, 1.2], null, 15),
      num('DBIL', 'Bilirubin, direct', 'mg/dL', [0, 0.3]),
      num('ALT', 'ALT (SGPT)', 'U/L', [7, 56], null, 1000, null, 0),
      num('AST', 'AST (SGOT)', 'U/L', [10, 40], null, 1000, null, 0),
      num('ALP', 'Alkaline phosphatase', 'U/L', [44, 147], null, null, null, 0),
      num('ALB', 'Albumin', 'g/dL', [3.5, 5.0], 1.5),
    ],
  },
  KFT: {
    department: 'BIOCHEMISTRY',
    analyser: 'CHEM-1',
    method: 'Photometry and ISE',
    analytes: [
      num('UREA', 'Urea', 'mg/dL', [15, 40], null, 200, 50, 0),
      num('CREAT', 'Creatinine', 'mg/dL', { M: [0.7, 1.3], F: [0.6, 1.1] }, null, 7.5, 50, 2),
      num('NA', 'Sodium', 'mmol/L', [135, 145], 120, 160, null, 0),
      num('K', 'Potassium', 'mmol/L', [3.5, 5.1], 2.8, 6.2, null, 1),
      num('CL', 'Chloride', 'mmol/L', [98, 107], null, null, null, 0),
    ],
  },
  LIPID: {
    department: 'BIOCHEMISTRY',
    analyser: 'CHEM-1',
    method: 'Enzymatic',
    analytes: [
      num('CHOL', 'Total cholesterol', 'mg/dL', [0, 200], null, null, null, 0),
      num('TG', 'Triglycerides', 'mg/dL', [0, 150], null, 1000, null, 0),
      num('HDL', 'HDL cholesterol', 'mg/dL', { M: [40, 60], F: [50, 60] }, null, null, null, 0),
      num('LDL', 'LDL cholesterol', 'mg/dL', [0, 100], null, null, null, 0),
    ],
  },
  FBS: {
    department: 'BIOCHEMISTRY',
    sampleType: 'PLASMA',
    container: 'GREY',
    analyser: 'CHEM-1',
    analytes: [num('GLU', 'Glucose, fasting', 'mg/dL', [70, 100], 40, 450, null, 0)],
  },
  PPBS: {
    department: 'BIOCHEMISTRY',
    sampleType: 'PLASMA',
    container: 'GREY',
    analyser: 'CHEM-1',
    analytes: [num('GLU', 'Glucose, post-prandial', 'mg/dL', [70, 140], 40, 450, null, 0)],
  },
  HBA1C: {
    department: 'BIOCHEMISTRY',
    sampleType: 'WHOLE_BLOOD',
    container: 'LAVENDER',
    method: 'HPLC',
    analytes: [num('A1C', 'HbA1c', '%', [4, 5.6])],
  },
  TSH: {
    department: 'BIOCHEMISTRY',
    method: 'CLIA',
    analytes: [num('TSH', 'TSH', 'µIU/mL', [0.4, 4.0], null, null, null, 2)],
  },
  TROP: {
    department: 'BIOCHEMISTRY',
    method: 'CLIA',
    analytes: [num('TNI', 'Troponin I', 'ng/mL', [0, 0.04], null, 0.4, null, 3)],
  },
  NS1: {
    department: 'SEROLOGY',
    method: 'Rapid immunochromatography',
    analytes: [choice('NS1', 'Dengue NS1 antigen', ['Negative', 'Positive'], ['Positive'])],
  },
  MPAG: {
    department: 'SEROLOGY',
    sampleType: 'WHOLE_BLOOD',
    container: 'LAVENDER',
    method: 'Rapid immunochromatography',
    analytes: [
      choice('PF', 'P. falciparum antigen', ['Negative', 'Positive'], ['Positive']),
      choice('PV', 'P. vivax antigen', ['Negative', 'Positive'], ['Positive']),
    ],
  },
  WIDAL: {
    department: 'SEROLOGY',
    method: 'Slide agglutination',
    analytes: [
      choice('TO', 'S. Typhi O', ['<1:80', '1:80', '1:160', '1:320'], ['1:160', '1:320']),
      choice('TH', 'S. Typhi H', ['<1:80', '1:80', '1:160', '1:320'], ['1:160', '1:320']),
    ],
  },
  URINE: {
    department: 'CLINICAL_PATHOLOGY',
    sampleType: 'URINE',
    container: 'URINE_CUP',
    analytes: [
      text('COLOUR', 'Colour'),
      choice('PROT', 'Protein', ['Nil', 'Trace', '1+', '2+', '3+'], ['1+', '2+', '3+']),
      choice('SUGAR', 'Sugar', ['Nil', 'Trace', '1+', '2+', '3+'], ['1+', '2+', '3+']),
      num('PUS', 'Pus cells', '/hpf', [0, 5], null, null, null, 0),
      num('RBC', 'Red cells', '/hpf', [0, 2], null, null, null, 0),
    ],
  },
  UMA: {
    department: 'BIOCHEMISTRY',
    sampleType: 'URINE',
    container: 'URINE_CUP',
    analytes: [num('UMA', 'Urine micro-albumin', 'mg/L', [0, 30], null, null, null, 0)],
  },
  VITD: {
    department: 'BIOCHEMISTRY',
    method: 'CLIA',
    tatMin: 24 * 60,
    analytes: [num('VITD', '25-OH vitamin D', 'ng/mL', [30, 100])],
  },
  B12: {
    department: 'BIOCHEMISTRY',
    method: 'CLIA',
    tatMin: 24 * 60,
    analytes: [num('B12', 'Vitamin B12', 'pg/mL', [200, 900], null, null, null, 0)],
  },
  BGRP: {
    department: 'HAEMATOLOGY',
    sampleType: 'WHOLE_BLOOD',
    container: 'LAVENDER',
    analytes: [
      choice('ABO', 'ABO group', ['A', 'B', 'AB', 'O'], []),
      choice('RH', 'Rh (D)', ['Positive', 'Negative'], []),
    ],
  },
  UCS: {
    department: 'MICROBIOLOGY',
    sampleType: 'URINE',
    container: 'STERILE_CUP',
    method: 'Culture and sensitivity (Kirby-Bauer)',
    tatMin: 72 * 60,
    analytes: [text('RESULT', 'Culture report')],
  },
  BCS: {
    department: 'MICROBIOLOGY',
    sampleType: 'BLOOD',
    container: 'BLOOD_CULTURE',
    method: 'Automated blood culture',
    tatMin: 120 * 60,
    analytes: [text('RESULT', 'Culture report')],
  },
  HPE: {
    department: 'HISTOPATHOLOGY',
    sampleType: 'TISSUE',
    container: 'FORMALIN',
    method: 'H&E',
    tatMin: 3 * 24 * 60,
    nabl: true,
    analytes: [text('RESULT', 'Diagnosis')],
  },
  HIV: {
    department: 'SEROLOGY',
    method: 'Rapid (three-test strategy)',
    sensitive: true,
    analytes: [choice('HIV', 'HIV 1 and 2 antibodies', ['Non-reactive', 'Reactive'], ['Reactive'])],
  },
};

/** A single-result definition for a lab service with no default above. */
export const genericTest = (name) => ({
  department: 'BIOCHEMISTRY',
  analytes: [text('RESULT', name)],
});

/** QC controls seeded for the demo analysers (Westgard needs a mean and SD per level). */
export const DEFAULT_CONTROLS = [
  ['HAEM-1', 'HB', 'Haemoglobin', 'L1', 8.0, 0.2, 'g/dL'],
  ['HAEM-1', 'HB', 'Haemoglobin', 'L2', 14.0, 0.3, 'g/dL'],
  ['CHEM-1', 'GLU', 'Glucose', 'L1', 90, 3, 'mg/dL'],
  ['CHEM-1', 'GLU', 'Glucose', 'L2', 250, 7, 'mg/dL'],
  ['CHEM-1', 'CREAT', 'Creatinine', 'L1', 1.0, 0.05, 'mg/dL'],
];
