import { createApp } from './app';
import { env } from './config/env';
import { connectToDatabase, disconnectFromDatabase } from './config/db';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  await connectToDatabase();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Server listening on port ${env.PORT}`, { env: env.NODE_ENV });
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(() => {
      disconnectFromDatabase()
        .catch((error) =>
          logger.error('Error during shutdown', { error: (error as Error).message }),
        )
        .finally(() => process.exit(0));
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Failed to start server', { error: (error as Error).message });
  process.exit(1);
});
