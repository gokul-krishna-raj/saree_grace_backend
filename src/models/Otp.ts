import { Schema, model, Document, Types } from 'mongoose';

export type OtpPurpose = 'signup' | 'login' | 'reset';

export interface OtpDocument extends Document {
  _id: Types.ObjectId;
  email: string;
  otpHash: string;
  purpose: OtpPurpose;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
}

const otpSchema = new Schema<OtpDocument>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    otpHash: { type: String, required: true },
    purpose: { type: String, enum: ['signup', 'login', 'reset'], required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Otp = model<OtpDocument>('Otp', otpSchema);
