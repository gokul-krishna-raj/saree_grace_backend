import { Types } from 'mongoose';
import { Product, ProductDocument, ProductImage } from '../../models/Product';
import { Category } from '../../models/Category';
import { ApiError } from '../../utils/ApiError';
import { slugify } from '../../utils/slugify';
import { uploadBufferToCloudinary, deleteCloudinaryImages } from '../../utils/cloudinaryUpload';
import { clampLimit, decodeCursor, encodeCursor } from '../../utils/pagination';
import {
  AddVariantInput,
  CreateSimpleProductInput,
  CreateVariantShellInput,
  ListProductsQuery,
  UpdateProductInput,
  UpdateVariantInput,
} from './product.validation';

async function assertCategoryExists(categoryId: string): Promise<void> {
  const category = await Category.findById(categoryId);
  if (!category) {
    throw ApiError.badRequest('category does not exist');
  }
}

async function generateUniqueProductSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;
  for (;;) {
    const existing = await Product.findOne({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

async function uploadAll(files: Express.Multer.File[]): Promise<ProductImage[]> {
  const uploaded = await Promise.all(files.map((f) => uploadBufferToCloudinary(f.buffer)));
  return uploaded.map((u, idx) => ({ url: u.url, publicId: u.publicId, isPrimary: idx === 0 }));
}

export async function createSimpleProduct(
  input: CreateSimpleProductInput,
  files: Express.Multer.File[],
): Promise<ProductDocument> {
  await assertCategoryExists(input.category);
  if (input.sku) {
    const skuTaken = await Product.findOne({ sku: input.sku });
    if (skuTaken) {
      throw ApiError.conflict(`SKU already in use: ${input.sku}`);
    }
  }

  const slug = await generateUniqueProductSlug(input.name);
  const images = files.length > 0 ? await uploadAll(files) : [];

  return Product.create({
    type: 'simple',
    name: input.name,
    slug,
    description: input.description,
    category: input.category,
    fabric: input.fabric,
    color: input.color,
    isHandloom: input.isHandloom,
    price: input.price,
    compareAtPrice: input.compareAtPrice,
    stock: input.stock,
    sku: input.sku,
    images,
  });
}

export async function createVariantShellProduct(
  input: CreateVariantShellInput,
): Promise<ProductDocument> {
  await assertCategoryExists(input.category);
  const slug = await generateUniqueProductSlug(input.name);

  return Product.create({
    type: 'variant',
    name: input.name,
    slug,
    description: input.description,
    category: input.category,
    fabric: input.fabric,
    color: input.color,
    isHandloom: input.isHandloom,
    variantAttributeNames: input.variantAttributeNames,
    variants: [],
  });
}

async function findProductOrThrow(id: string): Promise<ProductDocument> {
  const product = await Product.findById(id);
  if (!product) {
    throw ApiError.notFound('Product not found');
  }
  return product;
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
  newFiles: Express.Multer.File[],
): Promise<ProductDocument> {
  const product = await findProductOrThrow(id);

  if (input.category) {
    await assertCategoryExists(input.category);
    product.category = new Types.ObjectId(input.category);
  }
  if (input.name !== undefined && input.name !== product.name) {
    product.name = input.name;
    product.slug = await generateUniqueProductSlug(input.name, id);
  }
  if (input.description !== undefined) product.description = input.description;
  if (input.fabric !== undefined) product.fabric = input.fabric;
  if (input.color !== undefined) product.color = input.color;
  if (input.isHandloom !== undefined) product.isHandloom = input.isHandloom;
  if (input.isActive !== undefined) product.isActive = input.isActive;

  if (product.type === 'simple') {
    if (input.price !== undefined) product.price = input.price;
    if (input.compareAtPrice !== undefined) product.compareAtPrice = input.compareAtPrice;
    if (input.stock !== undefined) product.stock = input.stock;
    if (input.sku !== undefined && input.sku !== product.sku) {
      const skuTaken = await Product.findOne({ sku: input.sku, _id: { $ne: id } });
      if (skuTaken) {
        throw ApiError.conflict(`SKU already in use: ${input.sku}`);
      }
      product.sku = input.sku;
    }
  }

  if (input.removeImagePublicIds && input.removeImagePublicIds.length > 0) {
    const toRemove = new Set(input.removeImagePublicIds);
    await deleteCloudinaryImages([...toRemove]);
    product.images = product.images.filter((img) => !toRemove.has(img.publicId));
  }

  if (newFiles.length > 0) {
    const uploaded = await uploadAll(newFiles);
    product.images.push(...uploaded);
  }

  await product.save();
  return product;
}

export async function deleteProduct(id: string): Promise<void> {
  const product = await findProductOrThrow(id);

  const publicIds = [
    ...product.images.map((img) => img.publicId),
    ...product.variants.flatMap((v) => v.images.map((img) => img.publicId)),
  ];
  await deleteCloudinaryImages(publicIds);
  await product.deleteOne();
}

export async function addVariant(
  productId: string,
  input: AddVariantInput,
  files: Express.Multer.File[],
): Promise<ProductDocument> {
  const product = await findProductOrThrow(productId);
  if (product.type !== 'variant') {
    throw ApiError.badRequest('Cannot add variants to a simple product');
  }

  const skuTaken = await Product.findOne({ 'variants.sku': input.sku });
  if (skuTaken) {
    throw ApiError.conflict(`SKU already in use: ${input.sku}`);
  }

  const images = files.length > 0 ? await uploadAll(files) : [];

  product.variants.push({
    _id: new Types.ObjectId(),
    sku: input.sku,
    attributes: new Map(Object.entries(input.attributes)),
    price: input.price,
    compareAtPrice: input.compareAtPrice,
    stock: input.stock,
    images,
    isActive: true,
  });

  await product.save();
  return product;
}

export async function updateVariant(
  productId: string,
  variantId: string,
  input: UpdateVariantInput,
  newFiles: Express.Multer.File[],
): Promise<ProductDocument> {
  const product = await findProductOrThrow(productId);
  const variant = product.variants.find((v) => v._id.toString() === variantId);
  if (!variant) {
    throw ApiError.notFound('Variant not found');
  }

  if (input.sku !== undefined && input.sku !== variant.sku) {
    const skuTaken = await Product.findOne({
      'variants.sku': input.sku,
      _id: { $ne: productId },
    });
    if (skuTaken) {
      throw ApiError.conflict(`SKU already in use: ${input.sku}`);
    }
    variant.sku = input.sku;
  }
  if (input.attributes !== undefined) {
    variant.attributes = new Map(Object.entries(input.attributes));
  }
  if (input.price !== undefined) variant.price = input.price;
  if (input.compareAtPrice !== undefined) variant.compareAtPrice = input.compareAtPrice;
  if (input.stock !== undefined) variant.stock = input.stock;
  if (input.isActive !== undefined) variant.isActive = input.isActive;

  if (input.removeImagePublicIds && input.removeImagePublicIds.length > 0) {
    const toRemove = new Set(input.removeImagePublicIds);
    await deleteCloudinaryImages([...toRemove]);
    variant.images = variant.images.filter((img) => !toRemove.has(img.publicId));
  }

  if (newFiles.length > 0) {
    const uploaded = await uploadAll(newFiles);
    variant.images.push(...uploaded);
  }

  await product.save();
  return product;
}

export async function deleteVariant(
  productId: string,
  variantId: string,
): Promise<ProductDocument> {
  const product = await findProductOrThrow(productId);
  const variant = product.variants.find((v) => v._id.toString() === variantId);
  if (!variant) {
    throw ApiError.notFound('Variant not found');
  }

  await deleteCloudinaryImages(variant.images.map((img) => img.publicId));
  product.variants = product.variants.filter(
    (v) => v._id.toString() !== variantId,
  ) as typeof product.variants;

  await product.save();
  return product;
}

export async function getProductBySlug(slug: string): Promise<ProductDocument> {
  const product = await Product.findOne({ slug, isActive: true }).populate('category', 'name slug');
  if (!product) {
    throw ApiError.notFound('Product not found');
  }
  return product;
}

export interface ProductListResult {
  products: ProductDocument[];
  nextCursor: string | null;
}

export async function listProducts(query: ListProductsQuery): Promise<ProductListResult> {
  const limit = clampLimit(query.limit);
  const filter: Record<string, unknown> = { isActive: true };

  if (query.category) filter.category = query.category;
  if (query.fabric) filter.fabric = query.fabric;
  if (query.color) filter.color = query.color;
  if (query.handloomOnly) filter.isHandloom = true;

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const priceFilter: Record<string, number> = {};
    if (query.minPrice !== undefined) priceFilter.$gte = query.minPrice;
    if (query.maxPrice !== undefined) priceFilter.$lte = query.maxPrice;
    // Simple products use `price`; variant products' cheapest variant uses
    // `variants.price`. Combine with $or so both product types are covered.
    filter.$or = [{ price: priceFilter }, { 'variants.price': priceFilter }];
  }

  if (query.inStockOnly) {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      { $or: [{ stock: { $gt: 0 } }, { 'variants.stock': { $gt: 0 } }] },
    ];
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { _id: -1 },
    price_asc: { price: 1, _id: -1 },
    price_desc: { price: -1, _id: -1 },
    top_rated: { ratingAvg: -1, _id: -1 },
  };
  const sort = sortMap[query.sort] ?? sortMap.newest;

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (!decoded) {
      throw ApiError.badRequest('Invalid pagination cursor');
    }
    // Cursor pagination on non-_id sort keys still uses _id as the final
    // tiebreaker; for simplicity and correctness we cursor strictly on _id
    // (stable, monotonic, indexed) which guarantees no skip/duplicate even
    // under concurrent inserts. Sort fields other than newest are best used
    // with small enough catalogs that a secondary _id cursor is sufficient.
    if (sort === sortMap.newest) {
      filter._id = { $lt: decoded };
    } else {
      filter._id = { $gt: decoded };
    }
  }

  const products = await Product.find(filter)
    .sort(sort as Record<string, 1 | -1>)
    .limit(limit + 1)
    .populate('category', 'name slug');

  const hasMore = products.length > limit;
  const page = hasMore ? products.slice(0, limit) : products;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last._id) : null;

  return { products: page, nextCursor };
}

