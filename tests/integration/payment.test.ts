import crypto from 'crypto';
import Razorpay from 'razorpay';
import { request, buildApp, createUser, createAdmin, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';
import { Order } from '../../src/models/Order';

jest.mock('razorpay');

const shippingAddress = {
  fullName: 'Payer',
  phone: '9876543210',
  line1: '1 Market Rd',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600001',
  country: 'India',
};

function mockRazorpay(overrides: { create?: jest.Mock; refund?: jest.Mock } = {}): void {
  const create =
    overrides.create ??
    jest.fn().mockResolvedValue({ id: 'order_mockRP1', amount: 100000, currency: 'INR' });
  const refund =
    overrides.refund ?? jest.fn().mockResolvedValue({ id: 'rfnd_mock1', amount: 100000 });
  (Razorpay as unknown as jest.Mock).mockImplementation(() => ({
    orders: { create },
    payments: { refund },
  }));
}

async function makeOrder(
  userToken: string,
  price = 1000,
): Promise<{ orderId: string; total: number }> {
  const category = await Category.create({
    name: 'Pay Cat',
    slug: `pay-cat-${Date.now()}-${Math.random()}`,
  });
  const product = await Product.create({
    type: 'simple',
    name: 'Pay Product',
    slug: `pay-product-${Date.now()}-${Math.random()}`,
    description: 'desc',
    category: category._id,
    price,
    stock: 10,
  });
  await request(buildApp())
    .post('/api/v1/cart')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ productId: product._id.toString(), qty: 1 });
  const createRes = await request(buildApp())
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ shippingAddress });
  return { orderId: createRes.body.data.order._id, total: createRes.body.data.order.total };
}

function signWebhookBody(body: unknown, secret: string): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature };
}

