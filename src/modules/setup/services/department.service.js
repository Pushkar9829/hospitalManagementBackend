import { AppError, errors } from '../../../core/errors/index.js';
import { withTransaction } from '../../../core/db/model.js';
import { Branch } from '../../../core/tenancy/branch.model.js';
import { User } from '../../../core/auth/models/user.model.js';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { Department } from '../models/department.model.js';

/**
 * Other modules register what keeps a department in use (beds, open bills, staff on rosters),
 * so closing a department lists everything that has to move first (spec 5.2).
 */
const usageChecks = [
  async (dept) => {
    const n = await User.countDocuments({ status: 'ACTIVE', departmentIds: dept._id });
    return n ? `${n} active staff member(s) belong to it` : null;
  },
  async (dept) => {
    const n = await Department.countDocuments({
      parentId: dept._id,
      status: { $in: ['ACTIVE', 'PENDING_APPROVAL', 'CLOSING'] },
    });
    return n ? `${n} active sub-department(s)` : null;
  },
];
export function registerDepartmentUsageCheck(check) {
  usageChecks.push(check);
}

export const departmentDto = (d) => ({
  id: String(d._id),
  code: d.code,
  name: d.name,
  type: d.type,
  parentId: d.parentId && String(d.parentId),
  hodUserId: d.hodUserId && String(d.hodUserId),
  location: { ...d.location, branchId: String(d.location.branchId) },
  services: d.services,
  costCentre: d.costCentre,
  opdTimings: d.opdTimings ?? [],
  status: d.status,
  approvalId: d.approvalId && String(d.approvalId),
  version: d.version,
});

async function checkRefs(input, selfId) {
  const details = [];
  if (!(await Branch.exists({ _id: input.location.branchId, status: 'ACTIVE' })))
    details.push({ path: 'location.branchId', message: 'Choose an active branch' });
  if (input.parentId) {
    if (selfId && String(input.parentId) === String(selfId))
      details.push({ path: 'parentId', message: 'A department cannot be its own parent' });
    else if (!(await Department.exists({ _id: input.parentId, status: 'ACTIVE' })))
      details.push({ path: 'parentId', message: 'Choose an active parent department' });
  }
  if (input.hodUserId && !(await User.exists({ _id: input.hodUserId, status: 'ACTIVE' })))
    details.push({ path: 'hodUserId', message: 'Choose an active staff member' });
  if (details.length) throw errors.validation(details);
}

async function submit(dept, reason) {
  const approval = await requestApproval({
    action: 'setup.department',
    module: 'CORE',
    entity: 'Department',
    entityId: dept._id,
    title: `Create department ${dept.name} (${dept.code})`,
    after: departmentDto(dept),
    payload: { op: 'CREATE' },
    reason: reason || `New department ${dept.name}`,
  });
  dept.status = approval ? 'PENDING_APPROVAL' : 'ACTIVE';
  dept.approvalId = approval?._id;
  await dept.save();
  return approval;
}

/** Saves the department and sends it to the Super Admin (spec 5.2 user flow). */
export async function createDepartment(input, reason) {
  await checkRefs(input);
  if (await Department.exists({ code: input.code }))
    throw errors.validation([{ path: 'code', message: 'This code is already used' }]);
  return withTransaction(async () => {
    const [dept] = await Department.create([input]);
    const approval = await submit(dept, reason);
    return { department: departmentDto(dept), approvalId: approval ? String(approval._id) : null };
  });
}

/** Resubmits a draft (after a rejection or expiry). */
export async function submitDepartment(id, { version, reason }) {
  return withTransaction(async () => {
    const dept = await Department.findById(id);
    if (!dept) throw errors.notFound('Department');
    if (dept.version !== version) throw errors.versionConflict();
    if (dept.status !== 'DRAFT')
      throw new AppError(409, 'INVALID_STATE', 'Only a draft can be submitted');
    const approval = await submit(dept, reason);
    return { department: departmentDto(dept), approvalId: approval ? String(approval._id) : null };
  });
}

/** Edits details. The code is fixed once the department is active (it appears on reports). */
export async function updateDepartment(id, { version, ...input }) {
  const dept = await Department.findById(id);
  if (!dept) throw errors.notFound('Department');
  if (dept.version !== version) throw errors.versionConflict();
  if (['INACTIVE'].includes(dept.status))
    throw new AppError(409, 'INVALID_STATE', 'An inactive department cannot be edited');
  if (dept.status !== 'DRAFT' && input.code !== dept.code)
    throw errors.validation([{ path: 'code', message: 'The code cannot change after approval' }]);
  await checkRefs(input, id);
  dept.set(input);
  await dept.save();
  return departmentDto(dept);
}

/** Closing lists what still uses the department; otherwise it goes for approval. */
export async function closeDepartment(id, { version, reason }) {
  const dept = await Department.findById(id);
  if (!dept) throw errors.notFound('Department');
  if (dept.version !== version) throw errors.versionConflict();
  if (dept.status !== 'ACTIVE')
    throw new AppError(409, 'INVALID_STATE', 'Only an active department can be closed');
  const blockers = (await Promise.all(usageChecks.map((check) => check(dept)))).filter(Boolean);
  if (blockers.length)
    throw new AppError(
      409,
      'DEPARTMENT_IN_USE',
      'Move these first',
      blockers.map((m) => ({ path: 'department', message: m })),
    );
  return withTransaction(async () => {
    const approval = await requestApproval({
      action: 'setup.department',
      module: 'CORE',
      entity: 'Department',
      entityId: dept._id,
      title: `Close department ${dept.name} (${dept.code})`,
      before: { status: 'ACTIVE' },
      after: { status: 'INACTIVE' },
      payload: { op: 'CLOSE' },
      reason,
    });
    dept.status = approval ? 'CLOSING' : 'INACTIVE';
    dept.approvalId = approval?._id;
    await dept.save();
    return { department: departmentDto(dept), approvalId: approval ? String(approval._id) : null };
  });
}

onApprovalDecided('setup.department', async (req, outcome) => {
  const dept = await Department.findById(req.entityId);
  if (!dept) return;
  const approved = outcome === 'APPROVED';
  if (req.payload.op === 'CREATE') dept.status = approved ? 'ACTIVE' : 'DRAFT';
  else dept.status = approved ? 'INACTIVE' : 'ACTIVE';
  await dept.save();
});
