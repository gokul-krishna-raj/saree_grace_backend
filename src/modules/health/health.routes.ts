import { Router } from 'express';
import mongoose from 'mongoose';
import { sendSuccess } from '../../utils/ApiResponse';

const router = Router();

const DB_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

router.get('/', (_req, res) => {
  const dbState = DB_STATES[mongoose.connection.readyState] ?? 'unknown';

  sendSuccess(res, {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    db: dbState,
  });
});

export default router;
