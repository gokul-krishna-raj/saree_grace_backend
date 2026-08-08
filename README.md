# Saree Grace Backend

Production backend for the Saree Grace e-commerce storefront — TypeScript,
Express, MongoDB (Mongoose), deployed as an AWS Lambda function behind API
Gateway, with Razorpay payments, Cloudinary media, and JWT + Google SSO auth.

See [`CLAUDE.md`](./CLAUDE.md) for architectural decisions and conventions,
and [`saree-grace-backend-checklist.md`](./saree-grace-backend-checklist.md)
for the production-readiness checklist this project was built against.

## Prerequisites

- Node.js >= 18
- A MongoDB instance — either [MongoDB Atlas](https://www.mongodb.com/atlas)
  (recommended, use a free/dev cluster) or a local `mongod` **replica set**
  (order creation uses multi-document transactions, which require a replica
  set — a standalone `mongod` will fail on checkout)
- A Razorpay account in **test mode** (for payments)
- A Cloudinary account (for image uploads)
- A Google Cloud OAuth 2.0 Client ID (for Google Sign-In)

## Getting started (fresh clone)

```bash
npm install
cp .env.example .env
# edit .env — fill in MONGODB_URI, JWT secrets, Cloudinary, Razorpay, Google Client ID
npm run seed      # creates categories, sample products, a test admin + customer
npm run dev       # starts the API on http://localhost:4000 with hot reload
```

Health check: `curl http://localhost:4000/health`

Seeded accounts (from `.env`'s `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`,
plus a fixed test customer — see `scripts/seed.ts` output for exact
credentials printed at the end of the seed run).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Local dev server with hot reload (`ts-node-dev`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server (`dist/server.js`) |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the Jest test suite |
| `npm run test:coverage` | Run tests with a coverage report |
| `npm run seed` | Populate the database with test data |
| `npm run loadtest:products` | `autocannon` smoke load test against `GET /products` |
| `npm run offline` | Emulate API Gateway + Lambda locally (`serverless-offline`) |
| `npm run deploy` / `deploy:prod` | Deploy via the Serverless Framework |

## API base path

All routes are mounted under `API_BASE_PATH` (default `/api/v1`), e.g.
`GET /api/v1/products`. `GET /health` is mounted at the root, unversioned,
for load balancer / uptime-monitor probes.

## Testing against AWS Lambda locally

```bash
npm run build
npm run offline
```

This runs `serverless-offline`, which emulates API Gateway + Lambda on top of
the same `src/lambda.ts` handler used in production.

## Deploying

```bash
npm run deploy            # deploys the `dev` stage
npm run deploy:prod       # deploys the `prod` stage
```

Per-stage environment variables are configured in AWS (SSM Parameter Store /
Lambda console), never committed — see `serverless.yml` and
[`docs/deployment.md`](./docs/deployment.md).

## API documentation

Import [`docs/postman_collection.json`](./docs/postman_collection.json) into
Postman — it covers every route in this API with example bodies, and a
couple of requests auto-populate `{{accessToken}}`/`{{orderId}}` collection
variables via test scripts so you can run register → browse → cart →
checkout → pay → review end-to-end without manually copying IDs.
