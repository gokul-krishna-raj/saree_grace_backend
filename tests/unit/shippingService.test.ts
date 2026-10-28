import { lookupPincodeStates } from '../../src/modules/shipping/pincodeLookup';
import {
  computeShippingFeeForState,
  quoteShipping,
} from '../../src/modules/shipping/shipping.service';

// lookupPincodeStates is the global mock from tests/setup.ts (a fixed pincode directory).
const lookupMock = lookupPincodeStates as jest.MockedFunction<typeof lookupPincodeStates>;

describe('computeShippingFeeForState', () => {
  it.each([
    ['Tamil Nadu', 40],
    ['Puducherry', 40],
    ['Pondicherry', 40],
    ['Kerala', 60],
    ['Karnataka', 60],
    ['Andhra Pradesh', 60],
    ['Telangana', 130],
    ['Delhi', 130],
    ['  tamil NADU ', 40],
  ])('%s -> %i', (state, fee) => {
    expect(computeShippingFeeForState(state)).toBe(fee);
  });
});

describe('quoteShipping', () => {
  it.each([
    ['600001', 'Tamil Nadu', 40],
    ['605001', 'Puducherry', 40],
    ['560001', 'Karnataka', 60],
    ['682001', 'Kerala', 60],
    ['520001', 'Andhra Pradesh', 60],
    ['500001', 'Telangana', 130],
    ['110001', 'Delhi', 130],
  ])('prices pincode %s from its state (%s, ₹%i)', async (pincode, state, fee) => {
    await expect(quoteShipping(pincode)).resolves.toEqual({
      pincode,
      state,
      fee,
      source: 'pincode',
    });
  });

  it('charges by the pincode, not by a mismatching selected state', async () => {
    await expect(quoteShipping('110001', 'Tamil Nadu')).resolves.toMatchObject({
      state: 'Delhi',
      fee: 130,
    });
  });

  it('uses the selected state to choose between the states of a border pincode', async () => {
    await expect(quoteShipping('673310', 'Kerala')).resolves.toMatchObject({
      state: 'Kerala',
      fee: 60,
    });
    await expect(quoteShipping('673310', 'Puducherry')).resolves.toMatchObject({
      state: 'Puducherry',
      fee: 40,
    });
  });

  it('charges the cheaper state of a border pincode when nothing matches', async () => {
    await expect(quoteShipping('673310')).resolves.toMatchObject({
      state: 'Puducherry',
      fee: 40,
    });
  });

  it('rejects a pincode India Post does not know', async () => {
    await expect(quoteShipping('999999')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('falls back to the selected state when the lookup is unavailable', async () => {
    lookupMock.mockResolvedValueOnce(null);
    await expect(quoteShipping('600001', 'Kerala')).resolves.toEqual({
      pincode: '600001',
      state: 'Kerala',
      fee: 60,
      source: 'state',
    });
  });

  it('rejects when the lookup is unavailable and no state was selected', async () => {
    lookupMock.mockResolvedValueOnce(null);
    await expect(quoteShipping('600001')).rejects.toMatchObject({ statusCode: 400 });
  });
});
