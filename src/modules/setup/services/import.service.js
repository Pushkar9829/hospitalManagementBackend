import ExcelJS from 'exceljs';
import { MASTERS } from '@hms/shared/schemas';
import { AppError, errors } from '../../../core/errors/index.js';
import { withTransaction } from '../../../core/db/model.js';
import { readFileContent } from '../../../core/files/files.service.js';
import { recordAudit } from '../../../core/audit/audit.service.js';
import { PriceList } from '../models/masters.models.js';
import { requestTariffApproval, resolveRows, toDto, typeOf } from './masters.service.js';

const MAX_ROWS = 5000;
/** Excel saves CSV with a byte-order mark; strip it so the first header matches. */
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if (v.text) return v.text;
  }
  return v;
}

async function readTable(buffer, mime) {
  if (mime === 'text/csv') return parseCsv(buffer.toString('utf8').replace(BOM, ''));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => rows.push(r.values.slice(1).map(cellValue)));
  return rows;
}

const BOOL = {
  yes: true,
  y: true,
  true: true,
  1: true,
  no: false,
  n: false,
  false: false,
  0: false,
  '': false,
};

/** Header row -> field names; "Rate GENERAL" style headers fill the rates map. */
function mapRow(type, headers, cells) {
  const { columns } = MASTERS[type];
  const out = {};
  headers.forEach((h, i) => {
    const raw = cells[i];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    const rate = /^rate\s+(.+)$/i.exec(h);
    if (rate && columns['Rate *']) {
      if (value !== '' && value != null) (out.rates ??= {})[rate[1].trim().toUpperCase()] = value;
      return;
    }
    const field = columns[h];
    if (!field || value === '' || value == null) return;
    if (['isDefault', 'requiresReference'].includes(field))
      out[field] = BOOL[String(value).toLowerCase()] ?? value;
    else if (['branchCodes', 'includes', 'excludes'].includes(field))
      out[field] = String(value)
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    else out[field] = value;
  });
  if (columns['Rate *']) out.rates ??= {};
  return out;
}

/**
 * Validates an uploaded sheet row by row. Every row is NEW, UPDATE (same code exists) or ERROR;
 * nothing is saved.
 */
export async function previewImport(type, fileId) {
  const t = typeOf(type);
  const { file, buffer } = await readFileContent(fileId, { purpose: 'master-import' });
  const table = await readTable(buffer, file.mime);
  if (table.length < 2)
    throw errors.validation([
      { path: 'file', message: 'The sheet needs a header row and at least one data row' },
    ]);
  if (table.length - 1 > MAX_ROWS)
    throw errors.validation([
      { path: 'file', message: `Import at most ${MAX_ROWS} rows at a time` },
    ]);
  const headers = table[0].map((h) => String(h).trim());
  const known = Object.keys(MASTERS[type].columns).filter((c) => c !== 'Rate *');
  const missing = known.filter((c) => ['Code', 'Name'].includes(c) && !headers.includes(c));
  if (missing.length)
    throw errors.validation([{ path: 'file', message: `Missing columns: ${missing.join(', ')}` }]);

  const rows = table
    .slice(1)
    .map((cells, i) => ({ row: i + 2, input: mapRow(type, headers, cells) }));
  const parsed = rows.map((r) => ({ ...r, result: MASTERS[type].input.safeParse(r.input) }));
  const valid = parsed.filter((r) => r.result.success);
  const resolved = await resolveRows(
    type,
    valid.map((r) => r.result.data),
  );
  valid.forEach((r, i) => (r.resolved = resolved[i]));

  const existing = new Map(
    (await t.model.find({ code: { $in: valid.map((r) => r.result.data.code) } }).lean()).map(
      (d) => [d.code, d],
    ),
  );
  const seen = new Map();
  const out = parsed.map((r) => {
    if (!r.result.success) {
      return {
        row: r.row,
        status: 'ERROR',
        code: r.input.code,
        errors: r.result.error.issues.map((x) => ({ path: x.path.join('.'), message: x.message })),
      };
    }
    const code = r.result.data.code;
    if (seen.has(code))
      return {
        row: r.row,
        status: 'ERROR',
        code,
        errors: [{ path: 'code', message: `Same code as row ${seen.get(code)}` }],
      };
    seen.set(code, r.row);
    if (r.resolved.error) return { row: r.row, status: 'ERROR', code, errors: [r.resolved.error] };
    return {
      row: r.row,
      status: existing.has(code) ? 'UPDATE' : 'NEW',
      code,
      name: r.result.data.name,
      doc: r.resolved.doc,
    };
  });
  const count = (s) => out.filter((r) => r.status === s).length;
  return {
    fileId,
    type,
    summary: {
      rows: out.length,
      new: count('NEW'),
      update: count('UPDATE'),
      error: count('ERROR'),
    },
    rows: out,
  };
}

