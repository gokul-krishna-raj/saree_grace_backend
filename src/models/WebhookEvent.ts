import { Schema, model, Document, Types } from 'mongoose';

export interface WebhookEventDocument extends Document {
  _id: Types.ObjectId;
  provider: 'razorpay';
  eventId: string;
  eventType: string;
  processedAt: Date;
}

const webhookEventSchema = new Schema<WebhookEventDocument>({
  provider: { type: String, enum: ['razorpay'], required: true },
  eventId: { type: String, required: true },
  eventType: { type: String, required: true },
  processedAt: { type: Date, default: Date.now },
});

// Composite uniqueness — Razorpay event ids are unique per account, this
// guards against ever double-processing the same delivery even on retry.
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export const WebhookEvent = model<WebhookEventDocument>('WebhookEvent', webhookEventSchema);
