import mongoose from 'mongoose';
import { connectToDatabase } from '../../src/config/db';

describe('connectToDatabase (Lambda connection reuse)', () => {
  it('reuses the cached connection on subsequent calls instead of reconnecting', async () => {
    // The real mongoose singleton is already connected (readyState 1) via
    // tests/setup.ts — that's exactly the "warm Lambda container" scenario
    // this caching exists for. mongoose.connect is spied so a second real
    // connection attempt would be visible as an extra call.
    const connectSpy = jest.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);

    const first = await connectToDatabase('mongodb://placeholder-not-actually-dialed/test');
    expect(connectSpy).toHaveBeenCalledTimes(1);

    const second = await connectToDatabase('mongodb://placeholder-not-actually-dialed/test');
    // Already connected (readyState 1) + cached -> no second dial.
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    connectSpy.mockRestore();
  });
});
