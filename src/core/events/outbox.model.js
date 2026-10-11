import mongoose, { Schema } from 'mongoose';

/**
 * Transactional outbox (spec "Domain events"): events are written in the same transaction as
 * the change, then relayed to BullMQ. Not tenant-scoped: the relay reads all tenants.
 */
const schema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['PENDING', 'SENDING', 'SENT', 'FAILED'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    lockedUntil: Date,
    lastError: String,
    requestId: String,
    userId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true, versionKey: false },
);
schema.index({ status: 1, createdAt: 1 });
schema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 86_400, partialFilterExpression: { status: 'SENT' } },
);

export const OutboxEvent = mongoose.models.OutboxEvent ?? mongoose.model('OutboxEvent', schema);
