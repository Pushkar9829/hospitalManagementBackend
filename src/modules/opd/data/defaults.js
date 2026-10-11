/** Starter OPD configuration for a new hospital (editable under OPD settings). */

export const DEFAULT_TOKEN_SERIES = [
  { prefix: 'T-', usedFor: 'Booked OPD', resets: 'DAILY', display: 'OPD TV' },
  { prefix: 'W-', usedFor: 'Walk-in OPD', resets: 'DAILY', display: 'OPD TV' },
  { prefix: 'B-', usedFor: 'Billing counters', resets: 'DAILY', display: 'Billing TV' },
  { prefix: 'S-', usedFor: 'Sample collection', resets: 'DAILY', display: 'Lab TV' },
  { prefix: 'P-', usedFor: 'Pharmacy', resets: 'DAILY', display: 'Pharmacy TV' },
];

export const DEFAULT_MESSAGES = [
  ['BOOKING_CONFIRMED', 'AT_BOOKING', ['SMS', 'WHATSAPP'], ['en', 'hi', 'mr'], true],
  ['REMINDER', 'BEFORE_24H_2H', ['SMS', 'WHATSAPP'], ['en', 'hi', 'mr'], true],
  ['TOKEN_NEAR', 'THREE_AWAY', ['SMS'], ['en', 'hi'], true],
  ['FOLLOW_UP_DUE', 'BEFORE_2D', ['WHATSAPP'], ['en', 'hi', 'mr'], true],
  ['FEEDBACK', 'AFTER_2H', ['WHATSAPP'], ['en'], true],
  ['DOCTOR_DELAY', 'DOCTOR_LATE_20', ['SMS'], ['en', 'hi'], false],
].map(([code, when, channels, languages, on]) => ({ code, when, channels, languages, on }));

export const DEFAULT_VISIT_TYPES = [
  ['NEW', 'New', 10, 'DOCTOR_FEE', 'STARTS_WINDOW', true, false],
  ['FOLLOW_UP', 'Follow-up', 5, 'FREE_IN_WINDOW', null, true, true],
  ['TELE', 'Tele-consult', 10, 'TELE_FEE', 'DAYS_15', true, true],
  ['VACCINATION', 'Vaccination', 5, 'FEE_PLUS_VACCINE', null, true, false],
  ['PROCEDURE', 'Procedure (minor)', 20, 'PER_PROCEDURE', null, false, false],
  ['HEALTH_CHECK', 'Health check-up', null, 'PACKAGE', null, true, false],
].map(([code, name, slotMin, fee, freeFollowUp, online, tele]) => ({
  code,
  name,
  slotMin,
  fee,
  freeFollowUp,
  online,
  tele,
}));

/** Rx rows are [drugId, dose, frequency, days, route, instructions]; orders are service codes. */
export const TEMPLATES = [
  {
    id: 'pv-t1',
    name: 'Angina follow-up',
    kind: 'RX',
    department: 'Cardiology',
    owner: 'Dr. Meera Iyer',
    usedThisMonth: 42,
    rx: [
      ['ecosprin75', '1 tab', 'OD', 30, 'Oral', 'After lunch'],
      ['amlodipine10', '1 tab', 'OD_MORNING', 30, 'Oral', 'Morning'],
      ['atorva40', '1 tab', 'HS', 30, 'Oral', 'After dinner'],
      ['sorbitrate5', '1 tab', 'SOS', 10, 'Sublingual', 'Max 3 in 15 min'],
    ],
    advice: 'Low salt diet. Walk 30 minutes daily.',
  },
  {
    id: 'pv-t2',
    name: 'Chest pain work-up',
    kind: 'ORDER_SET',
    department: 'Cardiology',
    owner: 'Department',
    usedThisMonth: 31,
    orders: ['ECG', 'TROP', 'LIPID', 'HBA1C', 'ECHO'],
  },
  {
    id: 'pv-t3',
    name: 'Fever panel',
    kind: 'ORDER_SET',
    department: 'General Medicine',
    owner: 'Department',
    usedThisMonth: 88,
    orders: ['CBC', 'NS1', 'MPAG', 'WIDAL', 'URINE'],
  },
  {
    id: 'pv-t4',
    name: 'Viral fever',
    kind: 'RX',
    department: 'General Medicine',
    owner: 'Dr. R. Menon',
    usedThisMonth: 64,
    rx: [
      ['dolo650', '1 tab', 'SOS', 5, 'Oral', 'If fever, max 4 a day'],
      ['ors', '1 sachet in 1 litre water', 'TDS', 3, 'Oral', 'Through the day'],
      ['cetzine10', '1 tab', 'HS', 5, 'Oral', 'At night'],
    ],
    advice: 'Plenty of fluids. Avoid ibuprofen and aspirin until dengue is ruled out.',
  },
  {
    id: 'pv-t5',
    name: 'Diabetes review',
    kind: 'ORDER_SET',
    department: 'General Medicine',
    owner: 'Department',
    usedThisMonth: 47,
    orders: ['FBS', 'PPBS', 'HBA1C', 'KFT', 'UMA'],
  },
  {
    id: 'pv-t6',
    name: 'Antenatal visit',
    kind: 'SPECIALTY',
    department: 'Gynaecology',
    owner: 'Department',
    usedThisMonth: 64,
    specialty: 'ANTENATAL',
  },
  {
    id: 'pv-t7',
    name: 'Well-baby visit',
    kind: 'SPECIALTY',
    department: 'Paediatrics',
    owner: 'Department',
    usedThisMonth: 57,
    specialty: 'PAEDIATRICS',
  },
];
