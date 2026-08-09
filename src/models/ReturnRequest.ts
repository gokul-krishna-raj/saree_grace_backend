import { Schema, model, Document, Types } from 'mongoose';

export type ReturnType = 'return' | 'exchange';
export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'picked_up' | 'completed';

export interface ReturnRequestItem {
  product: Types.ObjectId;
  variantId: Types.ObjectId | null;
  nameSnapshot: string;
  qty: number;
}

export interface ReturnStatusHistoryEntry {
  status: ReturnStatus;
  note?: string;
  changedAt: Date;
  changedBy?: Types.ObjectId;
}

export interface ReturnRequestDocument extends Document {
  _id: Types.ObjectId;
  order: Types.ObjectId;
  user: Types.ObjectId;
  type: ReturnType;
  items: ReturnRequestItem[];
  reason: string;
  status: ReturnStatus;
  adminNote?: string;
  statusHistory: ReturnStatusHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const returnItemSchema = new Schema<ReturnRequestItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    nameSnapshot: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const statusHistorySchema = new Schema<ReturnStatusHistoryEntry>(
  {
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'picked_up', 'completed'],
      required: true,
    },
    note: { type: String },
    changedAt: { type: Date, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const returnRequestSchema = new Schema<ReturnRequestDocument>(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['return', 'exchange'], required: true },
    items: { type: [returnItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'picked_up', 'completed'],
      default: 'requested',
      index: true,
    },
    adminNote: { type: String, trim: true, maxlength: 500 },
    statusHistory: { type: [statusHistorySchema], default: [] },
  },
  { timestamps: true },
);

returnRequestSchema.index({ user: 1, createdAt: -1 });

export const ReturnRequest = model<ReturnRequestDocument>('ReturnRequest', returnRequestSchema);
