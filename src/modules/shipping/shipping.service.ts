import { ApiError } from '../../utils/ApiError';
import { lookupPincodeStates } from './pincodeLookup';

// State-tiered shipping: cheapest for Tamil Nadu and Puducherry (home region), a mid tier for
// the neighboring South Indian states, flat rate elsewhere. Keyed lowercase/trimmed so casing
// differences never fall through to the default tier. India Post still spells Puducherry
// "Pondicherry", so both are listed.
const SHIPPING_FEE_BY_STATE: Record<string, number> = {
  'tamil nadu': 40,
  puducherry: 40,
  pondicherry: 40,
  kerala: 60,
  'andhra pradesh': 60,
  karnataka: 60,
};
const DEFAULT_SHIPPING_FEE = 130;

export function computeShippingFeeForState(state: string): number {
  return SHIPPING_FEE_BY_STATE[state.trim().toLowerCase()] ?? DEFAULT_SHIPPING_FEE;
}

const normalize = (state: string) =>
  state.trim().toLowerCase() === 'pondicherry' ? 'puducherry' : state.trim().toLowerCase();

export interface ShippingQuote {
  pincode: string;
  // Display name, normalised to the spelling the storefront's state list uses.
  state: string;
  fee: number;
  // 'pincode' = resolved via India Post; 'state' = lookup unavailable, priced from the state
  // the customer selected.
  source: 'pincode' | 'state';
}

/**
 * Prices shipping from the delivery pincode — the customer-selected state is only used to pick
 * between the states of a border pincode, or as the fallback when India Post is unreachable.
 * Throws 400 when the pincode doesn't exist (or is unreachable and no state was given).
 */
export async function quoteShipping(
  pincode: string,
  selectedState?: string,
): Promise<ShippingQuote> {
  const states = await lookupPincodeStates(pincode);

  if (states === null) {
    if (!selectedState) {
      throw ApiError.badRequest(
        "We couldn't verify this pincode right now. Please select your state.",
      );
    }
    return {
      pincode,
      state: selectedState,
      fee: computeShippingFeeForState(selectedState),
      source: 'state',
    };
  }

  if (states.length === 0) {
    throw ApiError.badRequest('This pincode was not found. Please check and try again.');
  }

  const selected = selectedState
    ? states.find((state) => normalize(state) === normalize(selectedState))
    : undefined;
  // For a border pincode with no matching selection, charge the cheaper of its states.
  const state =
    selected ??
    [...states].sort((a, b) => computeShippingFeeForState(a) - computeShippingFeeForState(b))[0]!;

  return {
    pincode,
    state: normalize(state) === 'puducherry' ? 'Puducherry' : state,
    fee: computeShippingFeeForState(state),
    source: 'pincode',
  };
}
