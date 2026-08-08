import {
  assertValidTransition,
  STOCK_RESTORING_STATUSES,
} from '../../src/modules/order/orderStateMachine';

describe('order state machine', () => {
  it('allows the documented happy path', () => {
    expect(() => assertValidTransition('pending', 'paid')).not.toThrow();
    expect(() => assertValidTransition('paid', 'processing')).not.toThrow();
    expect(() => assertValidTransition('processing', 'shipped')).not.toThrow();
    expect(() => assertValidTransition('shipped', 'delivered')).not.toThrow();
  });

  it('allows cancellation from pending, paid, and processing', () => {
    expect(() => assertValidTransition('pending', 'cancelled')).not.toThrow();
    expect(() => assertValidTransition('paid', 'cancelled')).not.toThrow();
    expect(() => assertValidTransition('processing', 'cancelled')).not.toThrow();
  });

  it('rejects skipping states', () => {
    expect(() => assertValidTransition('pending', 'shipped')).toThrow();
    expect(() => assertValidTransition('pending', 'delivered')).toThrow();
  });

  it('rejects transitions out of terminal states', () => {
    expect(() => assertValidTransition('delivered', 'paid')).toThrow();
    expect(() => assertValidTransition('cancelled', 'pending')).toThrow();
  });

  it('allows retrying payment after a failure', () => {
    expect(() => assertValidTransition('payment_failed', 'pending')).not.toThrow();
  });

  it('marks cancelled and payment_failed as stock-restoring', () => {
    expect(STOCK_RESTORING_STATUSES).toEqual(
      expect.arrayContaining(['cancelled', 'payment_failed']),
    );
    expect(STOCK_RESTORING_STATUSES).not.toContain('delivered');
  });
});
