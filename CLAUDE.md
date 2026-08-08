# CLAUDE.md — Saree Grace Backend

This file documents the stack, conventions, and key architectural decisions for
this repository so that future work (human or AI) stays consistent with what's
already here.

## Stack

- **Language**: TypeScript (strict mode, `noUncheckedIndexedAccess` on)
- **Framework**: Express 4
- **Database**: MongoDB via Mongoose 8 (MongoDB Atlas in staging/prod)
- **Auth**: JWT (access + refresh, rotation strategy) + Google SSO (`google-auth-library`)
- **Payments**: Razorpay (orders, webhook, refunds)
- **Media**: Cloudinary (buffer upload, no disk writes)
- **Deployment**: AWS Lambda via `serverless-http`, `serverless` framework (v3) / SAM-compatible
- **Validation**: Zod, applied via a `validate()` middleware that replaces `req.body/query/params`
- **Testing**: Jest + Supertest + `mongodb-memory-server` (replica set, for transactions)

## Folder structure

```
src/
  config/        env, db, cloudinary, razorpay clients
  middlewares/   auth, validation, error handling, rate limiting, sanitize, upload
  models/        Mongoose schemas
  modules/       one folder per domain (auth, product, order, payment, ...)
    <name>.validation.ts   Zod schemas
    <name>.service.ts      business logic, NO req/res — unit testable in isolation
    <name>.controller.ts   thin req/res glue, calls service, sends response
    <name>.routes.ts       wires middleware + controller to Express Router
  utils/         cross-cutting helpers (ApiError, ApiResponse, tokens, pagination, ...)
  app.ts         Express app factory (no listen())
  server.ts      local dev entrypoint (ts-node-dev)
  lambda.ts      AWS Lambda entrypoint (serverless-http)
scripts/         seed.ts, loadtest.ts
tests/
  unit/          service-level tests, no HTTP layer
  integration/   Supertest against the real Express app + in-memory Mongo
```

## Key decisions

### API response shape
Every endpoint responds with `{ success: boolean, data?, error? }`. See
`src/utils/ApiResponse.ts`. Pagination metadata (e.g. `nextCursor`) is returned
under a top-level `meta` key, not mixed into `data`.

### Pagination — cursor-based, not offset
Product/order/review listing endpoints use cursor pagination keyed on `_id`
(base64url-encoded), sorted `_id` descending by default ("newest first").
This is deliberate: offset pagination (`page`/`skip`) skips or duplicates
items when documents are inserted/removed between page fetches, which is
guaranteed to happen on a live storefront. Cursors don't have that problem.
Server-side limit is clamped to `MAX_PAGE_LIMIT = 50` (`src/utils/pagination.ts`)
regardless of what the client requests.

### Product schema — simple vs. variant
A single `Product` collection holds both `type: 'simple'` and `type: 'variant'`
documents (see `src/models/Product.ts`) rather than two collections, so
category/browse/search queries don't need to fan out. Simple products carry
`price`/`stock`/`sku` directly; variant products carry `variantAttributeNames`
plus an embedded `variants[]` array, each with its own `sku`/`price`/`stock`/
`images`. The frontend contract: check `product.type` — if `'variant'`, price
shown in listings is `Math.min(...variants.map(v => v.price))` ("starting from").

### Stock handling
Stock is decremented **atomically** at order-creation time using a
conditional `updateOne` (`stock: { $gte: qty }` in the filter, `$inc` in the
update) inside a Mongo transaction alongside the cart-clear and order-insert
(`src/modules/order/order.service.ts`). If any item is short on stock the
whole transaction aborts — nothing is partially decremented. Cancelling an
order or a payment failing both restore stock via the same code path
(`STOCK_RESTORING_STATUSES` in `orderStateMachine.ts`), guarded by an
`order.stockRestored` flag so it can never double-restore.

### Order status — explicit state machine
`src/modules/order/orderStateMachine.ts` is the single allow-list of valid
transitions. Nothing sets `order.status` directly outside of
`transitionOrderStatus()` in `order.service.ts` — this is what the customer
cancel endpoint, the admin status endpoint, payment verification, and the
Razorpay webhook all funnel through, so the history log and stock-restore
side effects can never be bypassed.

### Payments — webhook is the source of truth
`POST /payments/verify` checks the Razorpay signature and, if valid, marks
the order paid immediately for fast UI feedback. But `POST /payments/webhook`
is what actually governs order state in production: it's the only path
guaranteed to fire even if the customer closes the tab right after paying.
Both paths are idempotent (checked against current `order.status`), so
whichever arrives first "wins" and the second is a safe no-op. Webhook
deliveries are deduplicated via a `WebhookEvent` collection with a unique
`(provider, eventId)` index — Razorbpay's automatic retries are always safe.

### Cart pricing — snapshot moves forward on touch
`Cart.items[].priceSnapshot` captures the live price whenever an item is
added or its quantity is updated. It does **not** silently update in the
background if the product price changes after that — the customer sees a
stable price until they touch the cart again. The order created from a cart
re-snapshots those prices onto `Order.items[]` and never reads the cart
again afterward.

### Guest cart merge on login
The backend has no anonymous/guest cart storage — `Cart` always belongs to
an authenticated `userId`. A frontend that keeps a guest cart client-side
(e.g. localStorage) calls `POST /cart/merge` with `{ items: [...] }`
immediately after login; quantities for matching product+variant pairs are
summed with the user's existing cart (capped at live stock), and the guest
cart is then discarded client-side.

### Category deletion — blocked, not cascaded
Deleting a category with existing products or subcategories is rejected
(409) rather than cascading. Admin must reassign or remove dependents first.
This avoids ever silently orphaning products or deleting catalog data as a
side effect of an unrelated cleanup action.

### Category listing — flat by default, tree on request
`GET /categories` returns a flat, alphabetized list by default (cheapest to
cache and paginate). Pass `?tree=true` to get a nested tree built in-memory
from the flat list.

### NoSQL injection / input sanitization
`src/middlewares/sanitize.ts` strips any object key starting with `$` or
containing `.` from `req.body/params/query` before it reaches a query —
applied globally in `app.ts`. Combined with Zod validation on every route,
this closes the classic `{ "email": { "$gt": "" } }` login bypass.

### Refresh tokens
Refresh tokens are JWTs (so they self-describe `sub`/`role`/`jti`), but the
`jti` is looked up against a `RefreshToken` collection storing only a SHA-256
hash of the token — the raw token is never stored. Rotation: every refresh
issues a brand new token and marks the old one `revoked`; presenting an
already-revoked token revokes the entire session chain for that user (reuse
detection).

### Lambda connection reuse
`src/config/db.ts` caches the Mongoose connection at module scope. `lambda.ts`
sets `context.callbackWaitsForEmptyEventLoop = false` and awaits
`connectToDatabase()` on every invocation, which is a no-op on a warm
container (readyState already 1) and only actually reconnects on a cold
start.

## Conventions

- Business logic lives in `*.service.ts` and never touches `req`/`res` —
  this is what makes it unit-testable without spinning up Express.
- Controllers are thin: parse nothing (validation middleware already did
  that), call the service, call `sendSuccess`/let errors bubble to
  `asyncHandler` → `errorHandler`.
- Every route handler is wrapped in `asyncHandler` — no route may have an
  unhandled promise rejection.
- Every mutating admin route requires `requireAuth` then `requireAdmin`, in
  that order.
- Never `console.log` — use `src/utils/logger.ts` (structured JSON, one line
  per event, safe for CloudWatch).
