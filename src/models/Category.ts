import { Schema, model, Document, Types } from 'mongoose';

export interface CategoryDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  parentCategory: Types.ObjectId | null;
  image?: { url: string; publicId: string };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<CategoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, trim: true },
    parentCategory: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    image: {
      url: { type: String },
      publicId: { type: String },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Category = model<CategoryDocument>('Category', categorySchema);
