import { logger } from '../../utils/logger';

// India Post's public pincode directory (free, no API key). It answers in ~1-2.5s, so results
// are cached per Lambda container — a warm container quotes repeat pincodes instantly.
const PINCODE_API_URL = 'https://api.postalpincode.in/pincode';
const LOOKUP_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;

interface PostOffice {
  State?: string;
}
interface PincodeApiResponse {
  Status?: string;
  PostOffice?: PostOffice[] | null;
}

const cache = new Map<string, { states: string[]; expiresAt: number }>();

/**
 * Resolves a 6-digit Indian pincode to the state(s) its post offices are in — usually one, but
 * a few border pincodes span two (e.g. 673310 is both Kerala and Puducherry/Mahe).
 *
 * Returns `[]` when India Post says the pincode doesn't exist, and `null` when the lookup
 * itself failed (timeout, network, unexpected payload) so callers can fall back instead of
 * blocking checkout on a third-party outage. Only definitive answers are cached.
 */
export async function lookupPincodeStates(pincode: string): Promise<string[] | null> {
  const cached = cache.get(pincode);
  if (cached && cached.expiresAt > Date.now()) return cached.states;

  try {
    const res = await fetch(`${PINCODE_API_URL}/${pincode}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = (await res.json()) as PincodeApiResponse[];
    const result = body[0];
    if (result?.Status === 'Error') return remember(pincode, []);
    if (result?.Status !== 'Success' || !Array.isArray(result.PostOffice)) {
      throw new Error(`unexpected response status "${result?.Status}"`);
    }

    const states = [
      ...new Set(
        result.PostOffice.map((office) => office.State?.trim()).filter((state): state is string =>
          Boolean(state),
        ),
      ),
    ];
    return remember(pincode, states);
  } catch (err) {
    logger.warn('Pincode lookup failed', { pincode, error: (err as Error).message });
    return null;
  }
}

function remember(pincode: string, states: string[]): string[] {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(pincode, { states, expiresAt: Date.now() + CACHE_TTL_MS });
  return states;
}
