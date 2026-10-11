/**
 * Default study definitions matched to billing services by code, and default rooms. Templates are
 * normal-report macros the radiologist edits; confirm with the department before go-live.
 */
export const DEFAULT_STUDIES = {
  CXR: {
    modality: 'XRAY',
    slotMin: 10,
    template:
      'Findings: Both lung fields are clear. Cardiac size is within normal limits. Both costophrenic angles are clear. Bony thorax is normal.\nImpression: No significant abnormality.',
  },
  USGA: {
    modality: 'USG',
    slotMin: 20,
    prep: 'Fast for 6 hours; drink 4 to 5 glasses of water an hour before and do not pass urine.',
    template:
      'Findings: Liver is normal in size and echotexture. Gall bladder is well distended with no calculi. CBD is not dilated. Pancreas, spleen and both kidneys are normal. Urinary bladder is normal.\nImpression: Normal ultrasound abdomen.',
  },
  USGOB: {
    modality: 'USG',
    slotMin: 30,
    pcpndt: true,
    prep: 'Drink water an hour before and do not pass urine. Bring earlier scan reports.',
    template:
      'Findings: Single live intrauterine gestation. Cardiac activity present. Placenta is normally sited. Liquor is adequate.\nImpression: Single live intrauterine pregnancy of __ weeks __ days.',
  },
  ECHO: {
    modality: 'ECHO',
    slotMin: 30,
    template:
      'Findings: Normal chamber dimensions. No regional wall motion abnormality. LVEF 60%. Valves are normal. No pericardial effusion.\nImpression: Normal 2D echocardiography.',
  },
  MRIK: {
    modality: 'MRI',
    slotMin: 45,
    prep: 'Remove all metal. Tell the staff about a pacemaker, implants or claustrophobia.',
    template:
      'Findings: Menisci, cruciate and collateral ligaments are intact. No joint effusion. Articular cartilage is preserved.\nImpression: No significant internal derangement.',
  },
  MRILS: {
    modality: 'MRI',
    slotMin: 45,
    prep: 'Remove all metal. Tell the staff about a pacemaker, implants or claustrophobia.',
    template:
      'Findings: Normal lumbar lordosis. Vertebral bodies are normal in height and signal. Intervertebral discs show normal signal. No canal or foraminal narrowing.\nImpression: Normal MRI lumbar spine.',
  },
  CTHC: {
    modality: 'CT',
    slotMin: 20,
    contrast: true,
    prep: 'Fast for 4 hours. Bring a recent serum creatinine report.',
    template:
      'Findings: No focal parenchymal lesion. No abnormal enhancement. Ventricles and sulci are normal. No midline shift.\nImpression: Normal contrast CT of the head.',
  },
};

export const DEFAULT_ROOMS = [
  { code: 'XR1', name: 'X-ray room 1', modality: 'XRAY', slotMin: 10 },
  { code: 'US1', name: 'Ultrasound 1', modality: 'USG', slotMin: 20 },
  { code: 'CT1', name: 'CT scanner', modality: 'CT', slotMin: 20 },
  { code: 'MR1', name: 'MRI 1.5T', modality: 'MRI', slotMin: 45 },
  { code: 'EC1', name: 'Echo lab', modality: 'ECHO', slotMin: 30 },
];

/** Modality guessed from the service name when no default exists. */
export function guessModality(name = '') {
  const n = name.toLowerCase();
  if (/mri/.test(n)) return 'MRI';
  if (/\bct\b|computed/.test(n)) return 'CT';
  if (/ultra|usg|sono|doppler/.test(n)) return 'USG';
  if (/echo/.test(n)) return 'ECHO';
  if (/mammo/.test(n)) return 'MAMMO';
  return 'XRAY';
}
