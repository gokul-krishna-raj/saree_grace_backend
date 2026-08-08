import { slugify } from '../../src/utils/slugify';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Blue Cotton Saree')).toBe('blue-cotton-saree');
  });

  it('strips punctuation', () => {
    expect(slugify("Women's Silk Saree!")).toBe('women-s-silk-saree');
  });

  it('collapses repeated separators', () => {
    expect(slugify('Red   &&  Gold')).toBe('red-gold');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  -Saree-  ')).toBe('saree');
  });
});
