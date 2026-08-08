import { request, buildApp, createUser, createAdmin, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';

const shippingAddress = {
  fullName: 'Test Customer',
  phone: '9876543210',
  line1: '123 Main St',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600001',
  country: 'India',
};

async function makeProduct(stock = 10, price = 1000): Promise<string> {
  const category = await Category.create({
    name: 'Order Cat',
    slug: `order-cat-${Date.now()}-${Math.random()}`,
  });
  const product = await Product.create({
    type: 'simple',
    name: 'Order Product',
    slug: `order-product-${Date.now()}-${Math.random()}`,
    description: 'desc',
    category: category._id,
    price,
    stock,
  });
  return product._id.toString();
}

describe('Orders & checkout', () => {
  const app = buildApp();

  it('runs the full order lifecycle: create -> paid -> processing -> shipped -> delivered', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const productId = await makeProduct(10);

    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 2 });

    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });
    expect(createRes.status).toBe(201);
    const order = createRes.body.data.order;
    expect(order.status).toBe('pending');
    expect(order.items).toHaveLength(1);

    const productAfterOrder = await Product.findById(productId);
    expect(productAfterOrder?.stock).toBe(8); // decremented atomically at creation

    const myOrderRes = await request(app)
      .get(`/api/v1/orders/${order._id}`)
      .set(authHeader(user.token));
    expect(myOrderRes.status).toBe(200);

    const listRes = await request(app).get('/api/v1/orders/my').set(authHeader(user.token));
    expect(listRes.body.data.orders).toHaveLength(1);

    for (const nextStatus of ['paid', 'processing', 'shipped', 'delivered']) {
      const transitionRes = await request(app)
        .patch(`/api/v1/admin/orders/${order._id}/status`)
        .set(authHeader(admin.token))
        .send({ status: nextStatus, carrier: nextStatus === 'shipped' ? 'BlueDart' : undefined });
      expect(transitionRes.status).toBe(200);
      expect(transitionRes.body.data.order.status).toBe(nextStatus);
    }

    const trackingRes = await request(app)
      .get(`/api/v1/orders/${order._id}/tracking`)
      .set(authHeader(user.token));
    expect(trackingRes.status).toBe(200);
    expect(trackingRes.body.data.statusHistory.map((h: { status: string }) => h.status)).toEqual([
      'pending',
      'paid',
      'processing',
      'shipped',
      'delivered',
    ]);
    expect(trackingRes.body.data.tracking.carrier).toBe('BlueDart');
  });

  it('rejects an invalid status transition (e.g. pending -> delivered)', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const productId = await makeProduct(10);
    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 1 });
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });

    const res = await request(app)
      .patch(`/api/v1/admin/orders/${createRes.body.data.order._id}/status`)
      .set(authHeader(admin.token))
      .send({ status: 'delivered' });

    expect(res.status).toBe(409);
  });

  it('restores stock when an order is cancelled', async () => {
    const user = await createUser();
    const productId = await makeProduct(10);
    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 3 });

    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });
    const orderId = createRes.body.data.order._id;

    expect((await Product.findById(productId))?.stock).toBe(7);

    const cancelRes = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set(authHeader(user.token));

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.order.status).toBe('cancelled');
    expect((await Product.findById(productId))?.stock).toBe(10);
  });

  it("does not allow a customer to view another customer's order", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const productId = await makeProduct(10);
    await request(app)
      .post('/api/v1/cart')
      .set(authHeader(userA.token))
      .send({ productId, qty: 1 });
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(userA.token))
      .send({ shippingAddress });

    const res = await request(app)
      .get(`/api/v1/orders/${createRes.body.data.order._id}`)
      .set(authHeader(userB.token));

    expect(res.status).toBe(403);
  });

  it('rejects checkout with an insufficient-stock item and does not touch stock', async () => {
    const user = await createUser();
    const productId = await makeProduct(2);
    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 2 });

    // Someone else buys the remaining stock out from under this cart via a
    // second, faster checkout.
    await Product.updateOne({ _id: productId }, { $set: { stock: 0 } });

    const res = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });

    expect(res.status).toBe(409);
    expect((await Product.findById(productId))?.stock).toBe(0);
  });

  it('rejects checkout with an empty cart', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });
    expect(res.status).toBe(400);
  });

  it('lets an admin list all orders and fetch any single order by id', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const productId = await makeProduct(10);
    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 1 });
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });

    const listRes = await request(app).get('/api/v1/admin/orders').set(authHeader(admin.token));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.orders.length).toBeGreaterThanOrEqual(1);

    const getRes = await request(app)
      .get(`/api/v1/admin/orders/${createRes.body.data.order._id}`)
      .set(authHeader(admin.token));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.order._id).toBe(createRes.body.data.order._id);
  });

  it('filters admin order listing by status', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const productId = await makeProduct(10);
    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 1 });
    await request(app).post('/api/v1/orders').set(authHeader(user.token)).send({ shippingAddress });

    const res = await request(app)
      .get('/api/v1/admin/orders')
      .query({ status: 'shipped' })
      .set(authHeader(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.data.orders).toHaveLength(0);
  });
});
