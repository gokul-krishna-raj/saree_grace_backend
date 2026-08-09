import { Types } from 'mongoose';
import * as mailer from '../../src/utils/mailer';
import { logger } from '../../src/utils/logger';
import { EmailNotification } from '../../src/models/EmailNotification';
import {
  sendOrderConfirmationEmail,
  sendPaymentSuccessEmail,
} from '../../src/modules/email/email.service';
import {
  OrderConfirmationEmailData,
  PaymentSuccessEmailData,
} from '../../src/modules/email/email.types';

function baseOrderConfirmation(orderId: string): OrderConfirmationEmailData {
  return {
    recipientEmail: 'customer@example.com',
    orderId,
    customerName: 'Jane Doe',
    orderNumber: 'SG-TEST-001',
    orderDate: new Date(),
    items: [{ name: 'Silk Saree', qty: 1, unitPrice: 1000, subtotal: 1000 }],
    itemsTotal: 1000,
    shippingFee: 0,
    total: 1000,
    paymentStatus: 'pending',
    deliveryAddressLines: ['Jane Doe', '1 Main St', 'Chennai'],
    viewOrderUrl: 'https://example.com/orders/1',
  };
}

describe('email.service', () => {
  it('does not send the same email twice for the same idempotency key', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const orderId = new Types.ObjectId().toString();

    const first = await sendOrderConfirmationEmail(baseOrderConfirmation(orderId));
    const second = await sendOrderConfirmationEmail(baseOrderConfirmation(orderId));

    expect(first.sent).toBe(true);
    expect(second.skipped).toBe(true);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(
      await EmailNotification.countDocuments({ eventKey: `${orderId}:order-confirmation` }),
    ).toBe(1);
    sendEmailSpy.mockRestore();
  });

  it('records a failure and does not throw when the provider rejects', async () => {
    const sendEmailSpy = jest
      .spyOn(mailer, 'sendEmail')
      .mockRejectedValue(new Error('temporary SMTP outage'));
    const orderId = new Types.ObjectId().toString();

    const result = await sendOrderConfirmationEmail(baseOrderConfirmation(orderId));

    expect(result.sent).toBe(false);
    expect(result.error).toBe('temporary SMTP outage');
    const record = await EmailNotification.findOne({ eventKey: `${orderId}:order-confirmation` });
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(1);
    sendEmailSpy.mockRestore();
  });

  it('rejects an invalid recipient email before ever calling the provider', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const orderId = new Types.ObjectId().toString();
    const data = { ...baseOrderConfirmation(orderId), recipientEmail: 'not-an-email' };

    await expect(sendOrderConfirmationEmail(data)).rejects.toThrow();
    expect(sendEmailSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
  });

  it('rejects missing required order data (e.g. no line items) before sending', async () => {
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const orderId = new Types.ObjectId().toString();
    const data = { ...baseOrderConfirmation(orderId), items: [] };

    await expect(sendOrderConfirmationEmail(data)).rejects.toThrow();
    expect(sendEmailSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
  });

  it('never logs the email html body, only metadata', async () => {
    jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const infoSpy = jest.spyOn(logger, 'info');
    const orderId = new Types.ObjectId().toString();

    await sendOrderConfirmationEmail(baseOrderConfirmation(orderId));

    for (const call of infoSpy.mock.calls) {
      const meta = call[1];
      expect(meta).not.toHaveProperty('html');
      expect(JSON.stringify(meta ?? {})).not.toContain('<html');
    }
    infoSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('rejects an untrusted (unverified) payment success call missing a transaction id at the type level', async () => {
    // transactionId is required by the schema — this documents that a
    // frontend-only "success" (no real transaction id) cannot pass validation.
    const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
    const orderId = new Types.ObjectId().toString();
    const data: PaymentSuccessEmailData = {
      recipientEmail: 'customer@example.com',
      orderId,
      customerName: 'Jane Doe',
      orderNumber: 'SG-TEST-002',
      amount: 1000,
      transactionId: '',
      paymentDate: new Date(),
      viewOrderUrl: 'https://example.com/orders/1',
    };

    await expect(sendPaymentSuccessEmail(data)).rejects.toThrow();
    expect(sendEmailSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
  });
});
