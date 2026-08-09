import { ReturnStatus } from '../../models/ReturnRequest';
import { ApiError } from '../../utils/ApiError';

// Mirrors order/orderStateMachine.ts's allow-list pattern.
const ALLOWED_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['picked_up'],
  rejected: [],
  picked_up: ['completed'],
  completed: [],
};

export function assertValidReturnTransition(from: ReturnStatus, to: ReturnStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(`Cannot transition return request from "${from}" to "${to}"`);
  }
}
