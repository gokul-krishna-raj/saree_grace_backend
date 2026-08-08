import { OrderStatus } from '../../models/Order';
import { ApiError } from '../../utils/ApiError';

/**
 * Explicit allow-list of transitions — the only way an order's status
 * changes. Anything not listed here is rejected, so status can never be
 * free-form-updated into an invalid sequence (e.g. delivered -> pending).
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'payment_failed', 'cancelled'],
  payment_failed: ['pending', 'cancelled'],
  paid: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

// Transitioning INTO these statuses means stock that was decremented at
// order creation must be returned to inventory.
export const STOCK_RESTORING_STATUSES: OrderStatus[] = ['cancelled', 'payment_failed'];

export function assertValidTransition(from: OrderStatus, to: OrderStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(`Cannot transition order from "${from}" to "${to}"`);
  }
}
