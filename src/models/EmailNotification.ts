import { Schema, model, Document, Types } from 'mongoose';

export type EmailType =
  | 'verification'
  | 'password-reset'
  | 'order-confirmation'
  | 'payment-success'
  | 'payment-failed'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refund-initiated'
  | 'refund-completed'
  | 'return-status'
  | 'abandoned-cart';

export type EmailNotificationStatus = 'pending' | 'sent' | 'failed';

export interface EmailNotificationDocument extends Document {
  _id: Types.ObjectId;
  eventKey: string;
  emailType: EmailType;
  recipientEmail: string;
  orderId?: Types.ObjectId;
  userId?: Types.ObjectId;
  status: EmailNotificationStatus;
  providerMessageId?: string;
  attempts: number;
  lastError?: string;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const emailNotificationSchema = new Schema<EmailNotificationDocument>(
  {
    // The idempotency key — e.g. `${orderId}:order-confirmation`. A unique
    // index here is what makes sends idempotent: a second attempt for the
    // same event finds the existing doc instead of creating a duplicate.
    eventKey: { type: String, required: true, unique: true },
    emailType: {
      type: String,
      enum: [
        'verification',
        'password-reset',
        'order-confirmation',
        'payment-success',
        'payment-failed',
        'shipped',
        'delivered',
        'cancelled',
        'refund-initiated',
        'refund-completed',
        'return-status',
        'abandoned-cart',
      ],
      required: true,
    },
    recipientEmail: { type: String, required: true, lowercase: true, trim: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    providerMessageId: { type: String },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    sentAt: { type: Date },
  },
  { timestamps: true },
);

export const EmailNotification = model<EmailNotificationDocument>(
  'EmailNotification',
  emailNotificationSchema,
);
