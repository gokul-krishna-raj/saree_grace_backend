import { Handler } from 'aws-lambda';
import { connectToDatabase } from '../config/db';
import { runAbandonedCartJob } from '../modules/email/abandonedCart.job';
import { logger } from '../utils/logger';

/**
 * Scheduled Lambda (see serverless.yml's `abandonedCartJob` function, wired
 * to an hourly EventBridge rule) — same connection-reuse pattern as
 * lambda.ts's API handler.
 */
export const handler: Handler = async (_event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    await connectToDatabase();
  } catch (error) {
    logger.error('Failed to connect to MongoDB in abandoned-cart job', {
      error: (error as Error).message,
    });
    throw error;
  }

  return runAbandonedCartJob();
};
