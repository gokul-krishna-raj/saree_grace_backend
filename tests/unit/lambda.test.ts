import type { Context } from 'aws-lambda';
import { logger } from '../../src/utils/logger';

jest.mock('../../src/config/db', () => ({
  connectToDatabase: jest
    .fn()
    .mockRejectedValue(
      new Error('Server selection timed out after 10000 ms (ac-1b4owfr-shard-00-00.example.net)'),
    ),
}));

import { handler } from '../../src/lambda';

describe('lambda handler — database unavailable', () => {
  it('returns a generic 503 and logs the real error server-side only', async () => {
    const logSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const context = { callbackWaitsForEmptyEventLoop: true } as Context;

    const result = await handler({}, context, () => undefined);

    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body)).toEqual({
      success: false,
      error: { message: 'Service temporarily unavailable' },
    });
    expect(result.body).not.toMatch(/Server selection|shard|10000/);
    expect(logSpy).toHaveBeenCalledWith(
      'Failed to connect to MongoDB in Lambda handler',
      expect.objectContaining({ error: expect.stringContaining('Server selection timed out') }),
    );
  });
});
