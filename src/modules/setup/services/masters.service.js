import { MASTERS } from '@hms/shared/schemas';
import { formatINR, toPaise } from '@hms/shared';
import { AppError, errors } from '../../../core/errors/index.js';
import { withTransaction } from '../../../core/db/model.js';
import { paginate } from '../../../core/http/paginate.js';
import { Branch } from '../../../core/tenancy/branch.model.js';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { Department } from '../models/department.model.js';
import {
  Bed,
  Designation,
  Doctor,
  Holiday,
  Package,
  Payer,
  PaymentMode,
  PriceList,
  ReferralSource,
  Service,
  TaxCode,
  Unit,
  Ward,
} from '../models/masters.models.js';
import { User } from '../../../core/auth/models/user.model.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byCode = async (Model, codes, filter = {}) =>
  new Map(
    (await Model.find({ code: { $in: [...new Set(codes)] }, ...filter }).lean()).map((d) => [
      d.code,
      d,
    ]),
  );

/**
 * One definition per master type: its model, how input becomes a document (resolving codes to
 * ids), and how a document is shown. `resolve` gets all rows at once so imports stay fast.
 */
export const TYPES = {
  'price-lists': { model: PriceList, dto: (d) => ({ kind: d.kind, isDefault: d.isDefault }) },
  'tax-codes': { model: TaxCode, dto: (d) => ({ kind: d.kind, rate: d.rate, hsnSac: d.hsnSac }) },
  'payment-modes': {
    model: PaymentMode,
    dto: (d) => ({ kind: d.kind, requiresReference: d.requiresReference }),
  },
  'referral-sources': { model: ReferralSource, dto: (d) => ({ kind: d.kind, phone: d.phone }) },
  units: { model: Unit, dto: (d) => ({ baseUnit: d.baseUnit, factor: d.factor }) },
  designations: { model: Designation, dto: (d) => ({ grade: d.grade }) },
  holidays: {
    model: Holiday,
    async resolve(rows) {
      const branches = await byCode(
        Branch,
        rows.flatMap((r) => r.branchCodes),
      );
      return rows.map(({ branchCodes, ...r }) => {
        const missing = branchCodes.filter((c) => !branches.has(c));
        if (missing.length)
          return {
            error: { path: 'branchCodes', message: `Unknown branch ${missing.join(', ')}` },
          };
        return { doc: { ...r, branchIds: branchCodes.map((c) => branches.get(c)._id) } };
      });
    },
    dto: (d) => ({ date: d.date, branchIds: (d.branchIds ?? []).map(String) }),
  },
  services: {
    model: Service,
    async resolve(rows) {
      const depts = await byCode(Department, rows.map((r) => r.departmentCode).filter(Boolean), {
        status: 'ACTIVE',
      });
      const taxes = await byCode(
        TaxCode,
        rows.map((r) => r.taxCode),
        { isActive: true },
      );
      const lists = await byCode(
        PriceList,
        rows.flatMap((r) => Object.keys(r.rates)),
        { isActive: true },
      );
      return rows.map(({ departmentCode, taxCode, rates, ...r }) => {
        if (departmentCode && !depts.has(departmentCode))
          return {
            error: { path: 'departmentCode', message: `No active department ${departmentCode}` },
          };
        if (!taxes.has(taxCode))
          return { error: { path: 'taxCode', message: `No active tax code ${taxCode}` } };
        const unknown = Object.keys(rates).filter((c) => !lists.has(c));
        if (unknown.length)
          return { error: { path: 'rates', message: `Unknown price list ${unknown.join(', ')}` } };
        return {
          doc: {
            ...r,
            departmentId: departmentCode ? depts.get(departmentCode)._id : undefined,
            taxCodeId: taxes.get(taxCode)._id,
            rates: Object.entries(rates).map(([c, rupees]) => ({
              priceListId: lists.get(c)._id,
              amount: toPaise(rupees),
            })),
          },
        };
      });
    },
    dto: (d) => ({
      category: d.category,
      departmentId: d.departmentId && String(d.departmentId),
      taxCodeId: String(d.taxCodeId),
      revenueHead: d.revenueHead,
      rates: d.rates.map((r) => ({ priceListId: String(r.priceListId), amount: r.amount })),
      pendingRates: d.pendingRates?.map((r) => ({
        priceListId: String(r.priceListId),
        amount: r.amount,
      })),
      status: d.status,
    }),
  },
};

