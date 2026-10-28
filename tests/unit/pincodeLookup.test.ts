// tests/setup.ts mocks this module globally — this file tests the real implementation, with
// `fetch` stubbed so nothing reaches India Post.
const { lookupPincodeStates } = jest.requireActual<
  typeof import('../../src/modules/shipping/pincodeLookup')
>('../../src/modules/shipping/pincodeLookup');

function respondWith(body: unknown, status = 200) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }) as Response);
}

describe('lookupPincodeStates', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the distinct states of the pincode post offices', async () => {
    respondWith([
      {
        Status: 'Success',
        PostOffice: [{ State: 'Kerala' }, { State: 'Pondicherry' }, { State: 'Kerala' }],
      },
    ]);
    await expect(lookupPincodeStates('673311')).resolves.toEqual(['Kerala', 'Pondicherry']);
  });

  it('returns [] when India Post reports the pincode does not exist', async () => {
    respondWith([{ Status: 'Error', PostOffice: null }]);
    await expect(lookupPincodeStates('999991')).resolves.toEqual([]);
  });

  it('returns null (so callers can fall back) when the lookup fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));
    await expect(lookupPincodeStates('600011')).resolves.toBeNull();
  });

  it('returns null on a non-2xx response', async () => {
    respondWith({}, 503);
    await expect(lookupPincodeStates('600012')).resolves.toBeNull();
  });

  it('caches definitive answers so a repeat pincode makes no second request', async () => {
    const fetchSpy = respondWith([{ Status: 'Success', PostOffice: [{ State: 'Tamil Nadu' }] }]);
    await lookupPincodeStates('600013');
    await expect(lookupPincodeStates('600013')).resolves.toEqual(['Tamil Nadu']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('down'));
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ Status: 'Success', PostOffice: [{ State: 'Karnataka' }] }]),
      ) as Response,
    );
    await expect(lookupPincodeStates('560014')).resolves.toBeNull();
    await expect(lookupPincodeStates('560014')).resolves.toEqual(['Karnataka']);
  });
});
