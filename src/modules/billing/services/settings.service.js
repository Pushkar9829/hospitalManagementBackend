import { errors } from '../../../core/errors/index.js';
import { BillingSettings } from '../models/billing.models.js';

export const settingsDto = (s) => ({
  shiftVarianceLimit: s.shiftVarianceLimit,
  defaultOpeningCash: s.defaultOpeningCash,
  billPaper: s.billPaper,
  receiptPaper: s.receiptPaper,
  billFooter: s.billFooter ?? '',
  version: s.version ?? 0,
});

/** The hospital's billing settings, created with the defaults on first use. */
export async function billingSettings() {
  const found = await BillingSettings.findOne();
  if (found) return found;
  try {
    const [doc] = await BillingSettings.create([{}]);
    return doc;
  } catch (e) {
    if (e?.code === 11000) return BillingSettings.findOne();
    throw e;
  }
}

export const getSettings = async () => settingsDto(await billingSettings());

export async function updateSettings({ version, ...input }) {
  const s = await billingSettings();
  if ((s.version ?? 0) !== version) throw errors.versionConflict();
  s.set(input);
  await s.save();
  return settingsDto(s);
}