const idStr = (v) => (v ? String(v) : undefined);

/**
 * Resolves optional `<x>Code` fields to ids: [inputField, docField, Model, filter, label].
 * Returns { doc } or { error } per row.
 */
async function resolveCodes(rows, refs) {
  const maps = await Promise.all(
    refs.map(([field, , Model, filter, , by = 'code']) =>
      by === 'code'
        ? byCode(Model, rows.map((r) => r[field]).filter(Boolean), filter)
        : Model.find({ [by]: { $in: rows.map((r) => r[field]).filter(Boolean) }, ...filter })
            .lean()
            .then((ds) => new Map(ds.map((d) => [d[by], d]))),
    ),
  );
  return rows.map((row) => {
    const doc = { ...row };
    for (const [i, [field, docField, , , label]] of refs.entries()) {
      delete doc[field];
      if (!row[field]) continue;
      const found = maps[i].get(row[field]);
      if (!found) return { error: { path: field, message: `No active ${label} ${row[field]}` } };
      doc[docField] = found._id;
      if (docField === 'wardId') doc.branchId = found.branchId;
    }
    return { doc };
  });
}

const ACTIVE = { isActive: true };
const DEPT = ['departmentCode', 'departmentId', Department, { status: 'ACTIVE' }, 'department'];
const TAX = ['taxCode', 'taxCodeId', TaxCode, ACTIVE, 'tax code'];

Object.assign(TYPES, {
  wards: {
    model: Ward,
    filters: { branchId: 'branchId' },
    resolve: (rows) =>
      resolveCodes(rows, [
        ['branchCode', 'branchId', Branch, {}, 'branch'],
        [
          'bedServiceCode',
          'bedServiceId',
          Service,
          { category: 'BED', isActive: true },
          'bed-day service',
        ],
        DEPT,
      ]),
    dto: (d) => ({
      branchId: idStr(d.branchId),
      floor: d.floor,
      category: d.category,
      gender: d.gender,
      bedServiceId: idStr(d.bedServiceId),
      departmentId: idStr(d.departmentId),
    }),
  },
  beds: {
    model: Bed,
    filters: { wardId: 'wardId', branchId: 'branchId' },
    resolve: (rows) => resolveCodes(rows, [['wardCode', 'wardId', Ward, ACTIVE, 'ward']]),
    dto: (d) => ({
      wardId: idStr(d.wardId),
      branchId: idStr(d.branchId),
      room: d.room,
      kind: d.kind,
    }),
  },
  packages: {
    model: Package,
    async resolve(rows) {
      const res = await resolveCodes(rows, [TAX, DEPT]);
      return res.map((r) => (r.doc ? { doc: { ...r.doc, price: toPaise(r.doc.price) } } : r));
    },
    dto: (d) => ({
      kind: d.kind,
      price: d.price,
      stayDays: d.stayDays,
      wardCategory: d.wardCategory,
      includes: d.includes,
      excludes: d.excludes,
      taxCodeId: idStr(d.taxCodeId),
      departmentId: idStr(d.departmentId),
    }),
  },
  payers: {
    model: Payer,
    filters: { kind: 'kind' },
    async resolve(rows) {
      const res = await resolveCodes(rows, [
        ['priceListCode', 'priceListId', PriceList, ACTIVE, 'price list'],
      ]);
      return res.map((r) =>
        r.doc ? { doc: { ...r.doc, creditLimit: toPaise(r.doc.creditLimit ?? 0) } } : r,
      );
    },
    dto: (d) => ({
      kind: d.kind,
      priceListId: idStr(d.priceListId),
      creditLimit: d.creditLimit,
      creditDays: d.creditDays,
      gstin: d.gstin,
      contactName: d.contactName,
      email: d.email,
      phone: d.phone,
    }),
  },
  doctors: {
    model: Doctor,
    filters: { departmentId: 'departmentId' },
    resolve: (rows) =>
      resolveCodes(rows, [
        DEPT,
        ['username', 'userId', User, {}, 'user', 'username'],
        ['consultationServiceCode', 'consultationServiceId', Service, ACTIVE, 'service'],
      ]),
    dto: (d) => ({
      kind: d.kind,
      departmentId: idStr(d.departmentId),
      registrationNo: d.registrationNo,
      council: d.council,
      qualification: d.qualification,
      specialisation: d.specialisation,
      userId: idStr(d.userId),
      consultationServiceId: idStr(d.consultationServiceId),
    }),
  },
});

