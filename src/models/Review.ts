import { Schema, model, Document, Types } from 'mongoose';

export interface ReviewImage {
  url: string;
  publicId: string;
}

export interface ReviewDocument extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  product: Types.ObjectId;
  order: Types.ObjectId;
  rating: number;
  comment: string;
  images: ReviewImage[];
  approved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const reviewImageSchema = new Schema<ReviewImage>(
  { url: { type: String, required: true }, publicId: { type: String, required: true } },
  { _id: false },
);

const reviewSchema = new Schema<ReviewDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true, maxlength: 2000 },
    images: { type: [reviewImageSchema], default: [] },
    approved: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// One review per user per product per order — prevents duplicate reviews
// for the same purchase while still allowing a re-review on a repurchase.
reviewSchema.index({ user: 1, product: 1, order: 1 }, { unique: true });
reviewSchema.index({ product: 1, approved: 1, createdAt: -1 });

export const Review = model<ReviewDocument>('Review', reviewSchema);
