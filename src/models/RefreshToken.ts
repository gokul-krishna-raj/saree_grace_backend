import { Schema, model, Document, Types } from 'mongoose';

export interface RefreshTokenDocument extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  jti: string;
  tokenHash: string;
  revoked: boolean;
  replacedByJti: string | null;
  expiresAt: Date;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true },
    revoked: { type: Boolean, default: false },
    replacedByJti: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// TTL index — Mongo automatically removes expired refresh token records.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema);