export function typeOf(type) {
  const t = TYPES[type];
  if (!t || !MASTERS[type]) throw errors.notFound('Master type');
  return t;
}

export const toDto = (type, d) => ({
  id: String(d._id),
  code: d.code,
  name: d.name,
  isActive: d.isActive,
  version: d.version,
  ...TYPES[type].dto(d),
});

/** Turns validated rows into documents, or row errors. */
export async function resolveRows(type, rows) {
  const t = typeOf(type);
  return t.resolve ? t.resolve(rows) : rows.map((r) => ({ doc: r }));
}

export async function listMasters(type, { q, active, ...rest }) {
  const t = typeOf(type);
  const filter = {};
  const page = {};
  const FILTER_KEYS = ['branchId', 'wardId', 'departmentId', 'kind'];
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (t.filters?.[k]) filter[t.filters[k]] = v;
    else if (!FILTER_KEYS.includes(k)) page[k] = v;
  }
  if (active !== undefined) filter.isActive = active;
  if (q)
    filter.$or = [
      { code: new RegExp(`^${escapeRegex(q.toUpperCase())}`) },
      { name: new RegExp(escapeRegex(q), 'i') },
    ];
  return paginate(t.model, filter, page, {
    allowedSort: ['code', 'name', 'createdAt'],
    defaultSort: 'name',
    map: (d) => toDto(type, d),
  });
}

const sameRates = (a = [], b = []) =>
  a.length === b.length &&
  a.every((r) =>
    b.some((x) => String(x.priceListId) === String(r.priceListId) && x.amount === r.amount),
  );

function describeRates(rates, lists) {
  return Object.fromEntries(
    rates.map((r) => [
      lists.get(String(r.priceListId)) ?? String(r.priceListId),
      formatINR(r.amount),
    ]),
  );
}

/** A tariff change (new service or new rates) waits for Super Admin approval (spec 4.5). */
async function requestTariffApproval(services, { reason, title }) {
  const lists = new Map(
    (await PriceList.find().select('code').lean()).map((l) => [String(l._id), l.code]),
  );
  return requestApproval({
    action: 'billing.tariffChange',
    module: 'CORE',
    entity: services.length === 1 ? 'Service' : 'ServiceImport',
    entityId: services.length === 1 ? services[0]._id : `${Date.now()}-${services.length}`,
    title,
    before: Object.fromEntries(
      services.map((s) => [s.code, s.status === 'ACTIVE' ? describeRates(s.rates, lists) : null]),
    ),
    after: Object.fromEntries(
      services.map((s) => [s.code, describeRates(s.pendingRates ?? s.rates, lists)]),
    ),
    payload: { serviceIds: services.map((s) => String(s._id)) },
    reason: reason || title,
  });
}

