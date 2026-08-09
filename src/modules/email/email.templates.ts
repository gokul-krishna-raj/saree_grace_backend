import { layout } from '../../utils/emailTemplates';
import {
  AbandonedCartEmailData,
  OrderCancelledEmailData,
  OrderConfirmationEmailData,
  OrderDeliveredEmailData,
  OrderShippedEmailData,
  PasswordResetEmailData,
  PaymentFailedEmailData,
  PaymentSuccessEmailData,
  RefundCompletedEmailData,
  RefundInitiatedEmailData,
  ReturnExchangeStatusEmailData,
  VerificationEmailData,
} from './email.types';

// These two exist only so the email module exposes the full documented
// sendVerificationEmail/sendPasswordResetEmail API surface. The real signup
// (OTP-based) and password-reset (link-based) flows already live in
// auth.service.ts, are fully tested, and are intentionally left untouched —
// see CLAUDE.md / the implementation report for why. Nothing in this
// codebase currently calls these two.
export function verificationEmailTemplate(
  data: VerificationEmailData,
  brandName: string,
): { subject: string; html: string } {
  const subject = `Verify your ${brandName} email address`;
  const html = layout(
    'Verify your email',
    `<p>Hi ${data.customerName},</p>
     <p>Please confirm your email address to finish setting up your ${brandName} account.</p>
     <p style="margin:24px 0;">
       <a href="${data.verificationUrl}" style="background-color:#7a1f2b;color:#ffffff;padding:12px 24px;border-radius:4px;text-decoration:none;display:inline-block;">Verify email</a>
     </p>
     <p style="color:#6b6b6b;font-size:13px;">Or copy this link into your browser: ${data.verificationUrl}</p>`,
  );
  return { subject, html };
}

export function passwordResetLinkEmailTemplate(
  data: PasswordResetEmailData,
  brandName: string,
): { subject: string; html: string } {
  const subject = `Reset your ${brandName} password`;
  const html = layout(
    'Reset your password',
    `<p>Hi ${data.customerName},</p>
     <p>We received a request to reset your password. This link is valid for ${data.expiresInMinutes} minutes.</p>
     <p style="margin:24px 0;">
       <a href="${data.resetUrl}" style="background-color:#7a1f2b;color:#ffffff;padding:12px 24px;border-radius:4px;text-decoration:none;display:inline-block;">Reset password</a>
     </p>
     <p style="color:#6b6b6b;font-size:13px;">Or copy this link into your browser: ${data.resetUrl}</p>`,
  );
  return { subject, html };
}

function money(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0;">
    <a href="${url}" style="background-color:#7a1f2b;color:#ffffff;padding:12px 24px;border-radius:4px;text-decoration:none;display:inline-block;">${label}</a>
  </p>`;
}

function supportFooter(supportEmail: string): string {
  return `<p style="color:#6b6b6b;font-size:13px;margin-top:24px;">Need help? Contact us at <a href="mailto:${supportEmail}" style="color:#7a1f2b;">${supportEmail}</a>.</p>`;
}

export function orderConfirmationEmailTemplate(
  data: OrderConfirmationEmailData,
  supportEmail: string,
): { subject: string; html: string } {
  const subject = `Order confirmed: ${data.orderNumber}`;
  const rows = data.items
    .map(
      (item) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;">${item.name}${item.image ? `<br/><img src="${item.image}" width="60" style="margin-top:4px;border-radius:4px;" />` : ''}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center;">${item.qty}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${money(item.unitPrice)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${money(item.subtotal)}</td>
      </tr>`,
    )
    .join('');

  const html = layout(
    'Order confirmed',
    `<p>Hi ${data.customerName},</p>
     <p>Thank you for your order! Here are the details of order <strong>${data.orderNumber}</strong>, placed on ${formatDate(data.orderDate)}.</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px;">
       <thead><tr>
         <th style="text-align:left;padding-bottom:8px;">Item</th>
         <th style="text-align:center;padding-bottom:8px;">Qty</th>
         <th style="text-align:right;padding-bottom:8px;">Price</th>
         <th style="text-align:right;padding-bottom:8px;">Subtotal</th>
       </tr></thead>
       <tbody>${rows}</tbody>
     </table>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
       <tr><td>Items total</td><td style="text-align:right;">${money(data.itemsTotal)}</td></tr>
       <tr><td>Shipping</td><td style="text-align:right;">${data.shippingFee === 0 ? 'Free' : money(data.shippingFee)}</td></tr>
       ${data.discount ? `<tr><td>Discount</td><td style="text-align:right;">-${money(data.discount)}</td></tr>` : ''}
       ${data.tax ? `<tr><td>Tax</td><td style="text-align:right;">${money(data.tax)}</td></tr>` : ''}
       <tr><td style="font-weight:bold;padding-top:8px;">Grand total</td><td style="text-align:right;font-weight:bold;padding-top:8px;">${money(data.total)}</td></tr>
     </table>
     <p style="margin-top:16px;">Payment method: ${data.paymentMethod ?? 'Not specified'}<br/>Payment status: ${data.paymentStatus}</p>
     <p>Delivery address:<br/>${data.deliveryAddressLines.join('<br/>')}</p>
     ${data.estimatedDelivery ? `<p>Estimated delivery: ${data.estimatedDelivery}</p>` : ''}
     ${button(data.viewOrderUrl, 'View your order')}
     ${supportFooter(supportEmail)}`,
  );
  return { subject, html };
}

