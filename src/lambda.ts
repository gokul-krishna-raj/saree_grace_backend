import serverlessHttp from 'serverless-http';
import { Handler } from 'aws-lambda';
import { createApp } from './app';
import { connectToDatabase } from './config/db';
import { logger } from './utils/logger';

// Created once per Lambda container (cold start) and reused across warm
// invocations — this is what makes DB connection reuse and low latency work.
const app = createApp();
const serverlessHandler = serverlessHttp(app);

export const handler: Handler = async (event, context) => {
  // Allows the connection to stay open across invocations instead of the
  // Lambda runtime waiting for the event loop to drain.
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    await connectToDatabase();
  } catch (error) {
    logger.error('Failed to connect to MongoDB in Lambda handler', {
      error: (error as Error).message,
    });
    throw error;
  }

  return serverlessHandler(event, context);
};
