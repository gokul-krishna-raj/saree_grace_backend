/**
 * Populates a database with enough data to exercise every part of the API
 * manually: categories (with a subcategory), a simple product, a variant
 * product, a test admin, and a test customer.
 *
 * Usage: npm run seed
 * Reads MONGODB_URI (and SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD) from .env.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { User } from '../src/models/User';
import { Category } from '../src/models/Category';
import { Product } from '../src/models/Product';
import { slugify } from '../src/utils/slugify';
import { logger } from '../src/utils/logger';

const TEST_CUSTOMER_EMAIL = 'customer@example.com';
const TEST_CUSTOMER_PASSWORD = 'Customer123!';

async function upsertAdmin(): Promise<void> {
  const email = env.SEED_ADMIN_EMAIL ?? 'admin@sareegrace.com';
  const password = env.SEED_ADMIN_PASSWORD ?? 'Admin123!';

  const existing = await User.findOne({ email });
  if (existing) {
    logger.info('Admin already exists, skipping', { email });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({ name: 'Saree Grace Admin', email, passwordHash, role: 'admin' });
  logger.info('Seeded admin user', { email, password });
}

async function upsertCustomer(): Promise<void> {
  const existing = await User.findOne({ email: TEST_CUSTOMER_EMAIL });
  if (existing) {
    logger.info('Test customer already exists, skipping', { email: TEST_CUSTOMER_EMAIL });
    return;
  }
  const passwordHash = await bcrypt.hash(TEST_CUSTOMER_PASSWORD, 12);
  await User.create({
    name: 'Test Customer',
    email: TEST_CUSTOMER_EMAIL,
    passwordHash,
    role: 'customer',
  });
  logger.info('Seeded test customer', {
    email: TEST_CUSTOMER_EMAIL,
    password: TEST_CUSTOMER_PASSWORD,
  });
}

async function upsertCategory(name: string, parentId?: mongoose.Types.ObjectId) {
  const slug = slugify(name);
  const existing = await Category.findOne({ slug });
  if (existing) return existing;
  return Category.create({ name, slug, parentCategory: parentId ?? null });
}

async function upsertSimpleProduct(categoryId: mongoose.Types.ObjectId): Promise<void> {
  const slug = 'cotton-saree-blue';
  const existing = await Product.findOne({ slug });
  if (existing) return;

  await Product.create({
    type: 'simple',
    name: 'Cotton Saree - Blue',
    slug,
    description: 'A breathable cotton saree in a calming shade of blue.',
    category: categoryId,
    fabric: 'Cotton',
    color: 'Blue',
    loomType: 'unknown',
    price: 1899,
    compareAtPrice: 2499,
    stock: 25,
    sku: 'SG-SIMPLE-001',
    images: [],
  });
}

async function upsertVariantProduct(categoryId: mongoose.Types.ObjectId): Promise<void> {
  const slug = 'kanjivaram-silk-saree';
  const existing = await Product.findOne({ slug });
  if (existing) return;

  await Product.create({
    type: 'variant',
    name: 'Kanjivaram Silk Saree',
    slug,
    description:
      'A rich, traditional Kanjivaram silk saree available in multiple colors and border widths.',
    category: categoryId,
    fabric: 'Silk',
    loomType: 'unknown',
    variantAttributeNames: ['color', 'borderWidth'],
    variants: [
      {
        _id: new mongoose.Types.ObjectId(),
        sku: 'SG-VAR-RED-2IN',
        attributes: new Map([
          ['color', 'Red'],
          ['borderWidth', '2 inch'],
        ]),
        price: 7999,
        compareAtPrice: 9999,
        stock: 8,
        images: [],
        isActive: true,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        sku: 'SG-VAR-GREEN-4IN',
        attributes: new Map([
          ['color', 'Green'],
          ['borderWidth', '4 inch'],
        ]),
        price: 8999,
        stock: 5,
        images: [],
        isActive: true,
      },
    ],
  });
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  logger.info('Connected to MongoDB for seeding');

  await upsertAdmin();
  await upsertCustomer();

  const sarees = await upsertCategory('Sarees');
  await upsertCategory('Silk Sarees', sarees._id);
  await upsertCategory('Cotton Sarees', sarees._id);

  await upsertSimpleProduct(sarees._id);
  await upsertVariantProduct(sarees._id);

  logger.info('Seed complete');
  await mongoose.disconnect();
}

main().catch((error) => {
  logger.error('Seed failed', { error: (error as Error).message });
  process.exit(1);
});
