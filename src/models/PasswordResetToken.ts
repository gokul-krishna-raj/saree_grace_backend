import { Schema, model, Document, Types } from 'mongoose';

export interface PasswordResetTokenDocument extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  tokenHash: string;
  used: boolean;
  expiresAt: Date;
  createdAt: Date;
}

const passwordResetTokenSchema = new Schema<PasswordResetTokenDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    used: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetToken = model<PasswordResetTokenDocument>(
  'PasswordResetToken',
  passwordResetTokenSchema,
);