/** Creates one master. Services start PENDING_APPROVAL. */
export async function createMaster(type, input, { reason } = {}) {
  const t = typeOf(type);
  const [res] = await resolveRows(type, [input]);
  if (res.error) throw errors.validation([res.error]);
  if (await t.model.exists({ code: input.code }))
    throw errors.validation([{ path: 'code', message: 'This code is already used' }]);
  return withTransaction(async () => {
    const [doc] = await t.model.create([res.doc]);
    if (type === 'price-lists' && doc.isDefault)
      await PriceList.updateMany({ _id: { $ne: doc._id } }, { $set: { isDefault: false } });
    let approvalId = null;
    if (type === 'services') {
      const approval = await requestTariffApproval([doc], {
        reason,
        title: `New service ${doc.code} ${doc.name}`,
      });
      if (!approval) doc.status = 'ACTIVE';
      approvalId = approval ? String(approval._id) : null;
      doc.approvalId = approval?._id;
      doc.isActive = doc.status === 'ACTIVE';
      await doc.save();
    }
    return { item: toDto(type, doc), approvalId };
  });
}

/** Updates one master. For services, rate changes become pending until approved. */
export async function updateMaster(type, id, { version, ...input }, { reason } = {}) {
  const t = typeOf(type);
  const doc = await t.model.findById(id);
  if (!doc) throw errors.notFound('Record');
  if (doc.version !== version) throw errors.versionConflict();
  if (input.code !== doc.code)
    throw errors.validation([
      { path: 'code', message: 'The code cannot change; add a new record instead' },
    ]);
  const [res] = await resolveRows(type, [input]);
  if (res.error) throw errors.validation([res.error]);
  return withTransaction(async () => {
    let approvalId = null;
    if (type === 'services') {
      const { rates, ...rest } = res.doc;
      doc.set(rest);
      if (!sameRates(rates, doc.rates)) {
        if (doc.status === 'PENDING_APPROVAL')
          throw new AppError(
            409,
            'APPROVAL_ALREADY_PENDING',
            'Rates of this service are already waiting for approval',
          );
        if (doc.status === 'ACTIVE') doc.pendingRates = rates;
        else {
          doc.rates = rates;
          doc.status = 'PENDING_APPROVAL';
        }
        await doc.save();
        const approval = await requestTariffApproval([doc], {
          reason,
          title: `Change rates of ${doc.code} ${doc.name}`,
        });
        if (!approval) await applyTariff(doc, true);
        approvalId = approval ? String(approval._id) : null;
      }
    } else {
      doc.set(res.doc);
    }
    await doc.save();
    if (type === 'price-lists' && doc.isDefault)
      await PriceList.updateMany({ _id: { $ne: doc._id } }, { $set: { isDefault: false } });
    return { item: toDto(type, doc), approvalId };
  });
}

export async function setMasterActive(type, id, { version, active }) {
  const t = typeOf(type);
  const doc = await t.model.findById(id);
  if (!doc) throw errors.notFound('Record');
  if (doc.version !== version) throw errors.versionConflict();
  if (type === 'services' && active && doc.status !== 'INACTIVE')
    throw new AppError(409, 'INVALID_STATE', 'Only an inactive service can be reactivated');
  if (type === 'price-lists' && !active && doc.isDefault)
    throw new AppError(409, 'INVALID_STATE', 'Choose another default price list first');
  doc.isActive = active;
  if (type === 'services') doc.status = active ? 'ACTIVE' : 'INACTIVE';
  await doc.save();
  return toDto(type, doc);
}

async function applyTariff(service, approved) {
  if (approved) {
    if (service.pendingRates?.length) service.rates = service.pendingRates;
    service.status = 'ACTIVE';
  } else if (service.status === 'PENDING_APPROVAL') service.status = 'REJECTED';
  service.pendingRates = undefined;
  service.isActive = service.status === 'ACTIVE';
  await service.save();
}

onApprovalDecided('billing.tariffChange', async (req, outcome) => {
  const services = await Service.find({ _id: { $in: req.payload.serviceIds ?? [] } });
  for (const s of services) await applyTariff(s, outcome === 'APPROVED');
});

export { requestTariffApproval };