/**
 * Saves a previewed sheet: all rows or none. Service tariffs are saved pending and sent for
 * approval as one request.
 */
export async function commitImport(type, fileId, { reason } = {}) {
  const t = typeOf(type);
  const preview = await previewImport(type, fileId);
  if (preview.summary.error) {
    throw new AppError(
      422,
      'IMPORT_HAS_ERRORS',
      `Fix ${preview.summary.error} row(s) and upload again`,
      preview.rows
        .filter((r) => r.status === 'ERROR')
        .flatMap((r) =>
          r.errors.map((e) => ({ path: `row ${r.row}.${e.path}`, message: e.message })),
        ),
    );
  }
  return withTransaction(async () => {
    const saved = [];
    for (const r of preview.rows) {
      let doc = await t.model.findOne({ code: r.code });
      if (type === 'services') {
        const { rates, ...rest } = r.doc;
        if (!doc)
          doc = new t.model({ ...rest, rates, status: 'PENDING_APPROVAL', isActive: false });
        else {
          doc.set(rest);
          if (doc.status === 'ACTIVE') doc.pendingRates = rates;
          else doc.set({ rates, status: 'PENDING_APPROVAL', isActive: false });
        }
      } else if (!doc) doc = new t.model(r.doc);
      else doc.set(r.doc);
      await doc.save();
      saved.push(doc);
    }
    if (type === 'price-lists') {
      const defaults = saved.filter((d) => d.isDefault);
      if (defaults.length)
        await PriceList.updateMany(
          { _id: { $ne: defaults.at(-1)._id } },
          { $set: { isDefault: false } },
        );
    }
    let approvalId = null;
    if (type === 'services' && saved.length) {
      const approval = await requestTariffApproval(saved, {
        reason,
        title: `Import ${saved.length} services and tariffs`,
      });
      approvalId = approval ? String(approval._id) : null;
      if (!approval) {
        for (const s of saved) {
          if (s.pendingRates?.length) s.rates = s.pendingRates;
          s.set({ pendingRates: undefined, status: 'ACTIVE', isActive: true });
          await s.save();
        }
      }
    }
    await recordAudit({
      action: 'CREATE',
      entity: 'MasterImport',
      entityId: fileId,
      summary: `Imported ${saved.length} ${MASTERS[type].label.toLowerCase()}`,
    });
    return {
      summary: preview.summary,
      approvalId,
      items: saved.slice(0, 50).map((d) => toDto(type, d)),
    };
  });
}

/** Excel template with the right headers (and one rate column per price list for services). */
export async function importTemplate(type) {
  typeOf(type);
  const { columns, label } = MASTERS[type];
  let headers = Object.keys(columns).filter((c) => c !== 'Rate *');
  if (columns['Rate *']) {
    const lists = await PriceList.find({ isActive: true })
      .sort({ isDefault: -1, code: 1 })
      .select('code')
      .lean();
    headers = [...headers, ...lists.map((l) => `Rate ${l.code}`)];
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(label.slice(0, 31));
  ws.addRow(headers).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 20));
  const help = wb.addWorksheet('How to fill');
  help.addRows([
    ['Fill one row per record on the first sheet. Keep the header row as it is.'],
    ['A code that already exists updates that record; a new code adds one.'],
    ['Amounts are in rupees (e.g. 500 or 499.50). Yes/No columns take Yes or No.'],
    ['Upload the file, check the preview, then confirm. Nothing is saved until you confirm.'],
  ]);
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: `${type}-template.xlsx`,
    mime: XLSX,
  };
}