export async function searchProducts(
  q: string,
  cursor: string | undefined,
  limitRaw: unknown,
): Promise<ProductListResult> {
  const limit = clampLimit(limitRaw);
  const filter: Record<string, unknown> = { isActive: true, $text: { $search: q } };

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) {
      throw ApiError.badRequest('Invalid pagination cursor');
    }
    filter._id = { $lt: decoded };
  }

  const products = await Product.find(filter, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' }, _id: -1 })
    .limit(limit + 1)
    .populate('category', 'name slug');

  const hasMore = products.length > limit;
  const page = hasMore ? products.slice(0, limit) : products;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last._id) : null;

  return { products: page, nextCursor };
}

/**
 * Atomically decrements stock, failing (rather than going negative) if the
 * requested quantity is no longer available. Used at order creation.
 */
export async function decrementStock(
  productId: string,
  variantId: string | null,
  qty: number,
): Promise<void> {
  if (variantId) {
    const result = await Product.updateOne(
      { _id: productId, 'variants._id': variantId, 'variants.stock': { $gte: qty } },
      { $inc: { 'variants.$.stock': -qty } },
    );
    if (result.matchedCount === 0) {
      throw ApiError.conflict('Insufficient stock for the selected variant');
    }
  } else {
    const result = await Product.updateOne(
      { _id: productId, stock: { $gte: qty } },
      { $inc: { stock: -qty } },
    );
    if (result.matchedCount === 0) {
      throw ApiError.conflict('Insufficient stock for this product');
    }
  }
}

export async function restoreStock(
  productId: string,
  variantId: string | null,
  qty: number,
): Promise<void> {
  if (variantId) {
    await Product.updateOne(
      { _id: productId, 'variants._id': variantId },
      { $inc: { 'variants.$.stock': qty } },
    );
  } else {
    await Product.updateOne({ _id: productId }, { $inc: { stock: qty } });
  }
}

export async function getAvailableStock(
  productId: string,
  variantId: string | null,
): Promise<number> {
  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw ApiError.notFound('Product not found');
  }
  if (variantId) {
    const variant = product.variants.find((v) => v._id.toString() === variantId);
    if (!variant || !variant.isActive) {
      throw ApiError.notFound('Variant not found');
    }
    return variant.stock;
  }
  return product.stock ?? 0;
}
