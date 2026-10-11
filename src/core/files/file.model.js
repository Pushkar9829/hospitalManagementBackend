import { Schema } from 'mongoose';
import { defineModel } from '../db/model.js';

/** One stored file. The bytes live in S3 (local disk in development) under the tenant prefix. */
const schema = new Schema({
  purpose: { type: String, required: true },
  key: { type: String, required: true },
  name: { type: String, required: true, maxlength: 200 },
  mime: { type: String, required: true },
  size: { type: Number, required: true, min: 1 },
  ownerEntity: String,
  ownerId: String,
  status: { type: String, enum: ['PENDING', 'READY', 'DELETED'], default: 'PENDING' },
});
schema.index({ tenantId: 1, ownerEntity: 1, ownerId: 1, status: 1 });
schema.index({ tenantId: 1, key: 1 }, { unique: true });

export const StoredFile = defineModel('StoredFile', schema);
