/**
 * Manual/local runner for the abandoned-cart reminder job — the same logic
 * the scheduled Lambda (src/jobs/abandonedCartHandler.ts) runs hourly in
 * deployed environments. Useful in dev, or as the target of an external
 * cron if you're not running on the Lambda schedule.
 *
 * Usage: npm run job:abandoned-cart
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { runAbandonedCartJob } from '../src/modules/email/abandonedCart.job';
import { logger } from '../src/utils/logger';

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  const result = await runAbandonedCartJob();
  logger.info('Abandoned cart job complete', { ...result });
  await mongoose.disconnect();
}

main().catch((error) => {
  logger.error('Abandoned cart job failed', { error: (error as Error).message });
  process.exit(1);
});
