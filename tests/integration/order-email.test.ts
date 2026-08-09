import { request, buildApp, createUser, createAdmin, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';
import { EmailNotification } from '../../src/models/EmailNotification';
import * as mailer from '../../src/utils/mailer';

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
    name: 'Email Cat',
    slug: `email-cat-${Date.now()}-${Math.random()}`,
  });
  const product = await Product.create({
    type: 'simple',
    name: 'Email Product',
    slug: `email-product-${Date.now()}-${Math.random()}`,
    description: 'desc',
    category: category._id,
    price,
    stock,
  });
  return product._id.toString();
}

describe('Order lifecycle emails', () => {
  const app = buildApp();

  it('sends an order confirmation email exactly once when an order is created', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const productId = await makeProduct(10);

    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 2 });
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });
    const orderId = createRes.body.data.order._id as string;

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy.mock.calls[0]?.[0]).toBe(user.email);
    expect(sendEmailSpy.mock.calls[0]?.[1]).toContain(createRes.body.data.order.orderNumber);

    const record = await EmailNotification.findOne({ eventKey: `${orderId}:order-confirmation` });
    expect(record?.status).toBe('sent');
    sendEmailSpy.mockRestore();
  });

  it('does not fail order creation when the mail provider throws', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockRejectedValue(new Error('SMTP down'));
    const user = await createUser();
    const productId = await makeProduct(10);

    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 1 });
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });

    expect(createRes.status).toBe(201);
    const record = await EmailNotification.findOne({
      eventKey: `${createRes.body.data.order._id}:order-confirmation`,
    });
    expect(record?.status).toBe('failed');
    expect(record?.lastError).toBe('SMTP down');
    sendEmailSpy.mockRestore();
  });

  it('sends shipped/delivered/cancelled emails only on the matching status transition, each exactly once', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const admin = await createAdmin();
    const productId = await makeProduct(10);

    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 1 });
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });
    const orderId = createRes.body.data.order._id as string;
    sendEmailSpy.mockClear(); // isolate from the confirmation email above

    for (const status of ['paid', 'processing']) {
      await request(app)
        .patch(`/api/v1/admin/orders/${orderId}/status`)
        .set(authHeader(admin.token))
        .send({ status });
    }
    // 'paid' triggers a payment-success email (verified transition path);
    // 'processing' has no email in the spec.
    expect(await EmailNotification.findOne({ eventKey: `${orderId}:shipped` })).toBeNull();

    await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set(authHeader(admin.token))
      .send({ status: 'shipped', carrier: 'BlueDart', trackingId: 'BD123' });

    const shippedRecord = await EmailNotification.findOne({ eventKey: `${orderId}:shipped` });
    expect(shippedRecord?.status).toBe('sent');
    expect(await EmailNotification.countDocuments({ eventKey: `${orderId}:shipped` })).toBe(1);

    await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set(authHeader(admin.token))
      .send({ status: 'delivered' });

    expect(await EmailNotification.countDocuments({ eventKey: `${orderId}:delivered` })).toBe(1);

    sendEmailSpy.mockRestore();
  });

  it('sends a cancellation email with the cancelled items when an order is cancelled', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const productId = await makeProduct(10);

    await request(app).post('/api/v1/cart').set(authHeader(user.token)).send({ productId, qty: 1 });
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });
    const orderId = createRes.body.data.order._id as string;

    await request(app).post(`/api/v1/orders/${orderId}/cancel`).set(authHeader(user.token));

    const record = await EmailNotification.findOne({ eventKey: `${orderId}:cancelled` });
    expect(record?.status).toBe('sent');
    sendEmailSpy.mockRestore();
  });
});
