import { Schema, model, Document, Types } from 'mongoose';

export interface CartItem {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  variantId: Types.ObjectId | null;
  qty: number;
  // Price captured at the moment the item was added/updated. The cart always
  // shows this snapshot; live price is only compared at checkout time so a
  // price change after adding to cart does not silently alter the cart total
  // (see CLAUDE.md "Cart pricing" for the documented decision).
  priceSnapshot: number;
  nameSnapshot: string;
  imageSnapshot?: string;
}

export interface CartDocument extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  items: CartItem[];
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<CartItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    qty: { type: Number, required: true, min: 1 },
    priceSnapshot: { type: Number, required: true, min: 0 },
    nameSnapshot: { type: String, required: true },
    imageSnapshot: { type: String },
  },
  { _id: true },
);

const cartSchema = new Schema<CartDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true },
);

export const Cart = model<CartDocument>('Cart', cartSchema);
