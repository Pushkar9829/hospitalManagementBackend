import { z } from 'zod';
import { settingsDoc } from './common.js';

const int = (min, max) => z.number().int().min(min).max(max);

export const settingsInput = z.object({
  deposits: z.record(z.string().regex(/^[A-Z_]{2,20}$/), int(0, 1_00_00_000_00)).optional(),
  depositAlertPct: int(10, 100).optional(),
  topUpPct: int(50, 200).optional(),
  emergencyDepositHours: int(1, 72).optional(),
  roomRentMethod: z.enum(['MIDNIGHT', 'HOURS_24']).optional(),
  icuFullDayHours: int(1, 24).optional(),
  enhancementPct: int(50, 100).optional(),
  reservationHoldMin: int(15, 1440).optional(),
  targets: z
    .object({
      dischargeMin: int(30, 1440),
      billMin: int(10, 600),
      cleaningMin: int(10, 600),
      isolationCleaningMin: int(10, 600),
    })
    .partial()
    .optional(),
  visitingHours: z.string().trim().max(60).optional(),
});

const out = (s) => ({
  deposits: Object.fromEntries(s.deposits ?? []),
  depositAlertPct: s.depositAlertPct,
  topUpPct: s.topUpPct,
  emergencyDepositHours: s.emergencyDepositHours,
  roomRentMethod: s.roomRentMethod,
  icuFullDayHours: s.icuFullDayHours,
  enhancementPct: s.enhancementPct,
  reservationHoldMin: s.reservationHoldMin,
  targets: s.targets,
  visitingHours: s.visitingHours,
  version: s.version,
});

export async function getSettings() {
  return out(await settingsDoc());
}

export async function saveSettings(input) {
  const s = await settingsDoc();
  const { deposits, targets, ...rest } = input;
  s.set(rest);
  if (deposits) for (const [k, v] of Object.entries(deposits)) s.deposits.set(k, v);
  if (targets) s.targets = { ...s.targets.toObject(), ...targets };
  await s.save();
  return out(s);
}
