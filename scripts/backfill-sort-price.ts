/**
 * One-off backfill for `Product.sortPrice` (the persisted lowest active price
 * used by the price_asc / price_desc listing sorts). New and edited products
 * get it from the pre('save') hook; this fills it in for documents saved
 * before the field existed. Safe to re-run — it only writes documents whose
 * stored value differs from the computed one, and touches no other field.
 *
 * Usage:
 *   npm run migrate:sort-price -- --dry-run   # report only, no writes
 *   npm run migrate:sort-price                # apply
 * Reads MONGODB_URI from .env — double-check which database it points at.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { Product } from '../src/models/Product';
import { logger } from '../src/utils/logger';

export async function backfillSortPrice({ dryRun }: { dryRun: boolean }) {
  const products = await Product.find({}, { type: 1, price: 1, variants: 1, sortPrice: 1 });
  const updates = products
    .map((product) => ({
      id: product._id,
      before: (product.toObject() as { sortPrice?: number }).sortPrice,
      after: product.minPrice(),
    }))
    .filter((row) => row.before !== row.after);

  if (!dryRun && updates.length > 0) {
    // updateOne with $set on just this field — bypasses save() so no other
    // field (or updatedAt) changes.
    await Product.bulkWrite(
      updates.map((row) => ({
        updateOne: {
          filter: { _id: row.id },
          update: { $set: { sortPrice: row.after } },
          timestamps: false,
        },
      })),
    );
  }

  return { total: products.length, changed: updates.length, updates };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGODB_URI);
  const result = await backfillSortPrice({ dryRun });
  logger.info(dryRun ? 'Dry run — no writes' : 'sortPrice backfill complete', {
    totalProducts: result.total,
    changed: result.changed,
  });
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    logger.error('sortPrice backfill failed', { error: (error as Error).message });
    await mongoose.disconnect();
    process.exit(1);
  });
}
