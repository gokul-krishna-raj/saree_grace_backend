import { assertSeedAllowed, isProductionDatabase } from '../../src/seed/productionGuard';

const PROD = 'mongodb+srv://u:p@sareegrace.04wvuqd.mongodb.net/sareegrace';
const LOCAL = 'mongodb://127.0.0.1:27017/sareegrace';

describe('seed production guard', () => {
  it('recognises the production cluster', () => {
    expect(isProductionDatabase(PROD)).toBe(true);
    expect(isProductionDatabase(LOCAL)).toBe(false);
  });

  it('refuses to seed production without FORCE_SEED=yes', () => {
    expect(() => assertSeedAllowed(PROD, 'seed', undefined)).toThrow(/PRODUCTION/);
    expect(() => assertSeedAllowed(PROD, 'seed', 'true')).toThrow(/PRODUCTION/);
  });

  it('allows production only with FORCE_SEED=yes, and any other database freely', () => {
    expect(() => assertSeedAllowed(PROD, 'seed', 'yes')).not.toThrow();
    expect(() => assertSeedAllowed(LOCAL, 'seed', undefined)).not.toThrow();
  });
});
