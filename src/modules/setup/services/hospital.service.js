import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { Branch } from '../../../core/tenancy/branch.model.js';
import { tenantRegistry } from '../../../core/tenancy/tenant.registry.js';
import { withTransaction } from '../../../core/db/model.js';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { User } from '../../../core/auth/models/user.model.js';
import { HospitalSettings } from '../models/settings.model.js';
import { LegalEntity } from '../models/legalEntity.model.js';

// ---------------------------------------------------------------- settings

export async function getSettings() {
  const { tenant } = current();
  const doc = (await HospitalSettings.findOne({ key: 'hospital' }).lean()) ?? {
    displayName: tenant.name,
    financialYearStartMonth: 4,
    timezone: 'Asia/Kolkata',
    dateFormat: 'DD/MM/YYYY',
    languages: ['en', 'hi'],
    communication: {},
  };
  return { ...settingsDto(doc), idleTimeoutMin: tenant.settings?.idleTimeoutMin ?? 15 };
}

const settingsDto = (d) => ({
  displayName: d.displayName,
  financialYearStartMonth: d.financialYearStartMonth,
  timezone: d.timezone,
  dateFormat: d.dateFormat,
  languages: d.languages,
  communication: d.communication ?? {},
  version: d.version ?? 0,
});

/** Saves hospital settings. The idle timeout lives on the tenant record, which the API reads per request. */
export async function updateSettings({ version, idleTimeoutMin, ...fields }) {
  const { tenantId } = current();
  return withTransaction(async () => {
    let doc = await HospitalSettings.findOne({ key: 'hospital' });
    if (doc && doc.version !== version) throw errors.versionConflict();
    doc ??= new HospitalSettings({ key: 'hospital' });
    doc.set(fields);
    await doc.save();
    const tenant = await Tenant.findByIdAndUpdate(
      tenantId,
      { $set: { 'settings.idleTimeoutMin': idleTimeoutMin } },
      { new: true },
    );
    await tenantRegistry.invalidate(tenant);
    return { ...settingsDto(doc), idleTimeoutMin };
  });
}

// ---------------------------------------------------------------- legal entities

export const entityDto = (e) => ({
  id: String(e._id),
  name: e.name,
  registrationNo: e.registrationNo,
  gstin: e.gstin,
  pan: e.pan,
  address: e.address,
  signatory: e.signatory,
  logoFileId: e.logoFileId && String(e.logoFileId),
  letterheadFileId: e.letterheadFileId && String(e.letterheadFileId),
  isActive: e.isActive,
  version: e.version,
});

export const listEntities = async () =>
  (await LegalEntity.find().sort({ name: 1 }).lean()).map(entityDto);

export async function saveEntity(id, input) {
  if (!id) return entityDto((await LegalEntity.create([input]))[0]);
  const e = await LegalEntity.findById(id);
  if (!e) throw errors.notFound('Legal entity');
  if (e.version !== input.version) throw errors.versionConflict();
  const { version: _v, ...fields } = input;
  e.set(fields);
  await e.save();
  return entityDto(e);
}

// ---------------------------------------------------------------- branches

export const branchDto = (b) => ({
  id: String(b._id),
  name: b.name,
  code: b.code,
  entityId: b.entityId && String(b.entityId),
  address: b.address,
  gstin: b.gstin,
  phone: b.phone,
  email: b.email,
  status: b.status ?? (b.isActive ? 'ACTIVE' : 'INACTIVE'),
  version: b.version,
});

export const listBranches = async () =>
  (await Branch.find().sort({ name: 1 }).lean()).map(branchDto);

/** New branch: checks the plan limit, then waits for Super Admin approval (spec 4.6). */
export async function createBranch(input, reason) {
  const { tenant } = current();
  const limit = (await Tenant.findById(tenant.id).select('limits').lean())?.limits?.branches ?? 1;
  const used = await Branch.countDocuments({
    status: { $in: ['ACTIVE', 'PENDING_APPROVAL', 'CLOSING'] },
  });
  if (used >= limit)
    throw new AppError(
      402,
      'LIMIT_REACHED',
      `Your plan allows ${limit} branch${limit > 1 ? 'es' : ''}. Add branches to your subscription first.`,
    );
  if (input.entityId && !(await LegalEntity.exists({ _id: input.entityId })))
    throw errors.validation([{ path: 'entityId', message: 'Legal entity not found' }]);
  return withTransaction(async () => {
    const [branch] = await Branch.create([
      { ...input, status: 'PENDING_APPROVAL', isActive: false },
    ]);
    const approval = await requestApproval({
      action: 'setup.branch',
      module: 'CORE',
      entity: 'Branch',
      entityId: branch._id,
      title: `Open branch ${input.name} (${input.code})`,
      after: branchDto(branch),
      payload: { op: 'OPEN' },
      reason: reason || `New branch ${input.name}`,
    });
    if (!approval) {
      branch.set({ status: 'ACTIVE', isActive: true });
      await branch.save();
    }
    return { branch: branchDto(branch), approvalId: approval ? String(approval._id) : null };
  });
}

export async function updateBranch(id, { version, ...fields }) {
  const b = await Branch.findById(id);
  if (!b) throw errors.notFound('Branch');
  if (b.version !== version) throw errors.versionConflict();
  if (b.code !== fields.code && b.status === 'ACTIVE')
    throw errors.validation([
      { path: 'code', message: 'The code of an active branch cannot change' },
    ]);
  b.set(fields);
  await b.save();
  return branchDto(b);
}

/** Closing needs approval and is refused for the last branch or one that is someone's only branch. */
export async function closeBranch(id, { version, reason }) {
  const b = await Branch.findById(id);
  if (!b) throw errors.notFound('Branch');
  if (b.version !== version) throw errors.versionConflict();
  if (b.status !== 'ACTIVE')
    throw new AppError(409, 'INVALID_STATE', 'Only an active branch can be closed');
  const blockers = [];
  if ((await Branch.countDocuments({ status: 'ACTIVE' })) <= 1)
    blockers.push('It is the only active branch');
  const onlyHere = await User.countDocuments({ status: 'ACTIVE', branchIds: [b._id] });
  if (onlyHere)
    blockers.push(`${onlyHere} active user(s) work only in this branch; move them first`);
  if (blockers.length)
    throw new AppError(
      409,
      'BRANCH_IN_USE',
      'This branch cannot be closed yet',
      blockers.map((m) => ({ path: 'branch', message: m })),
    );
  return withTransaction(async () => {
    b.status = 'CLOSING';
    await b.save();
    const approval = await requestApproval({
      action: 'setup.branch',
      module: 'CORE',
      entity: 'Branch',
      entityId: b._id,
      title: `Close branch ${b.name} (${b.code})`,
      before: { status: 'ACTIVE' },
      after: { status: 'INACTIVE' },
      payload: { op: 'CLOSE' },
      reason,
    });
    if (!approval) {
      b.set({ status: 'INACTIVE', isActive: false });
      await b.save();
    }
    return { branch: branchDto(b), approvalId: approval ? String(approval._id) : null };
  });
}

onApprovalDecided('setup.branch', async (req, outcome) => {
  const b = await Branch.findById(req.entityId);
  if (!b) return;
  const approved = outcome === 'APPROVED';
  if (req.payload.op === 'OPEN')
    b.set(
      approved ? { status: 'ACTIVE', isActive: true } : { status: 'REJECTED', isActive: false },
    );
  else
    b.set(
      approved ? { status: 'INACTIVE', isActive: false } : { status: 'ACTIVE', isActive: true },
    );
  await b.save();
});
