import type { LoomType } from '../models/Product';

// No badge is shown for 'unknown' — loom origin must be verified per-product,
// never assumed from name, fabric, or region.
export function getLoomLabel(loomType: LoomType): string | null {
  switch (loomType) {
    case 'handloom':
      return 'Handloom';
    case 'powerloom':
      return 'Powerloom';
    default:
      return null;
  }
}
