/**
 * The Atlas cluster behind the `dev` stage (`sareegrace.04wvuqd`) is the live
 * database for www.sareegrace.in — see "Environment reality" in
 * docs/deployment.md. Seed scripts upsert demo users/products, so they refuse
 * to touch it unless explicitly forced with FORCE_SEED=yes.
 */
export const PRODUCTION_CLUSTER_MARKER = '04wvuqd';

export function isProductionDatabase(uri: string): boolean {
  return uri.includes(PRODUCTION_CLUSTER_MARKER);
}

/** Throws (before any connection is opened) when `uri` is production and FORCE_SEED !== 'yes'. */
export function assertSeedAllowed(
  uri: string,
  scriptName: string,
  force = process.env.FORCE_SEED,
): void {
  if (isProductionDatabase(uri) && force !== 'yes') {
    throw new Error(
      `${scriptName} refused: MONGODB_URI points at the PRODUCTION cluster ` +
        `(${PRODUCTION_CLUSTER_MARKER}). Point it at a local/staging database, ` +
        'or set FORCE_SEED=yes if you really mean to write demo data to production.',
    );
  }
}
