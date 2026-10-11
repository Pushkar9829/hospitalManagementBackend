import { z } from 'zod';
import { recordAudit } from '../../../core/audit/audit.service.js';
import { User } from '../../../core/auth/models/user.model.js';
import { Role } from '../../../core/auth/models/role.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { SMS_TEMPLATES } from '../../../core/notify/templates.js';
import { current } from '../../../core/tenancy/context.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { tenantRegistry } from '../../../core/tenancy/tenant.registry.js';
import { HospitalSettings } from '../models/settings.model.js';
import { Service } from '../models/masters.models.js';

/** The settings document, created with the hospital's name on first save. */
async function doc() {
  const found = await HospitalSettings.findOne({ key: 'hospital' });
  return found ?? new HospitalSettings({ key: 'hospital', displayName: current().tenant.name });
}
const checkVersion = (d, version) => {
  if (!d.isNew && d.version !== version) throw errors.versionConflict();
};

// ---------------------------------------------------------------- print

const printOut = (d) => ({
  paperSize: d.print?.paperSize ?? 'A4',
  showLogo: d.print?.showLogo !== false,
  headerNote: d.print?.headerNote ?? '',
  footerNote: d.print?.footerNote ?? '',
  signatory: d.print?.signatory ?? '',
  version: d.version ?? 0,
});

export async function getPrint() {
  return printOut(await doc());
}

export const printInput = z.object({
  version: z.number().int().min(0),
  paperSize: z.enum(['A4', 'A5']),
  showLogo: z.boolean(),
  headerNote: z.string().trim().max(200).optional(),
  footerNote: z.string().trim().max(300).optional(),
  signatory: z.string().trim().max(80).optional(),
});

export async function savePrint({ version, ...print }) {
  const d = await doc();
  checkVersion(d, version);
  d.print = print;
  await d.save();
  return printOut(d);
}

/** Print defaults for document builders (letterhead lines, paper); safe outside a request. */
export async function printDefaults() {
  try {
    const d = await HospitalSettings.findOne({ key: 'hospital' }).select('print').lean();
    return printOut(d ?? {});
  } catch {
    return printOut({});
  }
}

// ---------------------------------------------------------------- message templates

const placeholders = (text) => [...new Set((text ?? '').match(/\{\w+\}/g) ?? [])].sort();

/** Every message the system sends, with the hospital's wording where it has changed it. */
export async function listMessages() {
  const d = await doc();
  const custom = d.messages ?? new Map();
  return {
    version: d.version ?? 0,
    items: Object.entries(SMS_TEMPLATES).map(([code, t]) => {
      const o = custom.get?.(code) ?? custom[code];
      return {
        code,
        placeholders: placeholders(t.text.en),
        defaults: { en: t.text.en, hi: t.text.hi ?? '' },
        en: o?.en ?? t.text.en,
        hi: o?.hi ?? t.text.hi ?? '',
        dltId: o?.dltId ?? t.dltId ?? '',
        enabled: o?.enabled !== false,
        customised: Boolean(o?.en || o?.hi),
      };
    }),
  };
}

export const messageInput = z.object({
  version: z.number().int().min(0),
  en: z.string().trim().min(5).max(480),
  hi: z.string().trim().max(480).optional(),
  dltId: z.string().trim().max(30).optional(),
  enabled: z.boolean().default(true),
});

/**
 * Saves a template's wording. The placeholders must stay the same (the system fills them), and
 * login and reset codes cannot be switched off.
 */
export async function saveMessage(code, input) {
  const t = SMS_TEMPLATES[code];
  if (!t) throw errors.notFound('Message template');
  const want = placeholders(t.text.en).join(',');
  for (const lang of ['en', 'hi'])
    if (input[lang] && placeholders(input[lang]).join(',') !== want)
      throw errors.validation([
        {
          path: lang,
          message: `Keep exactly these placeholders: ${placeholders(t.text.en).join(' ')}`,
        },
      ]);
  if (!input.enabled && /OTP|RESET|INVITE/.test(code))
    throw new AppError(
      422,
      'REQUIRED_MESSAGE',
      'Sign-in, invite and reset messages cannot be turned off.',
    );
  const d = await doc();
  checkVersion(d, input.version);
  d.messages ??= new Map();
  d.messages.set(code, { en: input.en, hi: input.hi, dltId: input.dltId, enabled: input.enabled });
  await d.save();
  return (await listMessages()).items.find((m) => m.code === code);
}

