import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../../src/utils/tokens';

describe('tokens', () => {
  it('signs and verifies an access token round trip', () => {
    const token = signAccessToken('user123', 'customer');
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user123');
    expect(payload.role).toBe('customer');
    expect(payload.tokenType).toBe('access');
  });

  it('signs and verifies a refresh token round trip', () => {
    const token = signRefreshToken('user123', 'admin', 'jti-1');
    const payload = verifyRefreshToken(token);
    expect(payload.jti).toBe('jti-1');
    expect(payload.tokenType).toBe('refresh');
  });

  it('rejects an access token verified as a refresh token', () => {
    const token = signAccessToken('user123', 'customer');
    expect(() => verifyRefreshToken(token)).toThrow();
  });

  it('produces a stable, deterministic hash for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});
