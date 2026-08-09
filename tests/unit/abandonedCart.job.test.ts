import mongoose from 'mongoose';
import * as mailer from '../../src/utils/mailer';
import { Cart } from '../../src/models/Cart';
import { Product } from '../../src/models/Product';
import { Category } from '../../src/models/Category';
import { Order } from '../../src/models/Order';
import { EmailNotification } from '../../src/models/EmailNotification';
import { createUser } from '../helpers';
import { runAbandonedCartJob } from '../../src/modules/email/abandonedCart.job';

const STALE_HOURS = 25; // > default ABANDONED_CART_DELAY_HOURS (24)

async function makeProduct(): Promise<mongoose.Types.ObjectId> {
  const category = await Category.create({
    name: 'Cart Cat',
    slug: `cart-cat-${Date.now()}-${Math.random()}`,
  });
  const product = await Product.create({
    type: 'simple',
    name: 'Cart Product',
    slug: `cart-product-${Date.now()}-${Math.random()}`,
    description: 'desc',
    category: category._id,
    price: 500,
    stock: 10,
  });
  return product._id;
}

async function makeStaleCart(
  userId: string,
  productId: mongoose.Types.ObjectId,
  hoursOld = STALE_HOURS,
): Promise<mongoose.Types.ObjectId> {
  const cart = await Cart.create({
    user: userId,
    items: [
      {
        product: productId,
        variantId: null,
        qty: 2,
        priceSnapshot: 500,
        nameSnapshot: 'Cart Product',
      },
    ],
  });
  const staleDate = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
  // Mongoose strips updatedAt from Model-level update queries — go through
  // the raw driver collection to backdate it, same pattern used for Otp in
  // auth.test.ts.
  await Cart.collection.updateOne({ _id: cart._id }, { $set: { updatedAt: staleDate } });
  return cart._id;
}

describe('abandoned cart job', () => {
  it('does not send anything for an empty cart', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const cart = await Cart.create({ user: user.id, items: [] });
    await Cart.collection.updateOne(
      { _id: cart._id },
      { $set: { updatedAt: new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000) } },
    );

    const result = await runAbandonedCartJob();

    expect(result.scanned).toBe(0);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
  });

  it('does not send a reminder for a cart that is not yet stale', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser();
    const productId = await makeProduct();
    await Cart.create({
      user: user.id,
      items: [
        {
          product: productId,
          variantId: null,
          qty: 1,
          priceSnapshot: 500,
          nameSnapshot: 'Cart Product',
        },
      ],
    });

    const result = await runAbandonedCartJob();

    expect(result.sent).toBe(0);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
  });

  it('sends one reminder for a stale cart belonging to a verified, active, opted-in user', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser({ isVerified: true });
    const productId = await makeProduct();
    await makeStaleCart(user.id, productId);

    const result = await runAbandonedCartJob();

    expect(result.sent).toBe(1);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy.mock.calls[0]?.[0]).toBe(user.email);
    sendEmailSpy.mockRestore();
  });

  it('does not send a second reminder for the same cart state on a later run', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser({ isVerified: true });
    const productId = await makeProduct();
    await makeStaleCart(user.id, productId);

    await runAbandonedCartJob();
    sendEmailSpy.mockClear();
    const second = await runAbandonedCartJob();

    expect(second.sent).toBe(0);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
  });

  it('skips a user who has opted out of non-transactional email', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser({ isVerified: true });
    await (
      await import('../../src/models/User')
    ).User.updateOne({ _id: user.id }, { $set: { marketingOptOut: true } });
    const productId = await makeProduct();
    await makeStaleCart(user.id, productId);

    const result = await runAbandonedCartJob();

    expect(result.sent).toBe(0);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
  });

  it('skips an unverified user', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser({ isVerified: false });
    const productId = await makeProduct();
    await makeStaleCart(user.id, productId);

    const result = await runAbandonedCartJob();

    expect(result.sent).toBe(0);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
  });

  it('skips a cart when the customer has already placed an order since it went stale', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser({ isVerified: true });
    const productId = await makeProduct();
    await makeStaleCart(user.id, productId);

    await Order.create({
      orderNumber: `SG-TEST-${Date.now()}`,
      user: user.id,
      items: [
        {
          product: productId,
          variantId: null,
          nameSnapshot: 'Cart Product',
          priceSnapshot: 500,
          qty: 1,
        },
      ],
      shippingAddress: {
        fullName: 'Test',
        phone: '9876543210',
        line1: '1 St',
        city: 'Chennai',
        state: 'TN',
        postalCode: '600001',
        country: 'India',
      },
      itemsTotal: 500,
      shippingFee: 0,
      total: 500,
      status: 'pending',
      statusHistory: [{ status: 'pending', changedAt: new Date() }],
    });

    const result = await runAbandonedCartJob();

    expect(result.sent).toBe(0);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
  });

  it('records an EmailNotification for every reminder actually sent', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const user = await createUser({ isVerified: true });
    const productId = await makeProduct();
    const cartId = await makeStaleCart(user.id, productId);

    await runAbandonedCartJob();

    const record = await EmailNotification.findOne({ emailType: 'abandoned-cart' });
    expect(record?.status).toBe('sent');
    expect(record?.eventKey).toContain(cartId.toString());
    sendEmailSpy.mockRestore();
  });
});