describe('Payments (Razorpay)', () => {
  const app = buildApp();

  it('creates a Razorpay order tied to the internal order', async () => {
    mockRazorpay();
    const user = await createUser();
    const { orderId } = await makeOrder(user.token);

    const res = await request(app)
      .post('/api/v1/payments/create-order')
      .set(authHeader(user.token))
      .send({ orderId });

    expect(res.status).toBe(201);
    expect(res.body.data.razorpayOrderId).toBe('order_mockRP1');
    const order = await Order.findById(orderId);
    expect(order?.payment.razorpayOrderId).toBe('order_mockRP1');
  });

  it('verifies a correctly signed payment and marks the order paid', async () => {
    mockRazorpay();
    const user = await createUser();
    const { orderId } = await makeOrder(user.token);
    await request(app)
      .post('/api/v1/payments/create-order')
      .set(authHeader(user.token))
      .send({ orderId });

    const razorpayPaymentId = 'pay_mock123';
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
      .update(`order_mockRP1|${razorpayPaymentId}`)
      .digest('hex');

    const res = await request(app)
      .post('/api/v1/payments/verify')
      .set(authHeader(user.token))
      .send({ razorpayOrderId: 'order_mockRP1', razorpayPaymentId, razorpaySignature: signature });

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('paid');
  });

  it('rejects a tampered payment signature', async () => {
    mockRazorpay();
    const user = await createUser();
    const { orderId } = await makeOrder(user.token);
    await request(app)
      .post('/api/v1/payments/create-order')
      .set(authHeader(user.token))
      .send({ orderId });

    const res = await request(app)
      .post('/api/v1/payments/verify')
      .set(authHeader(user.token))
      .send({
        razorpayOrderId: 'order_mockRP1',
        razorpayPaymentId: 'pay_mock123',
        razorpaySignature: 'not-a-real-signature',
      });

    expect(res.status).toBe(400);
    const order = await Order.findById(orderId);
    expect(order?.status).toBe('pending');
  });

  describe('webhook', () => {
    it('accepts a validly-signed payment.captured event and marks the order paid', async () => {
      mockRazorpay();
      const user = await createUser();
      const { orderId } = await makeOrder(user.token, 1200);
      await request(app)
        .post('/api/v1/payments/create-order')
        .set(authHeader(user.token))
        .send({ orderId });

      const body = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_webhook1',
              order_id: 'order_mockRP1',
              method: 'upi',
              amount: 120000,
            },
          },
        },
      };
      const { raw, signature } = signWebhookBody(
        body,
        process.env.RAZORPAY_WEBHOOK_SECRET as string,
      );

      const res = await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', 'evt_1')
        .send(raw);

      expect(res.status).toBe(200);
      const order = await Order.findById(orderId);
      expect(order?.status).toBe('paid');
      expect(order?.payment.razorpayPaymentId).toBe('pay_webhook1');
    });

    it('rejects a webhook with a tampered signature', async () => {
      mockRazorpay();
      const body = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x', amount: 1000 } } },
      };
      const raw = JSON.stringify(body);

      const res = await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'totally-wrong-signature')
        .send(raw);

      expect(res.status).toBe(400);
    });

    it('safely ignores a duplicate webhook delivery (idempotent)', async () => {
      mockRazorpay();
      const user = await createUser();
      const { orderId } = await makeOrder(user.token, 1500);
      await request(app)
        .post('/api/v1/payments/create-order')
        .set(authHeader(user.token))
        .send({ orderId });

      const body = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: 'pay_dup1', order_id: 'order_mockRP1', method: 'card', amount: 150000 },
          },
        },
      };
      const { raw, signature } = signWebhookBody(
        body,
        process.env.RAZORPAY_WEBHOOK_SECRET as string,
      );

      const first = await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', 'evt_dup')
        .send(raw);
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', 'evt_dup')
        .send(raw);
      expect(second.status).toBe(200);

      const order = await Order.findById(orderId);
      expect(order?.status).toBe('paid');
      expect(order?.statusHistory.filter((h) => h.status === 'paid')).toHaveLength(1);
    });

    it('marks the order payment_failed on a payment.failed event, without marking it paid', async () => {
      mockRazorpay();
      const user = await createUser();
      const { orderId } = await makeOrder(user.token, 700);
      await request(app)
        .post('/api/v1/payments/create-order')
        .set(authHeader(user.token))
        .send({ orderId });

      const body = {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_fail1',
              order_id: 'order_mockRP1',
              amount: 70000,
              error_description: 'Card declined',
            },
          },
        },
      };
      const { raw, signature } = signWebhookBody(
        body,
        process.env.RAZORPAY_WEBHOOK_SECRET as string,
      );

      const res = await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', 'evt_fail1')
        .send(raw);

      expect(res.status).toBe(200);
      const order = await Order.findById(orderId);
      expect(order?.status).toBe('payment_failed');
      // Stock decremented at order creation must be released on failure.
      const product = await Product.findById(order?.items[0]?.product);
      expect(product?.stock).toBe(10);
    });
  });

  describe('refund', () => {
    it('lets an admin refund a paid order via the Razorpay API', async () => {
      const refund = jest.fn().mockResolvedValue({ id: 'rfnd_admin1', amount: 100000 });
      mockRazorpay({ refund });
      const user = await createUser();
      const admin = await createAdmin();
      const { orderId } = await makeOrder(user.token, 1000);
      await request(app)
        .post('/api/v1/payments/create-order')
        .set(authHeader(user.token))
        .send({ orderId });

      const razorpayPaymentId = 'pay_forRefund';
      const signature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
        .update(`order_mockRP1|${razorpayPaymentId}`)
        .digest('hex');
      await request(app).post('/api/v1/payments/verify').set(authHeader(user.token)).send({
        razorpayOrderId: 'order_mockRP1',
        razorpayPaymentId,
        razorpaySignature: signature,
      });

      const res = await request(app)
        .post(`/api/v1/payments/${orderId}/refund`)
        .set(authHeader(admin.token))
        .send({ reason: 'Customer requested cancellation' });

      expect(res.status).toBe(200);
      expect(res.body.data.order.payment.refund.razorpayRefundId).toBe('rfnd_admin1');
      expect(res.body.data.order.status).toBe('cancelled');
      expect(refund).toHaveBeenCalledWith(razorpayPaymentId, {});
    });
  });
});
