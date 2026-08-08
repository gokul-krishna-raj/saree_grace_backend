import { request, buildApp, createAdmin, createUser, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';
import { Order } from '../../src/models/Order';

function baseAddress() {
  return {
    fullName: 'Dash Customer',
    phone: '9876543210',
    line1: '1 Main St',
    city: 'Chennai',
    state: 'Tamil Nadu',
    postalCode: '600001',
    country: 'India',
  };
}

describe('Admin dashboard', () => {
  const app = buildApp();

  it('reports order counts by status, revenue, low-stock products, and recent orders matching seeded data', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    const category = await Category.create({ name: 'Dash Cat', slug: 'dash-cat' });

    const lowStockProduct = await Product.create({
      type: 'simple',
      name: 'Low Stock Saree',
      slug: 'low-stock-saree',
      description: 'desc',
      category: category._id,
      price: 100,
      stock: 2,
    });
    await Product.create({
      type: 'simple',
      name: 'Well Stocked Saree',
      slug: 'well-stocked-saree',
      description: 'desc',
      category: category._id,
      price: 100,
      stock: 50,
    });

    // One paid order (counts toward revenue) and one pending order (does not).
    await Order.create({
      orderNumber: 'SG-DASH-PAID',
      user: user.id,
      items: [
        {
          product: lowStockProduct._id,
          variantId: null,
          nameSnapshot: 'x',
          priceSnapshot: 300,
          qty: 1,
        },
      ],
      shippingAddress: baseAddress(),
      itemsTotal: 300,
      shippingFee: 0,
      total: 300,
      status: 'paid',
      statusHistory: [
        { status: 'pending', changedAt: new Date() },
        { status: 'paid', changedAt: new Date() },
      ],
    });
    await Order.create({
      orderNumber: 'SG-DASH-PENDING',
      user: user.id,
      items: [
        {
          product: lowStockProduct._id,
          variantId: null,
          nameSnapshot: 'x',
          priceSnapshot: 150,
          qty: 1,
        },
      ],
      shippingAddress: baseAddress(),
      itemsTotal: 150,
      shippingFee: 0,
      total: 150,
      status: 'pending',
      statusHistory: [{ status: 'pending', changedAt: new Date() }],
    });

    const res = await request(app).get('/api/v1/admin/dashboard').set(authHeader(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.data.orderCountsByStatus.paid).toBe(1);
    expect(res.body.data.orderCountsByStatus.pending).toBe(1);
    expect(res.body.data.revenue.today).toBe(300); // only the paid order counts as revenue
    expect(
      res.body.data.lowStockProducts.some((p: { name: string }) => p.name === 'Low Stock Saree'),
    ).toBe(true);
    expect(res.body.data.recentOrders.length).toBe(2);
  });

  it('rejects a non-admin from viewing the dashboard', async () => {
    const user = await createUser();
    const res = await request(app).get('/api/v1/admin/dashboard').set(authHeader(user.token));
    expect(res.status).toBe(403);
  });
});