export function paymentSuccessEmailTemplate(data: PaymentSuccessEmailData): {
  subject: string;
  html: string;
} {
  const subject = `Payment received for order ${data.orderNumber}`;
  const html = layout(
    'Payment received',
    `<p>Hi ${data.customerName},</p>
     <p>We've received your payment of <strong>${money(data.amount)}</strong> for order <strong>${data.orderNumber}</strong>.</p>
     <p>Payment method: ${data.paymentMethod ?? 'Not specified'}<br/>
        Transaction ID: ${data.transactionId}<br/>
        Payment date: ${formatDate(data.paymentDate)}</p>
     ${button(data.viewOrderUrl, 'View your order')}`,
  );
  return { subject, html };
}

export function paymentFailedEmailTemplate(
  data: PaymentFailedEmailData,
  supportEmail: string,
): { subject: string; html: string } {
  const subject = `Payment failed for order ${data.orderNumber}`;
  const html = layout(
    'Payment failed',
    `<p>Hi ${data.customerName},</p>
     <p>Your payment of <strong>${money(data.amount)}</strong> for order <strong>${data.orderNumber}</strong> could not be completed.</p>
     ${data.failureReason ? `<p>Reason: ${data.failureReason}</p>` : ''}
     ${button(data.retryPaymentUrl, 'Retry payment')}
     ${supportFooter(supportEmail)}`,
  );
  return { subject, html };
}

export function orderShippedEmailTemplate(data: OrderShippedEmailData): {
  subject: string;
  html: string;
} {
  const subject = `Your order ${data.orderNumber} has been shipped`;
  const html = layout(
    'Your order is on its way',
    `<p>Hi ${data.customerName},</p>
     <p>Order <strong>${data.orderNumber}</strong> was shipped on ${formatDate(data.shippedDate)}${data.carrier ? ` via ${data.carrier}` : ''}.</p>
     ${data.trackingId ? `<p>Tracking number: ${data.trackingId}</p>` : ''}
     ${data.estimatedDeliveryDate ? `<p>Expected delivery: ${data.estimatedDeliveryDate}</p>` : ''}
     ${data.trackingUrl ? button(data.trackingUrl, 'Track your shipment') : ''}
     ${button(data.viewOrderUrl, 'View your order')}`,
  );
  return { subject, html };
}

export function orderDeliveredEmailTemplate(
  data: OrderDeliveredEmailData,
  supportEmail: string,
): { subject: string; html: string } {
  const subject = `Your order ${data.orderNumber} has been delivered`;
  const html = layout(
    'Delivered!',
    `<p>Hi ${data.customerName},</p>
     <p>Order <strong>${data.orderNumber}</strong> was delivered on ${formatDate(data.deliveredDate)}. We hope you love it!</p>
     ${data.returnInfo ? `<p>${data.returnInfo}</p>` : ''}
     ${button(data.viewOrderUrl, 'View your order')}
     ${data.reviewUrl ? button(data.reviewUrl, 'Leave a review') : ''}
     ${supportFooter(supportEmail)}`,
  );
  return { subject, html };
}

export function orderCancelledEmailTemplate(
  data: OrderCancelledEmailData,
  supportEmail: string,
): { subject: string; html: string } {
  const subject = `Order ${data.orderNumber} cancelled`;
  const itemList = data.cancelledItems.map((i) => `<li>${i.name} &times; ${i.qty}</li>`).join('');
  const html = layout(
    'Order cancelled',
    `<p>Hi ${data.customerName},</p>
     <p>Order <strong>${data.orderNumber}</strong> was cancelled on ${formatDate(data.cancelledDate)}.</p>
     <ul>${itemList}</ul>
     ${data.cancellationReason ? `<p>Reason: ${data.cancellationReason}</p>` : ''}
     ${
       data.refundAmount
         ? `<p>Refund amount: ${money(data.refundAmount)}${data.refundStatus ? ` (${data.refundStatus})` : ''}</p>`
         : ''
     }
     ${supportFooter(supportEmail)}`,
  );
  return { subject, html };
}

