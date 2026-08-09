import crypto from 'crypto';
import Razorpay from 'razorpay';
import { request, buildApp, createUser, createAdmin, authHeader } from '../helpers';
import { Category } from '../../src/models/Category';
import { Product } from '../../src/models/Product';
import { EmailNotification } from '../../src/models/EmailNotification';
import * as mailer from '../../src/utils/mailer';

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

async function makeOrder(userToken: string, price = 1000): Promise<{ orderId: string }> {
  const category = await Category.create({
    name: 'PayEmail Cat',
    slug: `payemail-cat-${Date.now()}-${Math.random()}`,
  });
  const product = await Product.create({
    type: 'simple',
    name: 'PayEmail Product',
    slug: `payemail-product-${Date.now()}-${Math.random()}`,
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
  return { orderId: createRes.body.data.order._id };
}

function signWebhookBody(body: unknown, secret: string): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature };
}

describe('Payment & refund emails', () => {
  const app = buildApp();

  it('sends a payment-success email only after signature-verified payment, never before', async () => {
    mockRazorpay();
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const { orderId } = await makeOrder(user.token);
    await request(app)
      .post('/api/v1/payments/create-order')
      .set(authHeader(user.token))
      .send({ orderId });

    expect(await EmailNotification.findOne({ eventKey: `${orderId}:payment-success` })).toBeNull();

    const razorpayPaymentId = 'pay_mock123';
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
      .update(`order_mockRP1|${razorpayPaymentId}`)
      .digest('hex');
    await request(app)
      .post('/api/v1/payments/verify')
      .set(authHeader(user.token))
      .send({ razorpayOrderId: 'order_mockRP1', razorpayPaymentId, razorpaySignature: signature });

    const record = await EmailNotification.findOne({ eventKey: `${orderId}:payment-success` });
    expect(record?.status).toBe('sent');
    sendEmailSpy.mockRestore();
  });

  it('never sends a payment-success email for an unverified/tampered signature', async () => {
    mockRazorpay();
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const { orderId } = await makeOrder(user.token);
    await request(app)
      .post('/api/v1/payments/create-order')
      .set(authHeader(user.token))
      .send({ orderId });

    await request(app).post('/api/v1/payments/verify').set(authHeader(user.token)).send({
      razorpayOrderId: 'order_mockRP1',
      razorpayPaymentId: 'pay_mock123',
      razorpaySignature: 'not-a-real-signature',
    });

    expect(await EmailNotification.findOne({ eventKey: `${orderId}:payment-success` })).toBeNull();
    sendEmailSpy.mockRestore();
  });

  it('sends a payment-failed email only from a real webhook payment.failed event', async () => {
    mockRazorpay();
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
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
    const { raw, signature } = signWebhookBody(body, process.env.RAZORPAY_WEBHOOK_SECRET as string);

    await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .set('x-razorpay-event-id', 'evt_fail1')
      .send(raw);

    const record = await EmailNotification.findOne({ eventKey: `${orderId}:payment-failed` });
    expect(record?.status).toBe('sent');
    sendEmailSpy.mockRestore();
  });

  it('does not send a duplicate payment-success email on a retried webhook delivery', async () => {
    mockRazorpay();
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
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
    const { raw, signature } = signWebhookBody(body, process.env.RAZORPAY_WEBHOOK_SECRET as string);

    await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .set('x-razorpay-event-id', 'evt_dup')
      .send(raw);
    sendEmailSpy.mockClear();

    await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .set('x-razorpay-event-id', 'evt_dup')
      .send(raw);

    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(await EmailNotification.countDocuments({ eventKey: `${orderId}:payment-success` })).toBe(
      1,
    );
    sendEmailSpy.mockRestore();
  });

  it('sends refund-initiated immediately and refund-completed only after a refund.processed webhook', async () => {
    const refund = jest.fn().mockResolvedValue({ id: 'rfnd_email1', amount: 100000 });
    mockRazorpay({ refund });
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const admin = await createAdmin();
    const { orderId } = await makeOrder(user.token, 1000);
    await request(app)
      .post('/api/v1/payments/create-order')
      .set(authHeader(user.token))
      .send({ orderId });

    const razorpayPaymentId = 'pay_forRefundEmail';
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
      .update(`order_mockRP1|${razorpayPaymentId}`)
      .digest('hex');
    await request(app).post('/api/v1/payments/verify').set(authHeader(user.token)).send({
      razorpayOrderId: 'order_mockRP1',
      razorpayPaymentId,
      razorpaySignature: signature,
    });

    await request(app)
      .post(`/api/v1/payments/${orderId}/refund`)
      .set(authHeader(admin.token))
      .send({ reason: 'Customer requested cancellation' });

    const initiatedRecord = await EmailNotification.findOne({
      eventKey: `${orderId}:refund-initiated`,
    });
    expect(initiatedRecord?.status).toBe('sent');
    expect(await EmailNotification.findOne({ eventKey: `${orderId}:refund-completed` })).toBeNull();

    const webhookBody = {
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_email1' } } },
    };
    const { raw, signature: webhookSig } = signWebhookBody(
      webhookBody,
      process.env.RAZORPAY_WEBHOOK_SECRET as string,
    );
    const webhookRes = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', webhookSig)
      .set('x-razorpay-event-id', 'evt_refund_processed')
      .send(raw);

    expect(webhookRes.status).toBe(200);
    const completedRecord = await EmailNotification.findOne({
      eventKey: `${orderId}:refund-completed`,
    });
    expect(completedRecord?.status).toBe('sent');
    sendEmailSpy.mockRestore();
  });
});
