import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Cached at module scope so a warm Lambda container reuses the same
 * connection across invocations instead of reconnecting every call.
 */
let cachedConnection: typeof mongoose | null = null;
let connectingPromise: Promise<typeof mongoose> | null = null;

export async function connectToDatabase(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  mongoose.set('strictQuery', true);

  connectingPromise = mongoose
    .connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    })
    .then((conn) => {
      cachedConnection = conn;
      logger.info('MongoDB connected', { host: conn.connection.host });
      return conn;
    })
    .catch((err) => {
      connectingPromise = null;
      logger.error('MongoDB connection failed', { error: (err as Error).message });
      throw err;
    });

  return connectingPromise;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (cachedConnection) {
    await mongoose.disconnect();
    cachedConnection = null;
    connectingPromise = null;
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
