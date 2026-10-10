import { Router } from 'express';
import mongoose from 'mongoose';
import { sendError, sendSuccess } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { logger } from '../../utils/logger';

const router = Router();

const DB_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

const PING_TIMEOUT_MS = 3000;

// A cheap round trip to the database — `readyState` alone can still say "connected" while the
// cluster is unreachable, which is exactly the failure uptime monitoring needs to catch.
async function pingDatabase(): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) throw new Error(`database not connected (${DB_STATES[mongoose.connection.readyState]})`);
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.admin().ping(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('database ping timed out')), PING_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return Date.now() - started;
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    try {
      const dbLatencyMs = await pingDatabase();
      sendSuccess(res, {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        db: 'connected',
        dbLatencyMs,
      });
    } catch (err) {
      logger.error('Health check failed', { error: (err as Error).message });
      sendError(res, 500, 'Database unavailable');
    }
  }),
);

export default router;
