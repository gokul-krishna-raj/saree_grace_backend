import { getLoomLabel } from '../../src/utils/loomLabel';

describe('getLoomLabel', () => {
  it('returns "Handloom" for handloom', () => {
    expect(getLoomLabel('handloom')).toBe('Handloom');
  });

  it('returns "Powerloom" for powerloom', () => {
    expect(getLoomLabel('powerloom')).toBe('Powerloom');
  });

  it('returns null for unknown', () => {
    expect(getLoomLabel('unknown')).toBeNull();
  });
});
