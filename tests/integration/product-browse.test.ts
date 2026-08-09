import { request, buildApp, createUser } from '../helpers';
import { Category } from '../../src/models/Category';
import { Occasion } from '../../src/models/Occasion';
import { Product, ProductDocument } from '../../src/models/Product';
import { Order, OrderStatus } from '../../src/models/Order';

async function makeOrder(
  userId: string,
  product: ProductDocument,
  qty: number,
  status: OrderStatus,
): Promise<void> {
  await Order.create({
    orderNumber: `ORD-${Math.random().toString(36).slice(2)}`,
    user: userId,
    items: [
      {
        product: product._id,
        variantId: null,
        nameSnapshot: product.name,
        priceSnapshot: product.price,
        qty,
      },
    ],
    shippingAddress: {
      fullName: 'Test Buyer',
      phone: '9999999999',
      line1: '1 Test Street',
      city: 'Chennai',
      state: 'Tamil Nadu',
      postalCode: '600001',
      country: 'India',
    },
    itemsTotal: (product.price ?? 0) * qty,
    total: (product.price ?? 0) * qty,
    status,
  });
}

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

  it('combines category, price range, and loom type filters', async () => {
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
      loomType: 'handloom',
    });
    await Product.create({
      type: 'simple',
      name: 'Expensive Handloom A',
      slug: 'expensive-handloom-a',
      description: 'desc',
      category: categoryA._id,
      price: 5000,
      stock: 5,
      loomType: 'handloom',
    });
    await Product.create({
      type: 'simple',
      name: 'Cheap Non-Handloom A',
      slug: 'cheap-non-handloom-a',
      description: 'desc',
      category: categoryA._id,
      price: 500,
      stock: 5,
      loomType: 'unknown',
    });
    await Product.create({
      type: 'simple',
      name: 'Cheap Handloom B',
      slug: 'cheap-handloom-b',
      description: 'desc',
      category: categoryB._id,
      price: 500,
      stock: 5,
      loomType: 'handloom',
    });

    const res = await request(app).get('/api/v1/products').query({
      category: categoryA._id.toString(),
      loomType: 'handloom',
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

describe('Best sellers', () => {
  const app = buildApp();

  it('ranks products by units sold across completed orders', async () => {
    const category = await Category.create({ name: 'Best Sellers', slug: 'best-sellers-cat' });
    const buyer = await createUser();

    const topSeller = await Product.create({
      type: 'simple',
      name: 'Top Seller Saree',
      slug: 'top-seller-saree',
      description: 'desc',
      category: category._id,
      price: 1000,
      stock: 100,
    });
    const midSeller = await Product.create({
      type: 'simple',
      name: 'Mid Seller Saree',
      slug: 'mid-seller-saree',
      description: 'desc',
      category: category._id,
      price: 1000,
      stock: 100,
    });
    const neverSold = await Product.create({
      type: 'simple',
      name: 'Never Sold Saree',
      slug: 'never-sold-saree',
      description: 'desc',
      category: category._id,
      price: 1000,
      stock: 100,
    });
    void neverSold;

    await makeOrder(buyer.id, topSeller, 5, 'delivered');
    await makeOrder(buyer.id, topSeller, 3, 'processing');
    await makeOrder(buyer.id, midSeller, 2, 'paid');
    // Cancelled orders must never count toward the ranking.
    await makeOrder(buyer.id, midSeller, 50, 'cancelled');

    const res = await request(app).get('/api/v1/products/best-sellers');
    expect(res.status).toBe(200);
    const names = res.body.data.products.map((p: { name: string }) => p.name);
    expect(names).toEqual(['Top Seller Saree', 'Mid Seller Saree']);
  });

  it('excludes deactivated products from the ranking', async () => {
    const category = await Category.create({ name: 'Best Sellers 2', slug: 'best-sellers-cat-2' });
    const buyer = await createUser();

    const deactivated = await Product.create({
      type: 'simple',
      name: 'Deactivated Best Seller',
      slug: 'deactivated-best-seller',
      description: 'desc',
      category: category._id,
      price: 1000,
      stock: 100,
      isActive: false,
    });

    await makeOrder(buyer.id, deactivated, 10, 'delivered');

    const res = await request(app).get('/api/v1/products/best-sellers');
    expect(res.status).toBe(200);
    const names = res.body.data.products.map((p: { name: string }) => p.name);
    expect(names).not.toContain('Deactivated Best Seller');
  });

  it('respects the limit query parameter', async () => {
    const category = await Category.create({ name: 'Best Sellers 3', slug: 'best-sellers-cat-3' });
    const buyer = await createUser();

    for (let i = 0; i < 5; i += 1) {
      const product = await Product.create({
        type: 'simple',
        name: `Limit Test Saree ${i}`,
        slug: `limit-test-saree-${i}`,
        description: 'desc',
        category: category._id,
        price: 1000,
        stock: 100,
      });
      await makeOrder(buyer.id, product, 5 - i, 'delivered');
    }

    const res = await request(app).get('/api/v1/products/best-sellers').query({ limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(2);
  });

  it('filters by category slug, exactly as browse links use it', async () => {
    const category = await Category.create({ name: 'Bridal Sarees', slug: 'bridal-sarees' });
    const other = await Category.create({ name: 'Other', slug: 'other' });
    await Product.create({
      type: 'simple',
      name: 'Bridal Saree A',
      slug: 'bridal-saree-a',
      description: 'desc',
      category: category._id,
      price: 5000,
      stock: 5,
    });
    await Product.create({
      type: 'simple',
      name: 'Other Saree',
      slug: 'other-saree',
      description: 'desc',
      category: other._id,
      price: 1000,
      stock: 5,
    });

    const res = await request(app).get('/api/v1/products').query({ category: 'bridal-sarees' });
    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].name).toBe('Bridal Saree A');
  });

  it('filters by occasion slug and returns an empty page for an unknown slug', async () => {
    const category = await Category.create({ name: 'Occasion Filter', slug: 'occasion-filter' });
    const occasion = await Occasion.create({ name: 'Wedding', slug: 'wedding' });
    await Product.create({
      type: 'simple',
      name: 'Wedding Saree',
      slug: 'wedding-saree',
      description: 'desc',
      category: category._id,
      occasions: [occasion._id],
      price: 4000,
      stock: 5,
    });

    const matchRes = await request(app).get('/api/v1/products').query({ occasion: 'wedding' });
    expect(matchRes.status).toBe(200);
    expect(matchRes.body.data.products).toHaveLength(1);

    const missRes = await request(app)
      .get('/api/v1/products')
      .query({ category: 'no-such-category-slug' });
    expect(missRes.status).toBe(200);
    expect(missRes.body.data.products).toHaveLength(0);
  });
});
