import { z } from 'zod';
import { AppError } from '../../../core/errors/index.js';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { ApprovalRequest } from '../../../core/approvals/approval.model.js';
import { Employee } from '../models/hr.models.js';
import { myEmployee } from './hr.service.js';

/**
 * Self-service profile changes (board My Space, "Profile"): contact details, emergency contact
 * and bank account go to HR as an approval request (hr.profileChange) and apply once approved.
 */
const mobile = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile');
export const profileChangeInput = z
  .object({
    mobile: mobile.optional(),
    email: z.email().optional(),
    address: z.string().trim().min(5).max(300).optional(),
    emergencyContact: z
      .object({
        name: z.string().trim().min(2).max(80),
        relation: z.string().trim().max(40),
        mobile,
      })
      .optional(),
    bank: z
      .object({
        name: z.string().trim().min(2).max(60),
        accountNo: z
          .string()
          .trim()
          .regex(/^\d{6,18}$/, 'Account number has 6 to 18 digits'),
        ifsc: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC'),
      })
      .optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.mobile || v.email || v.address || v.emergencyContact || v.bank, {
    message: 'Change at least one detail',
    path: ['mobile'],
  });

const mask = (bank) =>
  bank ? { ...bank, accountNo: `XXXX${bank.accountNo.slice(-4)}` } : undefined;

export async function requestProfileChange({ reason, ...changes }) {
  const me = await myEmployee();
  if (
    await ApprovalRequest.exists({
      action: 'hr.profileChange',
      entityId: String(me._id),
      status: 'PENDING',
    })
  )
    throw new AppError(409, 'CHANGE_PENDING', 'A profile change is already waiting for HR');
  const before = {
    mobile: me.mobile,
    email: me.email,
    address: me.address,
    emergencyContact: me.emergencyContact,
    bank: mask(me.bank?.accountNo ? me.bank : undefined),
  };
  const approval = await requestApproval({
    action: 'hr.profileChange',
    module: 'HRM',
    entity: 'Employee',
    entityId: me._id,
    title: `Profile change · ${me.name.first} ${me.name.last ?? ''} (${me.empNo})`,
    before: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k] ?? null])),
    after: { ...changes, ...(changes.bank ? { bank: mask(changes.bank) } : {}) },
    payload: { employeeId: String(me._id), changes },
    reason: reason || 'Employee updated their details',
  });
  if (!approval) {
    await Employee.updateOne({ _id: me._id }, { $set: changes });
    return { status: 'APPLIED' };
  }
  return { status: 'PENDING', approvalId: String(approval._id) };
}

export async function myProfileChanges() {
  const me = await myEmployee();
  const rows = await ApprovalRequest.find({ action: 'hr.profileChange', entityId: String(me._id) })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  return {
    items: rows.map((r) => ({
      id: String(r._id),
      status: r.status,
      at: r.createdAt,
      changes: r.after,
    })),
  };
}

onApprovalDecided('hr.profileChange', async (req, outcome) => {
  if (outcome !== 'APPROVED') return;
  await Employee.updateOne({ _id: req.payload.employeeId }, { $set: req.payload.changes });
});