export async function resetMessage(code, { version }) {
  if (!SMS_TEMPLATES[code]) throw errors.notFound('Message template');
  const d = await doc();
  checkVersion(d, version);
  d.messages?.delete(code);
  await d.save();
  return (await listMessages()).items.find((m) => m.code === code);
}

/** The hospital's wording of a template, for the SMS sender (null when it uses the default). */
export async function messageOverride(code) {
  try {
    const d = await HospitalSettings.findOne({ key: 'hospital' }).select('messages').lean();
    const o = d?.messages?.[code];
    return o ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- integrations

const INTEGRATIONS = ['sms', 'whatsapp', 'email', 'payments', 'gst', 'abdm', 'lis', 'pacs'];

const integrationsOut = (d) => {
  const i = d.integrations ?? {};
  const plain = (x) => (x?.toObject ? x.toObject() : (x ?? {}));
  const items = INTEGRATIONS.map((key) => {
    const cfg = plain(i[key]);
    const configured =
      key === 'whatsapp' || key === 'abdm' || key === 'lis' || key === 'pacs'
        ? Boolean(cfg.enabled)
        : Object.values(cfg).some((v) => typeof v === 'string' && v.trim());
    return { key, config: cfg, configured };
  });
  return { version: d.version ?? 0, items };
};

export async function getIntegrations() {
  return integrationsOut(await doc());
}

const text = (n) => z.string().trim().max(n).optional();
export const integrationInput = z.object({
  version: z.number().int().min(0),
  key: z.enum(INTEGRATIONS),
  config: z
    .object({
      provider: text(40),
      senderId: z
        .string()
        .trim()
        .regex(/^[A-Z]{6}$/, 'Sender ID is six capital letters')
        .optional()
        .or(z.literal('')),
      enabled: z.boolean().optional(),
      number: text(15),
      from: z.email().optional().or(z.literal('')),
      gateway: text(40),
      merchantId: text(60),
      gstin: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN')
        .optional()
        .or(z.literal('')),
      hipId: text(60),
      host: text(120),
      aeTitle: text(16),
    })
    .strict(),
});

/** Saves one integration's settings; secrets (API keys) are entered at go-live, never here. */
export async function saveIntegration({ version, key, config }) {
  const d = await doc();
  checkVersion(d, version);
  d.integrations ??= {};
  d.set(`integrations.${key}`, config);
  await d.save();
  return integrationsOut(d);
}

// ---------------------------------------------------------------- security

const PRIVILEGED = ['superadmin', 'admin', 'billingmgr', 'accounts', 'payroll', 'hr'];

/** Who must use two-factor sign-in, the idle sign-out and the password rules. */
export async function getSecurity() {
  const { tenantId } = current();
  const [t, roles] = await Promise.all([
    Tenant.findById(tenantId).select('settings').lean(),
    Role.find({}).select('code name').sort({ name: 1 }).lean(),
  ]);
  const twoFactor = await User.countDocuments({ 'twoFactor.enabled': true }).catch(() => 0);
  return {
    twoFactorRoles: t?.settings?.twoFactorRoles ?? [],
    idleTimeoutMin: t?.settings?.idleTimeoutMin ?? 15,
    roles: roles.map((r) => ({
      code: r.code,
      name: r.name,
      privileged: PRIVILEGED.includes(r.code),
    })),
    usersWithTwoFactor: twoFactor,
    passwordRules: { minLength: 10, needs: ['UPPER', 'LOWER', 'DIGIT'] },
  };
}

export const securityInput = z.object({
  twoFactorRoles: z.array(z.string().trim().min(2).max(40)).max(50),
  idleTimeoutMin: z.number().int().min(5).max(120),
});

/** Super Admin must always use two-factor sign-in; it cannot be removed from the list. */
export async function saveSecurity(input) {
  const { tenantId } = current();
  const roles = [...new Set(['superadmin', ...input.twoFactorRoles])];
  return withTransaction(async () => {
    const t = await Tenant.findByIdAndUpdate(
      tenantId,
      {
        $set: { 'settings.twoFactorRoles': roles, 'settings.idleTimeoutMin': input.idleTimeoutMin },
      },
      { new: true },
    );
    await tenantRegistry.invalidate(t);
    return getSecurity();
  });
}

// ---------------------------------------------------------------- data export

export const DATASETS = ['patients', 'bills', 'services', 'users'];
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (columns, rows) =>
  [columns.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
const ymd = (d) =>
  d ? new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10) : '';
const rupees = (p) => ((p ?? 0) / 100).toFixed(2);
const MAX_ROWS = 50_000;

/**
 * A CSV of the hospital's own data. Patient exports carry personal data: the route audits every
 * export, and the file is built here, never stored.
 */
export async function exportData({ dataset, from, to }) {
  const range = {};
  if (from) range.$gte = new Date(`${from}T00:00:00+05:30`);
  if (to) range.$lte = new Date(`${to}T23:59:59.999+05:30`);
  const dated = Object.keys(range).length ? { createdAt: range } : {};
  let columns;
  let rows;
  if (dataset === 'patients') {
    const { Patient } = await import('../../patients/index.js');
    const list = await Patient.find(dated).sort({ createdAt: 1 }).limit(MAX_ROWS).lean();
    columns = ['UHID', 'Name', 'Gender', 'Date of birth', 'Mobile', 'City', 'Registered on'];
    rows = list.map((p) => [
      p.uhid,
      [p.name?.title, p.name?.first, p.name?.middle, p.name?.last].filter(Boolean).join(' '),
      p.gender,
      ymd(p.dob),
      p.mobile,
      p.address?.city ?? '',
      ymd(p.createdAt),
    ]);
  } else if (dataset === 'bills') {
    const { Bill } = await import('../../billing/index.js');
    const list = await Bill.find({ ...dated, status: { $ne: 'DRAFT' } })
      .sort({ createdAt: 1 })
      .limit(MAX_ROWS)
      .lean();
    columns = [
      'Bill',
      'Date',
      'Type',
      'UHID',
      'Patient',
      'Payer',
      'Total',
      'Paid',
      'Balance',
      'Status',
    ];
    rows = list.map((b) => [
      b.billNo,
      ymd(b.finalizedAt ?? b.createdAt),
      b.type,
      b.patient?.uhid ?? '',
      b.patient?.name ?? '',
      b.payer?.name ?? b.payer?.kind ?? '',
      rupees(b.totals?.total),
      rupees(b.totals?.paid),
      rupees(b.totals?.balance),
      b.status,
    ]);
  } else if (dataset === 'services') {
    const list = await Service.find({}).sort({ code: 1 }).limit(MAX_ROWS).lean();
    columns = ['Code', 'Name', 'Category', 'Active'];
    rows = list.map((s) => [s.code, s.name, s.category, s.isActive === false ? 'No' : 'Yes']);
  } else {
    const list = await User.find({})
      .select('name username status roles lastLoginAt')
      .limit(MAX_ROWS)
      .lean();
    const roles = new Map(
      (await Role.find({}).select('name').lean()).map((r) => [String(r._id), r.name]),
    );
    columns = ['Name', 'Username', 'Roles', 'Status', 'Last sign-in'];
    rows = list.map((u) => [
      u.name,
      u.username,
      (u.roles ?? [])
        .map((r) => roles.get(String(r)) ?? '')
        .filter(Boolean)
        .join('; '),
      u.status,
      ymd(u.lastLoginAt),
    ]);
  }
  await recordAudit({
    action: 'EXPORT',
    entity: 'DataExport',
    entityId: dataset,
    summary: `Exported ${rows.length} ${dataset}${from || to ? ` (${from ?? '…'} to ${to ?? '…'})` : ''}`,
    after: { dataset, from, to, count: rows.length },
  });
  const stamp = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return {
    dataset,
    filename: `${dataset}-${stamp}.csv`,
    count: rows.length,
    truncated: rows.length >= MAX_ROWS,
    csv: toCsv(columns, rows),
  };
}
