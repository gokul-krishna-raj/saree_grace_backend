import { Schema, model, Document, Types } from 'mongoose';
import { getLoomLabel } from '../utils/loomLabel';

export interface ProductImage {
  url: string;
  publicId: string;
  isPrimary?: boolean;
}

export interface ProductVariant {
  _id: Types.ObjectId;
  sku: string;
  attributes: Map<string, string>;
  price: number;
  compareAtPrice?: number;
  stock: number;
  images: ProductImage[];
  isActive: boolean;
}

export type ProductType = 'simple' | 'variant';

// Loom provenance is unknown unless a specific product has been verified —
// never inferred from name/fabric/category. See getLoomLabel() for display.
export type LoomType = 'handloom' | 'powerloom' | 'unknown';

export interface ProductDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description: string;
  type: ProductType;
  category: Types.ObjectId;
  fabric?: string;
  color?: string;
  loomType: LoomType;

  // Simple product fields — required when type === 'simple'
  price?: number;
  compareAtPrice?: number;
  stock?: number;
  sku?: string;
  images: ProductImage[];

  // Variant product fields — required when type === 'variant'
  variantAttributeNames: string[];
  variants: ProductVariant[];

  ratingAvg: number;
  reviewCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  minPrice(): number;
  startingPrice: number;
  loomLabel: string | null;
}

const productImageSchema = new Schema<ProductImage>(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const productVariantSchema = new Schema<ProductVariant>(
  {
    sku: { type: String, required: true, uppercase: true, trim: true },
    attributes: { type: Map, of: String, required: true },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    images: { type: [productImageSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

const productSchema = new Schema<ProductDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, required: true },
    type: { type: String, enum: ['simple', 'variant'], required: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    fabric: { type: String, trim: true, index: true },
    color: { type: String, trim: true, index: true },
    loomType: {
      type: String,
      enum: ['handloom', 'powerloom', 'unknown'],
      default: 'unknown',
      index: true,
    },

    price: {
      type: Number,
      min: 0,
      required: function (this: ProductDocument) {
        return this.type === 'simple';
      },
    },
    compareAtPrice: { type: Number, min: 0 },
    stock: {
      type: Number,
      min: 0,
      default: function (this: ProductDocument) {
        return this.type === 'simple' ? 0 : undefined;
      },
    },
    sku: {
      type: String,
      uppercase: true,
      trim: true,
      sparse: true,
      unique: true,
    },
    images: { type: [productImageSchema], default: [] },

    variantAttributeNames: { type: [String], default: [] },
    variants: { type: [productVariantSchema], default: [] },

    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// Text index for `$text` search across name/description/fabric/color.
productSchema.index({ name: 'text', description: 'text', fabric: 'text', color: 'text' });

// Compound indexes matching common browse filter combinations.
productSchema.index({ category: 1, isActive: 1, createdAt: -1 });
productSchema.index({ category: 1, price: 1 });
productSchema.index({ loomType: 1, isActive: 1 });
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });

productSchema.methods.minPrice = function (this: ProductDocument): number {
  if (this.type === 'simple') {
    return this.price ?? 0;
  }
  // Defensive: when this document comes from a `.populate('product', 'name slug')`
  // style partial projection (e.g. on Review/Order/Wishlist listings), `variants`
  // and `type` are never fetched — fall back to 0 rather than throwing on
  // `undefined.filter`.
  const variants = this.variants ?? [];
  const activePrices = variants.filter((v) => v.isActive).map((v) => v.price);
  return activePrices.length > 0 ? Math.min(...activePrices) : 0;
};

// Serialized on every JSON response (list + detail) so the frontend never
// has to recompute "starting from ₹X" for variant products itself.
productSchema.virtual('startingPrice').get(function (this: ProductDocument) {
  return this.minPrice();
});

// Serialized on every JSON response so the frontend never renders a loom
// claim beyond what getLoomLabel() supports — null means no badge.
productSchema.virtual('loomLabel').get(function (this: ProductDocument) {
  return getLoomLabel(this.loomType);
});

export const Product = model<ProductDocument>('Product', productSchema);
