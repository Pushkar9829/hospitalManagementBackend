/** Patient master value sets (UI/UX review: negative blood groups, relation, guardian). */
export const BLOOD_GROUPS = Object.freeze([
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
  'Unknown',
]);

/** ABDM uses M / F / O / U. */
export const GENDERS = Object.freeze({
  M: 'Male',
  F: 'Female',
  O: 'Other / transgender',
  U: 'Not disclosed',
});

export const TITLES = Object.freeze(['Mr', 'Mrs', 'Ms', 'Master', 'Baby', 'Baby of', 'Dr', 'Prof']);

/** Indian registration convention: S/o, D/o, W/o, C/o. */
export const RELATIONS = Object.freeze({
  SO: 'Son of',
  DO: 'Daughter of',
  WO: 'Wife of',
  HO: 'Husband of',
  CO: 'Care of',
  GUARDIAN: 'Guardian',
});

export const LANGUAGES = Object.freeze({
  en: 'English',
  hi: 'हिन्दी',
  mr: 'मराठी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  kn: 'ಕನ್ನಡ',
  bn: 'বাংলা',
  gu: 'ગુજરાતી',
  ml: 'മലയാളം',
});
