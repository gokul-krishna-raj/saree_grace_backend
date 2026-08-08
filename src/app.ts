import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { env } from './config/env';
import { requestContext, requestLogger } from './middlewares/requestContext';
import { sanitizeInput } from './middlewares/sanitize';
import { globalRateLimiter } from './middlewares/rateLimiter';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import routes from './routes';
import healthRoutes from './modules/health/health.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser clients (no Origin header, e.g. curl, mobile) and
        // any origin explicitly present in CORS_ORIGINS.
        if (!origin || env.corsOriginList.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS policy`));
      },
      credentials: true,
    }),
  );

  app.use(compression());
  app.use(
    express.json({
      limit: '2mb',
      // Stash the raw bytes alongside the parsed body so the Razorpay
      // webhook handler can verify the HMAC signature over the exact
      // payload Razorpay sent, not a re-serialized version of it.
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use(requestContext);
  if (!env.isTest) {
    app.use(morgan('combined'));
  }
  app.use(requestLogger);

  app.use(sanitizeInput);
  app.use(globalRateLimiter);

  // Exposed at root (unauthenticated, unversioned) for load balancer / uptime probes.
  app.use('/health', healthRoutes);
  app.use(env.API_BASE_PATH, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