export function refundInitiatedEmailTemplate(
  data: RefundInitiatedEmailData,
  supportEmail: string,
): { subject: string; html: string } {
  const subject = `Refund initiated for order ${data.orderNumber}`;
  const html = layout(
    'Refund initiated',
    `<p>Hi ${data.customerName},</p>
     <p>We've initiated a refund of <strong>${money(data.refundAmount)}</strong> for order <strong>${data.orderNumber}</strong>. This has not completed yet — we'll email you again once it does.</p>
     <p>Refund reference: ${data.refundReferenceId}<br/>Status: ${data.refundStatus}</p>
     ${data.refundReason ? `<p>Reason: ${data.refundReason}</p>` : ''}
     ${data.expectedProcessing ? `<p>${data.expectedProcessing}</p>` : ''}
     ${supportFooter(supportEmail)}`,
  );
  return { subject, html };
}

export function refundCompletedEmailTemplate(
  data: RefundCompletedEmailData,
  supportEmail: string,
): { subject: string; html: string } {
  const subject = `Refund completed for order ${data.orderNumber}`;
  const html = layout(
    'Refund completed',
    `<p>Hi ${data.customerName},</p>
     <p>Your refund of <strong>${money(data.refundAmount)}</strong> for order <strong>${data.orderNumber}</strong> is complete.</p>
     <p>Refund reference: ${data.refundReferenceId}<br/>
        ${data.paymentMethod ? `Refunded to: ${data.paymentMethod}<br/>` : ''}
        Completed on: ${formatDate(data.completionDate)}</p>
     ${supportFooter(supportEmail)}`,
  );
  return { subject, html };
}

const RETURN_STATUS_COPY: Record<string, { title: string; message: string }> = {
  requested: {
    title: 'Request received',
    message: 'We’ve received your request and will review it shortly.',
  },
  approved: {
    title: 'Request approved',
    message: 'Your request has been approved. We’ll share pickup details shortly.',
  },
  rejected: {
    title: 'Request rejected',
    message: 'Unfortunately, we were unable to approve your request.',
  },
  picked_up: {
    title: 'Item picked up',
    message: 'We’ve picked up your item and it’s on its way to us.',
  },
  completed: {
    title: 'Request completed',
    message: 'Your return/exchange has been completed.',
  },
};

export function returnExchangeStatusEmailTemplate(
  data: ReturnExchangeStatusEmailData,
  supportEmail: string,
): { subject: string; html: string } {
  const subject = 'Update on your return or exchange request';
  const copy = RETURN_STATUS_COPY[data.status] ?? { title: 'Status update', message: '' };
  const itemList = data.itemNames.map((n) => `<li>${n}</li>`).join('');
  const html = layout(
    copy.title,
    `<p>Hi ${data.customerName},</p>
     <p>${copy.message}</p>
     <p>Order: ${data.orderNumber}<br/>Request ID: ${data.returnId}<br/>Current status: <strong>${data.status}</strong></p>
     <ul>${itemList}</ul>
     ${data.rejectionReason ? `<p>Reason: ${data.rejectionReason}</p>` : ''}
     <p>${data.nextSteps}</p>
     ${supportFooter(supportEmail)}`,
  );
  return { subject, html };
}

export function abandonedCartEmailTemplate(
  data: AbandonedCartEmailData,
  supportEmail: string,
): { subject: string; html: string } {
  const subject = 'You left items in your Saree Grace cart';
  const rows = data.items
    .map(
      (item) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;">${item.name}${item.image ? `<br/><img src="${item.image}" width="60" style="margin-top:4px;border-radius:4px;" />` : ''}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center;">${item.qty}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${money(item.price)}</td>
      </tr>`,
    )
    .join('');
  const html = layout(
    'You left something behind',
    `<p>Hi ${data.customerName},</p>
     <p>You still have items waiting in your cart:</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px;">
       <tbody>${rows}</tbody>
     </table>
     <p style="font-weight:bold;">Cart total: ${money(data.cartTotal)}</p>
     ${button(data.cartUrl, 'Return to your cart')}
     ${supportFooter(supportEmail)}`,
  );
  return { subject, html };
}
