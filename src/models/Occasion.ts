import { Schema, model, Document, Types } from 'mongoose';

export interface OccasionDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  image?: { url: string; publicId: string };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const occasionSchema = new Schema<OccasionDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, trim: true },
    image: {
      url: { type: String },
      publicId: { type: String },
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export const Occasion = model<OccasionDocument>('Occasion', occasionSchema);
