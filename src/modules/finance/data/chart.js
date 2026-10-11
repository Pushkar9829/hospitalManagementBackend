/**
 * The pre-loaded hospital chart of accounts: [code, name, type, group, system key]. Hospitals
 * add their own ledgers; system accounts (with a key) are what auto-posting uses.
 */
export const CHART = [
  ['1000', 'Cash in hand', 'ASSET', 'Cash and bank', 'CASH'],
  ['1005', 'Petty cash', 'ASSET', 'Cash and bank', 'PETTY_CASH'],
  ['1010', 'Bank account', 'ASSET', 'Cash and bank', 'BANK'],
  ['1020', 'Card and UPI clearing', 'ASSET', 'Cash and bank', 'CARD_CLEARING'],
  ['1100', 'Patient receivables', 'ASSET', 'Receivables', 'AR_PATIENT'],
  ['1110', 'Corporate and TPA receivables', 'ASSET', 'Receivables', 'AR_CORPORATE'],
  ['1200', 'Inventory', 'ASSET', 'Current assets', 'INVENTORY'],
  ['1210', 'GST input credit', 'ASSET', 'Current assets', 'GST_INPUT'],
  ['1220', 'Staff loans and advances', 'ASSET', 'Current assets', 'STAFF_LOANS'],
  ['1500', 'Fixed assets', 'ASSET', 'Fixed assets', 'FIXED_ASSETS'],
  ['2000', 'Sundry creditors', 'LIABILITY', 'Payables', 'AP_VENDOR'],
  ['2010', 'Patient advances (deposits)', 'LIABILITY', 'Payables', 'PATIENT_ADVANCE'],
  ['2100', 'CGST payable', 'LIABILITY', 'Duties and taxes', 'CGST_OUTPUT'],
  ['2110', 'SGST payable', 'LIABILITY', 'Duties and taxes', 'SGST_OUTPUT'],
  ['2120', 'TDS payable', 'LIABILITY', 'Duties and taxes', 'TDS_PAYABLE'],
  ['2130', 'Professional tax payable', 'LIABILITY', 'Duties and taxes', 'PT_PAYABLE'],
  ['2200', 'Salaries payable', 'LIABILITY', 'Payroll liabilities', 'SALARY_PAYABLE'],
  ['2210', 'PF payable', 'LIABILITY', 'Payroll liabilities', 'PF_PAYABLE'],
  ['2220', 'ESI payable', 'LIABILITY', 'Payroll liabilities', 'ESI_PAYABLE'],
  ['3000', 'Capital', 'EQUITY', 'Capital', 'CAPITAL'],
  ['3100', 'Retained earnings', 'EQUITY', 'Capital', 'RETAINED'],
  ['4000', 'Consultation revenue', 'INCOME', 'Revenue', 'REV_OPD'],
  ['4010', 'In-patient revenue', 'INCOME', 'Revenue', 'REV_IPD'],
  ['4020', 'Laboratory revenue', 'INCOME', 'Revenue', 'REV_LAB'],
  ['4030', 'Radiology revenue', 'INCOME', 'Revenue', 'REV_RAD'],
  ['4040', 'Pharmacy revenue', 'INCOME', 'Revenue', 'REV_PHARMACY'],
  ['4050', 'Procedure revenue', 'INCOME', 'Revenue', 'REV_PROCEDURE'],
  ['4090', 'Other operating revenue', 'INCOME', 'Revenue', 'REV_OTHER'],
  ['4900', 'Rounding off', 'INCOME', 'Other income', 'ROUND_OFF'],
  ['5000', 'Salaries and wages', 'EXPENSE', 'Staff costs', 'SALARIES'],
  ['5010', 'Employer PF and ESI', 'EXPENSE', 'Staff costs', 'EMPLOYER_STATUTORY'],
  ['5020', 'Bonus and gratuity', 'EXPENSE', 'Staff costs', 'BONUS_EXPENSE'],
  ['5100', 'Doctor fees', 'EXPENSE', 'Professional fees', 'DOCTOR_FEES'],
  ['5500', 'General expenses', 'EXPENSE', 'Operating expenses', 'GENERAL_EXPENSE'],
  ['5600', 'Membership benefits redeemed', 'EXPENSE', 'Marketing', 'MEMBER_BENEFITS'],
  ['5510', 'Electricity and water', 'EXPENSE', 'Operating expenses', null],
  ['5520', 'Repairs and maintenance', 'EXPENSE', 'Operating expenses', null],
];

/** Service category on a bill line → revenue account key (department revenue). */
export const REVENUE_BY_CATEGORY = {
  CONSULTATION: 'REV_OPD',
  REGISTRATION: 'REV_OPD',
  BED: 'REV_IPD',
  NURSING: 'REV_IPD',
  PACKAGE: 'REV_IPD',
  LAB: 'REV_LAB',
  RAD: 'REV_RAD',
  PHARMACY: 'REV_PHARMACY',
  PROCEDURE: 'REV_PROCEDURE',
};

/** Payment mode kind → the account the money lands in. */
export const MONEY_BY_MODE = {
  CASH: 'CASH',
  CARD: 'CARD_CLEARING',
  UPI: 'CARD_CLEARING',
  BANK_TRANSFER: 'BANK',
  CHEQUE: 'BANK',
  PAYMENT_LINK: 'CARD_CLEARING',
  ADVANCE: 'PATIENT_ADVANCE',
  // Membership wallet credit is promotional: its redemption is a marketing cost.
  WALLET: 'MEMBER_BENEFITS',
};
