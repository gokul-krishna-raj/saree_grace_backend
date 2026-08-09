import { request, buildApp, createUser, createAdmin, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';
import { EmailNotification } from '../../src/models/EmailNotification';
import * as mailer from '../../src/utils/mailer';

const shippingAddress = {
  fullName: 'Returner',
  phone: '9876543210',
  line1: '1 Return Rd',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600001',
  country: 'India',
};

async function makeDeliveredOrder(
  app: ReturnType<typeof buildApp>,
  userToken: string,
  adminToken: string,
): Promise<{ orderId: string; productId: string }> {
  const category = await Category.create({
    name: 'Return Cat',
    slug: `return-cat-${Date.now()}-${Math.random()}`,
  });
  const product = await Product.create({
    type: 'simple',
    name: 'Return Product',
    slug: `return-product-${Date.now()}-${Math.random()}`,
    description: 'desc',
    category: category._id,
    price: 500,
    stock: 10,
  });
  await request(app)
    .post('/api/v1/cart')
    .set(authHeader(userToken))
    .send({ productId: product._id.toString(), qty: 2 });
  const createRes = await request(app)
    .post('/api/v1/orders')
    .set(authHeader(userToken))
    .send({ shippingAddress });
  const orderId = createRes.body.data.order._id as string;

  for (const status of ['paid', 'processing', 'shipped', 'delivered']) {
    await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set(authHeader(adminToken))
      .send({ status });
  }
  return { orderId, productId: product._id.toString() };
}

describe('Return / exchange requests', () => {
  const app = buildApp();

  it('rejects a return request for an order that has not been delivered', async () => {
    const user = await createUser();
    const category = await Category.create({ name: 'RC', slug: `rc-${Date.now()}` });
    const product = await Product.create({
      type: 'simple',
      name: 'Undelivered Product',
      slug: `undelivered-${Date.now()}`,
      description: 'desc',
      category: category._id,
      price: 500,
      stock: 5,
    });
    await request(app)
      .post('/api/v1/cart')
      .set(authHeader(user.token))
      .send({ productId: product._id.toString(), qty: 1 });
    const createRes = await request(app)
      .post('/api/v1/orders')
      .set(authHeader(user.token))
      .send({ shippingAddress });

    const res = await request(app)
      .post('/api/v1/returns')
      .set(authHeader(user.token))
      .send({
        orderId: createRes.body.data.order._id,
        type: 'return',
        items: [{ product: product._id.toString(), qty: 1 }],
        reason: 'Changed my mind',
      });

    expect(res.status).toBe(409);
  });

  it('runs the full requested -> approved -> picked_up -> completed lifecycle, emailing at each step', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const admin = await createAdmin();
    const { orderId, productId } = await makeDeliveredOrder(app, user.token, admin.token);
    sendEmailSpy.mockClear();

    const createRes = await request(app)
      .post('/api/v1/returns')
      .set(authHeader(user.token))
      .send({
        orderId,
        type: 'return',
        items: [{ product: productId, qty: 1 }],
        reason: 'Wrong size',
      });
    expect(createRes.status).toBe(201);
    const returnId = createRes.body.data.returnRequest._id as string;
    expect((await EmailNotification.findOne({ eventKey: `${returnId}:requested` }))?.status).toBe(
      'sent',
    );

    for (const status of ['approved', 'picked_up', 'completed']) {
      const res = await request(app)
        .patch(`/api/v1/admin/returns/${returnId}/status`)
        .set(authHeader(admin.token))
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body.data.returnRequest.status).toBe(status);
      expect((await EmailNotification.findOne({ eventKey: `${returnId}:${status}` }))?.status).toBe(
        'sent',
      );
    }

    sendEmailSpy.mockRestore();
  });

  it('rejects an invalid transition (e.g. requested -> picked_up)', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const admin = await createAdmin();
    const { orderId, productId } = await makeDeliveredOrder(app, user.token, admin.token);

    const createRes = await request(app)
      .post('/api/v1/returns')
      .set(authHeader(user.token))
      .send({
        orderId,
        type: 'exchange',
        items: [{ product: productId, qty: 1 }],
        reason: 'Wrong color',
      });
    const returnId = createRes.body.data.returnRequest._id as string;

    const res = await request(app)
      .patch(`/api/v1/admin/returns/${returnId}/status`)
      .set(authHeader(admin.token))
      .send({ status: 'picked_up' });

    expect(res.status).toBe(409);
    sendEmailSpy.mockRestore();
  });

  it('sends a rejection email carrying the admin note as the reason', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const admin = await createAdmin();
    const { orderId, productId } = await makeDeliveredOrder(app, user.token, admin.token);

    const createRes = await request(app)
      .post('/api/v1/returns')
      .set(authHeader(user.token))
      .send({
        orderId,
        type: 'return',
        items: [{ product: productId, qty: 1 }],
        reason: 'Damaged item',
      });
    const returnId = createRes.body.data.returnRequest._id as string;
    sendEmailSpy.mockClear();

    const res = await request(app)
      .patch(`/api/v1/admin/returns/${returnId}/status`)
      .set(authHeader(admin.token))
      .send({ status: 'rejected', adminNote: 'Item shows signs of use' });

    expect(res.status).toBe(200);
    const html = sendEmailSpy.mock.calls.at(-1)?.[2] as string;
    expect(html).toContain('Item shows signs of use');
    sendEmailSpy.mockRestore();
  });
});
