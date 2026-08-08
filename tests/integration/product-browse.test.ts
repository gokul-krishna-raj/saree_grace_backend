import { request, buildApp } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';

describe('Product browsing', () => {
  const app = buildApp();

  it('paginates via cursor without skipping or duplicating items across pages', async () => {
    const category = await Category.create({ name: 'Pagination', slug: 'pagination' });
    for (let i = 0; i < 25; i += 1) {
      await Product.create({
        type: 'simple',
        name: `Product ${i.toString().padStart(2, '0')}`,
        slug: `product-${i}`,
        description: 'desc',
        category: category._id,
        price: 100 + i,
        stock: 10,
      });
    }

    const seenIds = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;

    do {
      const res = await request(app)
        .get('/api/v1/products')
        .query({ limit: 10, ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      for (const product of res.body.data.products) {
        expect(seenIds.has(product._id)).toBe(false);
        seenIds.add(product._id);
      }
      cursor = res.body.meta.nextCursor ?? undefined;
      pages += 1;
      expect(pages).toBeLessThan(10); // guard against an infinite loop on a bug
    } while (cursor);

    expect(seenIds.size).toBe(25);
  });

  it('clamps an excessive client-requested limit server-side', async () => {
    const category = await Category.create({ name: 'Clamp', slug: 'clamp' });
    for (let i = 0; i < 5; i += 1) {
      await Product.create({
        type: 'simple',
        name: `Clamp Product ${i}`,
        slug: `clamp-product-${i}`,
        description: 'desc',
        category: category._id,
        price: 100,
        stock: 10,
      });
    }

    const res = await request(app).get('/api/v1/products').query({ limit: 10000 });
    expect(res.status).toBe(200);
    // Never returns more than MAX_PAGE_LIMIT even if the whole catalog matches.
    expect(res.body.data.products.length).toBeLessThanOrEqual(50);
  });

  it('combines category, price range, and handloom filters', async () => {
    const categoryA = await Category.create({ name: 'Filter A', slug: 'filter-a' });
    const categoryB = await Category.create({ name: 'Filter B', slug: 'filter-b' });

    await Product.create({
      type: 'simple',
      name: 'Cheap Handloom A',
      slug: 'cheap-handloom-a',
      description: 'desc',
      category: categoryA._id,
      price: 500,
      stock: 5,
      isHandloom: true,
    });
    await Product.create({
      type: 'simple',
      name: 'Expensive Handloom A',
      slug: 'expensive-handloom-a',
      description: 'desc',
      category: categoryA._id,
      price: 5000,
      stock: 5,
      isHandloom: true,
    });
    await Product.create({
      type: 'simple',
      name: 'Cheap Non-Handloom A',
      slug: 'cheap-non-handloom-a',
      description: 'desc',
      category: categoryA._id,
      price: 500,
      stock: 5,
      isHandloom: false,
    });
    await Product.create({
      type: 'simple',
      name: 'Cheap Handloom B',
      slug: 'cheap-handloom-b',
      description: 'desc',
      category: categoryB._id,
      price: 500,
      stock: 5,
      isHandloom: true,
    });

    const res = await request(app).get('/api/v1/products').query({
      category: categoryA._id.toString(),
      handloomOnly: 'true',
      maxPrice: 1000,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].name).toBe('Cheap Handloom A');
  });

  it('excludes out-of-stock products when inStockOnly is set', async () => {
    const category = await Category.create({ name: 'Stock Filter', slug: 'stock-filter' });
    await Product.create({
      type: 'simple',
      name: 'In Stock',
      slug: 'in-stock',
      description: 'desc',
      category: category._id,
      price: 100,
      stock: 5,
    });
    await Product.create({
      type: 'simple',
      name: 'Out Of Stock',
      slug: 'out-of-stock',
      description: 'desc',
      category: category._id,
      price: 100,
      stock: 0,
    });

    const res = await request(app)
      .get('/api/v1/products')
      .query({ category: category._id.toString(), inStockOnly: 'true' });

    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].name).toBe('In Stock');
  });

  it('returns relevant results from text search', async () => {
    const category = await Category.create({ name: 'Search', slug: 'search-cat' });
    await Product.create({
      type: 'simple',
      name: 'Kanjivaram Silk Saree',
      slug: 'kanjivaram-silk-saree',
      description: 'A traditional silk saree from Kanjivaram',
      category: category._id,
      price: 8000,
      stock: 3,
    });
    await Product.create({
      type: 'simple',
      name: 'Cotton Casual Saree',
      slug: 'cotton-casual-saree',
      description: 'An everyday cotton saree',
      category: category._id,
      price: 800,
      stock: 10,
    });

    const res = await request(app).get('/api/v1/products/search').query({ q: 'kanjivaram silk' });
    expect(res.status).toBe(200);
    expect(res.body.data.products.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.products[0].name).toBe('Kanjivaram Silk Saree');
  });

  it('fetches a product by slug with full detail', async () => {
    const category = await Category.create({ name: 'Detail', slug: 'detail-cat' });
    await Product.create({
      type: 'simple',
      name: 'Detail Saree',
      slug: 'detail-saree',
      description: 'desc',
      category: category._id,
      price: 999,
      stock: 4,
    });

    const res = await request(app).get('/api/v1/products/detail-saree');
    expect(res.status).toBe(200);
    expect(res.body.data.product.name).toBe('Detail Saree');
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await request(app).get('/api/v1/products/does-not-exist');
    expect(res.status).toBe(404);
  });
});
