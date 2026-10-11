import { Schema } from 'mongoose';
import { isPermissionKey } from '@hms/shared';
import { PANELS } from '@hms/shared/catalog';
import { defineModel } from '../../db/model.js';

const schema = new Schema({
  code: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: /^[a-z][a-z0-9_-]{1,40}$/,
  },
  name: { type: String, required: true, trim: true },
  /** Role panel (home page and menu) from the UI design, e.g. "doctor". */
  panel: { type: String, required: true, enum: Object.keys(PANELS) },
  permissions: {
    type: [String],
    default: [],
    validate: {
      validator: (list) => list.every(isPermissionKey),
      message: 'Invalid permission key',
    },
  },
  /** Data scope (spec "Data scopes"): what records the role sees by default. */
  scope: { type: String, enum: ['own', 'department', 'ward', 'branch', 'all'], default: 'branch' },
  /** Concurrent signed-in devices (spec 4.4); empty means no limit. */
  maxSessions: { type: Number, min: 1, max: 10 },
  /** Custom roles start as a copy of a system role. */
  clonedFrom: String,
  isActive: { type: Boolean, default: true },
  /** Custom role lifecycle; a permission change waits for Super Admin approval. */
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'INACTIVE'],
    default: 'ACTIVE',
  },
  pendingPermissions: { type: [String], default: undefined },
  isSystem: { type: Boolean, default: false },
});
schema.index({ tenantId: 1, code: 1 }, { unique: true });

export const Role = defineModel('Role', schema);
