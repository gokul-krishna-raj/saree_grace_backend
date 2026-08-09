import { Schema, model, Document, Types } from 'mongoose';
import { Address } from './User';

export type OrderStatus =
  'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'payment_failed';

export interface OrderItem {
  product: Types.ObjectId;
  variantId: Types.ObjectId | null;
  nameSnapshot: string;
  imageSnapshot?: string;
  skuSnapshot?: string;
  priceSnapshot: number;
  qty: number;
}

export interface OrderStatusHistoryEntry {
  status: OrderStatus;
  note?: string;
  changedAt: Date;
  changedBy?: Types.ObjectId;
}

export interface OrderTracking {
  carrier?: string;
  trackingId?: string;
  trackingUrl?: string;
}

export interface OrderPayment {
  provider: 'razorpay';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  method?: string;
  amountPaid?: number;
  paidAt?: Date;
  failureReason?: string;
  refund?: {
    razorpayRefundId: string;
    amount: number;
    reason?: string;
    refundedAt: Date;
    // 'processing' the moment the refund is created; 'processed' only once
    // Razorpay's `refund.processed` webhook confirms it — the customer's
    // "refund completed" email is gated on the latter, never the former.
    status: 'processing' | 'processed';
  };
}

export interface OrderDocument extends Document {
  _id: Types.ObjectId;
  orderNumber: string;
  user: Types.ObjectId;
  items: OrderItem[];
  shippingAddress: Address;
  itemsTotal: number;
  shippingFee: number;
  total: number;
  status: OrderStatus;
  statusHistory: OrderStatusHistoryEntry[];
  payment: OrderPayment;
  tracking: OrderTracking;
  stockRestored: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<OrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    nameSnapshot: { type: String, required: true },
    imageSnapshot: { type: String },
    skuSnapshot: { type: String },
    priceSnapshot: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const addressSubSchema = new Schema<Address>(
  {
    label: { type: String },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false },
);

const statusHistorySchema = new Schema<OrderStatusHistoryEntry>(
  {
    status: {
      type: String,
      enum: [
        'pending',
        'paid',
        'processing',
        'shipped',
        'delivered',
        'cancelled',
        'payment_failed',
      ],
      required: true,
    },
    note: { type: String },
    changedAt: { type: Date, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const orderSchema = new Schema<OrderDocument>(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [orderItemSchema], required: true, validate: (v: OrderItem[]) => v.length > 0 },
    shippingAddress: { type: addressSubSchema, required: true },
    itemsTotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: [
        'pending',
        'paid',
        'processing',
        'shipped',
        'delivered',
        'cancelled',
        'payment_failed',
      ],
      default: 'pending',
      index: true,
    },
    statusHistory: { type: [statusHistorySchema], default: [] },
    payment: {
      provider: { type: String, enum: ['razorpay'], default: 'razorpay' },
      razorpayOrderId: { type: String, index: true },
      razorpayPaymentId: { type: String },
      razorpaySignature: { type: String },
      method: { type: String },
      amountPaid: { type: Number },
      paidAt: { type: Date },
      failureReason: { type: String },
      refund: {
        razorpayRefundId: { type: String },
        amount: { type: Number },
        reason: { type: String },
        refundedAt: { type: Date },
        status: { type: String, enum: ['processing', 'processed'] },
      },
    },
    tracking: {
      carrier: { type: String },
      trackingId: { type: String },
      trackingUrl: { type: String },
    },
    stockRestored: { type: Boolean, default: false },
  },
  { timestamps: true },
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

export const Order = model<OrderDocument>('Order', orderSchema);
