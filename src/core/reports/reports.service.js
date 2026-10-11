import ExcelJS from 'exceljs';
import { z } from 'zod';
import { hasPermission } from '@hms/shared';
import { User } from '../auth/models/user.model.js';
import { AppError, errors } from '../errors/index.js';
import { downloadUrl, registerFilePurpose, storeGenerated } from '../files/files.service.js';
import { renderPdf } from '../print/engine.js';
import { current, runInContext } from '../tenancy/context.js';
import { Tenant } from '../tenancy/tenant.model.js';
import { GROUP_ORDER, allReports, allTiles, reportByCode } from './registry.js';
import { ReportExport, ReportSchedule } from './report.models.js';

const DAY = 86_400_000;
const MAX_EXPORT_ROWS = 50_000;
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

registerFilePurpose('report-export', {
  mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf'],
  maxBytes: 50 * 1024 * 1024,
  write: '*',
  read: 'authenticated', // the export record checks who may download
});

async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

const can = (key) => hasPermission([...current().permissions], key);
const subscribed = (module) => module === 'CORE' || current().modules.has(module);
const visible = (def) => subscribed(def.module) && can(def.permission);

/** The reports the user may run, by group. */
export function catalogue() {
  const groups = new Map();
  for (const r of allReports().filter(visible)) {
    const g = groups.get(r.group) ?? { code: r.group, name: r.group, reports: [] };
    g.reports.push({
      code: r.code,
      name: r.name,
      permission: r.permission,
      description: r.description,
    });
    groups.set(r.group, g);
  }
  return {
    groups: [...groups.values()].sort(
      (a, b) => GROUP_ORDER.indexOf(a.code) - GROUP_ORDER.indexOf(b.code),
    ),
  };
}

function findReport(code) {
  const def = reportByCode(code);
  if (!def || !subscribed(def.module)) throw errors.notFound('Report');
  if (!can(def.permission))
    throw new AppError(403, 'FORBIDDEN', `You need the permission ${def.permission}`);
  return def;
}

const flat = (v) => (v && typeof v === 'object' && 'label' in v ? v.label : v);

/** Runs a report for a period and filters; rows are searched and paged after the run. */
export async function run(code, query = {}, { all = false } = {}) {
  const def = findReport(code);
  const from = query.from ?? todayIST();
  const to = query.to ?? from;
  if (to < from) throw errors.validation([{ path: 'to', message: 'The end is before the start' }]);
  if ((new Date(to) - new Date(from)) / DAY > 366)
    throw errors.validation([{ path: 'from', message: 'At most one year at a time' }]);
  const filterValues = Object.fromEntries(
    def.filters.filter((f) => query[f.key]).map((f) => [f.key, query[f.key]]),
  );
  const out = await def.run({ from, to, filters: filterValues, branchId: query.branchId });
  let items = out.items ?? [];
  if (query.q) {
    const q = String(query.q).toLowerCase();
    items = items.filter((r) =>
      Object.values(r).some((v) =>
        String(flat(v) ?? '')
          .toLowerCase()
          .includes(q),
      ),
    );
  }
  const page = Number(query.page ?? 1);
  const limit = all ? MAX_EXPORT_ROWS : Number(query.limit ?? 50);
  const filters = [];
  for (const f of def.filters) {
    const options = typeof f.options === 'function' ? await f.options() : (f.options ?? []);
    filters.push({
      key: f.key,
      label: f.label,
      options: options.map((o) => (typeof o === 'object' ? o : { value: o, label: o })),
    });
  }
  return {
    code: def.code,
    name: def.name,
    group: def.group,
    description: def.description,
    period: { from, to },
    filters,
    kpis: (out.kpis ?? []).map(([key, label, value, kind, note]) => ({
      key,
      label,
      value,
      kind,
      note: note ?? null,
    })),
    columns: def.columns.map(([key, label, kind]) => ({ key, label, kind })),
    items: items.slice((page - 1) * limit, page * limit),
    total: items.length,
    page,
    limit,
    generatedAt: new Date().toISOString(),
  };
}

/** Management dashboard: today's tiles the user may see, by group (a failing tile is skipped). */
export async function dashboard() {
  const visibleTiles = allTiles().filter(visible);
  const out = await Promise.all(
    visibleTiles.map(async (t) => {
      try {
        const r = await t.run();
        return {
          key: t.key,
          label: t.label,
          group: t.group,
          kind: t.kind,
          value: r.value ?? null,
          note: r.note ?? null,
          tone: r.tone ?? null,
          report: t.report ?? null,
        };
      } catch {
        return null;
      }
    }),
  );
  const groups = new Map();
  for (const x of out.filter(Boolean)) groups.set(x.group, [...(groups.get(x.group) ?? []), x]);
  return {
    at: new Date().toISOString(),
    groups: [...groups.entries()]
      .sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))
      .map(([name, items]) => ({ name, items })),
  };
}

// ---------------------------------------------------------------- exports

