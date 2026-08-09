import { Cart } from '../../models/Cart';
import { Order } from '../../models/Order';
import { User } from '../../models/User';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { sendAbandonedCartEmail } from './email.service';

export interface AbandonedCartJobResult {
  scanned: number;
  sent: number;
  skipped: number;
}

/**
 * Meant to run on a schedule (see src/jobs/abandonedCartHandler.ts). Safe to
 * run as often as desired — sendAbandonedCartEmail()'s idempotency key
 * includes the cart's updatedAt, so a reminder only ever goes out once per
 * "cart state" no matter how often this job runs.
 */
export async function runAbandonedCartJob(): Promise<AbandonedCartJobResult> {
  const threshold = new Date(Date.now() - env.ABANDONED_CART_DELAY_HOURS * 60 * 60 * 1000);
  const carts = await Cart.find({
    'items.0': { $exists: true },
    updatedAt: { $lte: threshold },
  });

  let sent = 0;
  let skipped = 0;

  for (const cart of carts) {
    const user = await User.findById(cart.user);
    if (!user || !user.isActive || !user.isVerified || user.marketingOptOut) {
      skipped += 1;
      continue;
    }

    // Approximation of "hasn't already ordered these products" — if the
    // customer placed any order after this cart was last touched, assume
    // they've already acted on it rather than diffing individual items.
    const hasOrderedSince = await Order.exists({
      user: cart.user,
      createdAt: { $gt: cart.updatedAt },
    });
    if (hasOrderedSince) {
      skipped += 1;
      continue;
    }

    const cartTotal = cart.items.reduce((sum, item) => sum + item.priceSnapshot * item.qty, 0);

    const result = await sendAbandonedCartEmail({
      recipientEmail: user.email,
      userId: user._id.toString(),
      cartId: cart._id.toString(),
      cartUpdatedAtMs: cart.updatedAt.getTime(),
      customerName: user.name,
      items: cart.items.map((item) => ({
        name: item.nameSnapshot,
        image: item.imageSnapshot,
        price: item.priceSnapshot,
        qty: item.qty,
      })),
      cartTotal,
      cartUrl: `${env.APP_URL}/cart`,
    });

    if (result.sent) sent += 1;
    else skipped += 1;
  }

  logger.info('Abandoned cart job finished', { scanned: carts.length, sent, skipped });
  return { scanned: carts.length, sent, skipped };
}
