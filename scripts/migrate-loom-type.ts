/**
 * One-off migration for products created before the `loomType` field
 * existed: backfills them to `loomType: 'unknown'` (never 'handloom' — loom
 * origin must be verified per product) and drops the deprecated `isHandloom`
 * boolean. Also corrects the small set of known seed-era documents whose
 * name/slug/description carried an unverified handloom/handwoven claim.
 *
 * Usage: npx ts-node --transpile-only scripts/migrate-loom-type.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { Product } from '../src/models/Product';
import { logger } from '../src/utils/logger';

// Known pre-loomType documents with an unverified marketing claim in their
// text. Fixed explicitly and listed here (not via generic regex) so every
// change is auditable rather than guessed at runtime.
const TEXT_FIXES: Record<string, { name: string; slug: string; description: string }> = {
  'handloom-cotton-saree-blue': {
    name: 'Cotton Saree - Blue',
    slug: 'cotton-saree-blue',
    description: 'A breathable cotton saree in a calming shade of blue.',
  },
};

async function migrate(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);

  const products = await Product.find({});
  let backfilled = 0;
  let textFixed = 0;

  for (const product of products) {
    const raw = product.toObject() as unknown as Record<string, unknown>;
    if (raw.loomType === undefined) {
      product.loomType = 'unknown';
      backfilled += 1;
    }

    const fix = TEXT_FIXES[product.slug];
    if (fix) {
      logger.info('Removing unverified loom claim from product text', {
        productId: product._id.toString(),
        before: { name: product.name, slug: product.slug, description: product.description },
        after: fix,
      });
      product.name = fix.name;
      product.slug = fix.slug;
      product.description = fix.description;
      textFixed += 1;
    }

    await product.save();
    // Mongoose won't clear a field it no longer knows about via .save() —
    // unset the deprecated column directly.
    await Product.collection.updateOne({ _id: product._id }, { $unset: { isHandloom: '' } });
  }

  logger.info('Migration complete', { totalProducts: products.length, backfilled, textFixed });
  await mongoose.disconnect();
}

migrate().catch((err) => {
  logger.error('Migration failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