const cellValue = (kind, v) => {
  if (v == null) return '';
  if (kind === 'money') return Math.round(v) / 100;
  if (kind === 'status') return v.label ?? '';
  if (kind === 'date' || kind === 'datetime') return new Date(v);
  return flat(v);
};

async function xlsx(result, hospital) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HMS';
  const ws = wb.addWorksheet(result.name.slice(0, 31));
  ws.addRow([hospital]);
  ws.addRow([result.name, `${result.period.from} to ${result.period.to}`]);
  for (const k of result.kpis) ws.addRow([k.label, cellValue(k.kind, k.value)]);
  ws.addRow([]);
  const header = ws.addRow(result.columns.map((c) => c.label));
  header.font = { bold: true };
  for (const r of result.items) ws.addRow(result.columns.map((c) => cellValue(c.kind, r[c.key])));
  result.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(40, Math.max(12, c.label.length + 4));
    if (c.kind === 'money') col.numFmt = '#,##,##0.00';
    if (c.kind === 'date') col.numFmt = 'dd-mmm-yyyy';
    if (c.kind === 'datetime') col.numFmt = 'dd-mmm-yyyy hh:mm';
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const pdfText = (kind, v) => {
  const x = cellValue(kind, v);
  if (x instanceof Date) return x.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  if (kind === 'money')
    return x === '' ? '' : x.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  return String(x);
};

function pdf(result, hospital) {
  const cols = result.columns;
  return renderPdf({
    pageOrientation: cols.length > 6 ? 'landscape' : 'portrait',
    pageSize: 'A4',
    content: [
      { text: hospital, bold: true, fontSize: 12 },
      {
        text: `${result.name} · ${result.period.from} to ${result.period.to}`,
        margin: [0, 2, 0, 8],
      },
      ...result.kpis.map((k) => ({ text: `${k.label}: ${pdfText(k.kind, k.value)}` })),
      {
        margin: [0, 8, 0, 0],
        table: {
          headerRows: 1,
          widths: cols.map(() => '*'),
          body: [
            cols.map((c) => ({ text: c.label, bold: true })),
            ...result.items.map((r) => cols.map((c) => pdfText(c.kind, r[c.key]))),
          ],
        },
        layout: 'lightHorizontalLines',
        fontSize: 8,
      },
    ],
  });
}

export const exportInput = z.object({
  format: z.enum(['XLSX', 'PDF']),
  filters: z.record(z.string(), z.string()).default({}),
});

const exportOut = (e) => ({
  id: String(e._id),
  reportCode: e.reportCode,
  reportName: e.reportName,
  filtersLabel: e.filtersLabel,
  format: e.format,
  rows: e.rows ?? null,
  requestedAt: e.requestedAt,
  requestedBy: e.requestedBy,
  status: e.status,
  readyAt: e.readyAt ?? null,
  expiresAt: e.expiresAt ?? null,
  error: e.error ?? null,
});

/** Builds the file now (reports are bounded to a year and 50,000 rows). */
export async function exportReport(code, { format, filters }, { scheduleId } = {}) {
  const def = findReport(code);
  const c = current();
  const [e] = await ReportExport.create([
    {
      reportCode: code,
      reportName: def.name,
      format,
      filters,
      filtersLabel: [
        filters.from && filters.to ? `${filters.from} to ${filters.to}` : todayIST(),
        ...Object.entries(filters)
          .filter(([k]) => !['from', 'to'].includes(k))
          .map(([, v]) => v),
      ].join(' · '),
      requestedBy: await userName(),
      requestedById: c.userId,
      scheduleId,
    },
  ]);
  try {
    const result = await run(code, filters, { all: true });
    const hospital = (await Tenant.findById(c.tenantId).select('name').lean())?.name ?? '';
    const body = format === 'XLSX' ? await xlsx(result, hospital) : await pdf(result, hospital);
    const file = await storeGenerated({
      purpose: 'report-export',
      name: `${code}-${result.period.from}.${format === 'XLSX' ? 'xlsx' : 'pdf'}`,
      mime:
        format === 'XLSX'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
      ext: format === 'XLSX' ? 'xlsx' : 'pdf',
      body,
      ownerEntity: 'ReportExport',
      ownerId: e._id,
    });
    e.fileId = file._id;
    e.rows = result.total;
    e.status = 'READY';
    e.readyAt = new Date();
    e.expiresAt = new Date(Date.now() + 7 * DAY);
  } catch (err) {
    e.status = 'FAILED';
    e.error = err.message?.slice(0, 300);
  }
  await e.save();
  return exportOut(e.toObject());
}

const mine = () => (can('*') ? {} : { requestedById: current().userId });

