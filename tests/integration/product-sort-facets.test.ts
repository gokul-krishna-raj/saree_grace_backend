import { request, buildApp } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';
import { backfillSortPrice } from '../../scripts/backfill-sort-price';

type Listed = { _id: string; slug: string; startingPrice: number; ratingAvg: number };

let seq = 0;
async function variantProduct(
  categoryId: string,
  variants: Array<{ price: number; color: string; isActive?: boolean; stock?: number }>,
  extra: Record<string, unknown> = {},
) {
  seq += 1;
  return Product.create({
    name: `Variant Saree ${seq}`,
    slug: `variant-saree-${seq}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'd',
    type: 'variant',
    category: categoryId,
    variantAttributeNames: ['color'],
    variants: variants.map((v, i) => ({
      sku: `SKU-${seq}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      attributes: { color: v.color },
      price: v.price,
      stock: v.stock ?? 5,
      isActive: v.isActive ?? true,
    })),
    ...extra,
  });
}

async function simpleProduct(
  categoryId: string,
  price: number,
  extra: Record<string, unknown> = {},
) {
  seq += 1;
  return Product.create({
    name: `Simple Saree ${seq}`,
    slug: `simple-saree-${seq}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'd',
    type: 'simple',
    category: categoryId,
    price,
    stock: 3,
    ...extra,
  });
}

async function collectAll(
  app: ReturnType<typeof buildApp>,
  query: Record<string, string | number>,
) {
  const seen: Listed[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const res = await request(app)
      .get('/api/v1/products')
      .query({ limit: 2, ...query, ...(cursor ? { cursor } : {}) });
    expect(res.status).toBe(200);
    seen.push(...(res.body.data.products as Listed[]));
    cursor = res.body.meta.nextCursor ?? undefined;
    pages += 1;
  } while (cursor && pages < 50);
  return seen;
}

describe('Product price/rating sorting and facets', () => {
  const app = buildApp();
  let categoryId: string;

  beforeEach(async () => {
    const category = await Category.create({ name: 'Silk', slug: `silk-${Date.now()}` });
    categoryId = category._id.toString();
  });

  it('persists the lowest *active* variant price as sortPrice on save', async () => {
    const product = await variantProduct(categoryId, [
      { price: 900, color: 'Blue' },
      { price: 400, color: 'Red', isActive: false },
      { price: 650, color: 'Green' },
    ]);
    expect(product.sortPrice).toBe(650);

    product.variants[1]!.isActive = true;
    await product.save();
    expect((await Product.findById(product._id))!.sortPrice).toBe(400);
  });

  it('sorts variant and simple products by starting price and paginates without skips or duplicates', async () => {
    // Several products share a price to exercise the _id tiebreaker across page boundaries.
    const prices = [850, 1300, 550, 850, 899, 850, 1200];
    for (const [i, price] of prices.entries()) {
      if (i % 3 === 0) await simpleProduct(categoryId, price);
      else
        await variantProduct(categoryId, [
          { price: price + 300, color: 'Blue' },
          { price, color: 'Red' },
        ]);
    }

    const asc = await collectAll(app, { sort: 'price_asc' });
    expect(asc.map((p) => p.startingPrice)).toEqual([...prices].sort((a, b) => a - b));
    expect(new Set(asc.map((p) => p._id)).size).toBe(prices.length);

    const desc = await collectAll(app, { sort: 'price_desc' });
    expect(desc.map((p) => p.startingPrice)).toEqual([...prices].sort((a, b) => b - a));
    expect(new Set(desc.map((p) => p._id)).size).toBe(prices.length);
  });

  it('keeps price sorting correct when combined with filters', async () => {
    await variantProduct(categoryId, [{ price: 3000, color: 'Blue' }]);
    await variantProduct(categoryId, [{ price: 1000, color: 'Blue' }]);
    await variantProduct(categoryId, [{ price: 2000, color: 'Red' }]);

    const res = await collectAll(app, { sort: 'price_desc', color: 'blue', category: categoryId });
    expect(res.map((p) => p.startingPrice)).toEqual([3000, 1000]);
  });

  it('paginates top_rated by (rating, _id) without skips or duplicates', async () => {
    const ratings = [4.5, 3, 5, 4.5, 0, 4.5];
    for (const rating of ratings) await simpleProduct(categoryId, 500, { ratingAvg: rating });

    const all = await collectAll(app, { sort: 'top_rated' });
    expect(all.map((p) => p.ratingAvg)).toEqual([...ratings].sort((a, b) => b - a));
    expect(new Set(all.map((p) => p._id)).size).toBe(ratings.length);
  });

  it('rejects an _id-only cursor for a keyset sort instead of returning a wrong page', async () => {
    const res = await request(app)
      .get('/api/v1/products')
      .query({
        sort: 'price_asc',
        cursor: Buffer.from('6a7eee17785f6dbdd9276cb1').toString('base64url'),
      });
    expect(res.status).toBe(400);
  });

  it('filters by variant colour case-insensitively and accepts a comma-separated list', async () => {
    const blue = await variantProduct(categoryId, [{ price: 800, color: 'Rama Blue' }]);
    const green = await variantProduct(categoryId, [{ price: 800, color: 'green' }]);
    await variantProduct(categoryId, [{ price: 800, color: 'Blue', isActive: false }]);

    const one = await request(app).get('/api/v1/products').query({ color: 'RAMA BLUE' });
    expect(one.body.data.products.map((p: Listed) => p._id)).toEqual([blue._id.toString()]);

    const many = await request(app).get('/api/v1/products').query({ color: 'rama blue,Green' });
    expect(many.body.data.products.map((p: Listed) => p._id).sort()).toEqual(
      [blue._id.toString(), green._id.toString()].sort(),
    );

    // Inactive variants never make a product match.
    const inactive = await request(app).get('/api/v1/products').query({ color: 'blue' });
    expect(inactive.body.data.products).toHaveLength(0);
  });

  it('returns facet options only for values that exist on active variants, counted per product', async () => {
    await variantProduct(categoryId, [
      { price: 800, color: 'Blue' },
      { price: 900, color: 'blue ' },
      { price: 900, color: 'Pink' },
    ]);
    await variantProduct(categoryId, [{ price: 800, color: 'BLUE' }]);
    await variantProduct(categoryId, [{ price: 800, color: 'Orange', isActive: false }]);

    const res = await request(app).get('/api/v1/products/facets').query({ category: categoryId });
    expect(res.status).toBe(200);
    expect(res.body.data.colors).toEqual([
      { value: 'blue', label: 'Blue', count: 2 },
      { value: 'pink', label: 'Pink', count: 1 },
    ]);
    // Swatch hex comes from the variants' own colorCode when set.
    await variantProduct(categoryId, [{ price: 800, color: 'Teal' }], {});
    await Product.updateOne(
      { 'variants.attributes.color': 'Teal' },
      { $set: { 'variants.0.attributes.colorCode': '#008080' } },
    );
    const withHex = await request(app)
      .get('/api/v1/products/facets')
      .query({ category: categoryId });
    expect(withHex.body.data.colors).toContainEqual({
      value: 'teal',
      label: 'Teal',
      count: 1,
      hex: '#008080',
    });
    expect(res.body.data.fabrics).toEqual([]);

    // A colour selection doesn't narrow its own facet (other options stay pickable), while
    // other filters (here: category) do.
    const other = await Category.create({ name: 'Cotton', slug: `cotton-${Date.now()}` });
    await variantProduct(other._id.toString(), [{ price: 800, color: 'Yellow' }]);
    const withColor = await request(app)
      .get('/api/v1/products/facets')
      .query({ category: categoryId, color: 'pink' });
    expect(withColor.body.data.colors.map((c: { value: string }) => c.value)).toEqual([
      'blue',
      'pink',
      'teal',
    ]);
  });

  it('backfills sortPrice for documents saved before the field existed', async () => {
    const product = await variantProduct(categoryId, [{ price: 1234, color: 'Blue' }]);
    await Product.collection.updateOne({ _id: product._id }, { $unset: { sortPrice: '' } });

    const dry = await backfillSortPrice({ dryRun: true });
    expect(dry.changed).toBe(1);
    expect((await Product.collection.findOne({ _id: product._id }))!.sortPrice).toBeUndefined();

    const applied = await backfillSortPrice({ dryRun: false });
    expect(applied.changed).toBe(1);
    expect((await Product.collection.findOne({ _id: product._id }))!.sortPrice).toBe(1234);
    expect((await backfillSortPrice({ dryRun: false })).changed).toBe(0);
  });
});