export async function listExports({ page = 1, limit = 20 } = {}) {
  const filter = mine();
  const [rows, total] = await Promise.all([
    ReportExport.find(filter)
      .sort({ requestedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ReportExport.countDocuments(filter),
  ]);
  return { items: rows.map(exportOut), total, page, limit };
}

export async function downloadExport(id) {
  const e = await ReportExport.findOne({ _id: id, ...mine() }).lean();
  if (!e || e.status !== 'READY') throw errors.notFound('Export');
  if (e.expiresAt && e.expiresAt < new Date())
    throw new AppError(410, 'EXPIRED', 'This export has expired. Run it again.');
  const { url } = await downloadUrl(e.fileId);
  return { url, filename: `${e.reportCode}.${e.format === 'XLSX' ? 'xlsx' : 'pdf'}` };
}

// ---------------------------------------------------------------- schedules

export const scheduleInput = z.object({
  reportCode: z.string().trim().max(60),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  recipients: z.array(z.email()).max(10).default([]),
  format: z.enum(['XLSX', 'PDF']).default('XLSX'),
});

/** The next run time after `now` (IST wall clock). */
export function nextRun(s, now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const [h, m] = s.time.split(':').map(Number);
  const at = (y, mo, d) => new Date(Date.UTC(y, mo, d, h, m) - 330 * 60_000);
  let y = ist.getUTCFullYear();
  let mo = ist.getUTCMonth();
  let d = ist.getUTCDate();
  for (let i = 0; i < 400; i += 1) {
    const cand = at(y, mo, d);
    const dow = new Date(Date.UTC(y, mo, d)).getUTCDay();
    const fits =
      s.frequency === 'DAILY' ||
      (s.frequency === 'WEEKLY' && dow === (s.dayOfWeek ?? 1)) ||
      (s.frequency === 'MONTHLY' && d === (s.dayOfMonth ?? 1));
    if (fits && cand > now) return cand;
    const next = new Date(Date.UTC(y, mo, d + 1));
    y = next.getUTCFullYear();
    mo = next.getUTCMonth();
    d = next.getUTCDate();
  }
  return null;
}

const scheduleOut = (s) => ({
  id: String(s._id),
  reportCode: s.reportCode,
  reportName: s.reportName,
  frequency: s.frequency,
  time: s.time,
  dayOfWeek: s.dayOfWeek ?? null,
  dayOfMonth: s.dayOfMonth ?? null,
  recipients: s.recipients,
  format: s.format,
  active: s.active,
  nextRunAt: s.nextRunAt ?? null,
  lastRunAt: s.lastRunAt ?? null,
  createdBy: s.createdByName ?? null,
});

export async function listSchedules() {
  const rows = await ReportSchedule.find(can('*') ? {} : { createdById: current().userId })
    .sort({ createdAt: -1 })
    .lean();
  return { items: rows.map(scheduleOut), total: rows.length, page: 1, limit: rows.length };
}

export async function createSchedule(input) {
  const def = findReport(input.reportCode);
  const c = current();
  const s = new ReportSchedule({
    ...input,
    reportName: def.name,
    createdByName: await userName(),
    createdById: c.userId,
    permissions: [...c.permissions],
  });
  s.nextRunAt = nextRun(s);
  await s.save();
  return scheduleOut(s.toObject());
}

export async function setScheduleActive(id, { active }) {
  const s = await ReportSchedule.findOne({
    _id: id,
    ...(can('*') ? {} : { createdById: current().userId }),
  });
  if (!s) throw errors.notFound('Schedule');
  s.active = active;
  if (active) s.nextRunAt = nextRun(s);
  await s.save();
  return scheduleOut(s.toObject());
}

export async function deleteSchedule(id) {
  const r = await ReportSchedule.deleteOne({
    _id: id,
    ...(can('*') ? {} : { createdById: current().userId }),
  });
  if (!r.deletedCount) throw errors.notFound('Schedule');
}

/** Period a scheduled run covers: yesterday (daily), the last 7 days, or last month. */
function periodFor(frequency, now) {
  const ymd = (ms) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
  const t = now.getTime();
  if (frequency === 'DAILY') return { from: ymd(t - DAY), to: ymd(t - DAY) };
  if (frequency === 'WEEKLY') return { from: ymd(t - 7 * DAY), to: ymd(t - DAY) };
  const ist = new Date(t + 330 * 60_000);
  const first = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * Worker job (inside one hospital's context): runs every schedule that is due with the
 * permissions its creator had, so a schedule never shows more than its owner could see.
 * E-mail delivery to the recipients needs a mail service; the export appears in Exports.
 */
export async function runDueSchedules(now = new Date()) {
  const due = await ReportSchedule.find({ active: true, nextRunAt: { $lte: now } });
  let n = 0;
  for (const s of due) {
    const c = current();
    await runInContext(
      {
        ...c,
        userId: s.createdById ? String(s.createdById) : undefined,
        userName: `Schedule · ${s.createdByName ?? ''}`,
        permissions: new Set(s.permissions ?? []),
      },
      () =>
        exportReport(
          s.reportCode,
          { format: s.format, filters: periodFor(s.frequency, now) },
          { scheduleId: s._id },
        ),
    ).catch(() => null);
    s.lastRunAt = now;
    s.nextRunAt = nextRun(s, now);
    await s.save();
    n += 1;
  }
  return n;
}
