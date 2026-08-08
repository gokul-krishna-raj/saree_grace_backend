# Saree Grace Backend — Production Readiness Checklist

Stack: TypeScript, Node.js, Express, MongoDB (Mongoose), AWS Lambda, Razorpay, Cloudinary, JWT + Google SSO.

How to use this with Claude Code: work top to bottom, one section per session/prompt.
Don't jump ahead — later sections assume earlier ones are done and tested.
Check items off as Claude Code completes and you've verified them.

---

## 0. Project setup

- [ ] Initialize repo, `tsconfig.json` (strict mode on), ESLint + Prettier configured
- [ ] `package.json` scripts: `dev`, `build`, `lint`, `test`, `deploy`
- [ ] `.env.example` committed, real `.env` gitignored
- [ ] Folder structure created (config / models / modules / middlewares / utils)
- [ ] `CLAUDE.md` written with stack, conventions, and key decisions (pagination style,
      webhook-as-source-of-truth, product schema shape, etc.)
- [ ] Git hooks (husky) for lint + type-check on commit
- [ ] Base `app.ts` (Express instance, JSON body parser, helmet, cors, morgan/logger)
- [ ] `lambda.ts` handler using `serverless-http`, exported correctly
- [ ] MongoDB Atlas connection helper — connection cached at module scope (not per-invocation)
- [ ] Local dev works with `ts-node-dev` and hits a real Atlas dev cluster
- [ ] Local Lambda emulation working (`serverless-offline` or `sam local start-api`)

## 1. Core infrastructure & cross-cutting concerns

- [ ] Centralized error handler middleware (catches thrown errors, formats consistent JSON)
- [ ] Consistent API response wrapper (`{ success, data, error }`) used everywhere
- [ ] Request validation middleware using Zod, wired per-route
- [ ] Global rate limiter + a stricter limiter on `/auth/*` and `/payments/*`
- [ ] Structured logging (request id, route, status, duration) — usable in CloudWatch
- [ ] Environment config validated at boot (throw if required env vars missing)
- [ ] CORS configured for actual frontend domain(s), not `*`
- [ ] Health check route (`GET /health`) for uptime monitoring

## 2. Auth (customer + admin)

- [ ] User model (password hash, googleId nullable, role, addresses[])
- [ ] Register (email/password) with bcrypt hashing
- [ ] Login (email/password) issuing JWT access + refresh tokens
- [ ] Google SSO: verify ID token server-side via `google-auth-library`, find-or-create user
- [ ] Refresh token endpoint + rotation strategy
- [ ] Logout (invalidate refresh token — store hash in DB or a denylist)
- [ ] `requireAuth` middleware (valid JWT → attaches `req.user`)
- [ ] `requireAdmin` middleware (valid JWT + role check)
- [ ] Password reset flow (request + token-based reset) — even if email sending is stubbed for now
- [ ] Rate-limit login/register to prevent brute force
- [ ] Unit tests: register, login, invalid credentials, Google SSO happy path, expired token

## 3. Category management

- [ ] Category model (name, slug, parentCategory for subcategories)
- [ ] Admin CRUD routes for categories
- [ ] Public `GET /categories` (tree or flat, decide and document in CLAUDE.md)
- [ ] Slug auto-generation + uniqueness check
- [ ] Tests: create, duplicate slug rejection, delete category with existing products (decide: block or cascade)

## 4. Product management — simple products

- [ ] Product schema (`type: 'simple'` fields) finalized
- [ ] Cloudinary config + `uploadBufferToCloudinary` helper using memory storage (no disk writes)
- [ ] `POST /admin/products` — multipart, multiple images, Zod-validated
- [ ] `PUT /admin/products/:id` — update fields, add/remove individual images
- [ ] `DELETE /admin/products/:id` — also deletes Cloudinary images via stored `publicId`
- [ ] Stock decrement logic on order placement (atomic update, avoid race conditions)
- [ ] Tests: create with images, update, delete cleans up Cloudinary, stock can't go negative

## 5. Product management — variant products

- [ ] Variant sub-schema finalized (`attributes` as Map, own price/stock/images)
- [ ] `POST /admin/products` (type: variant) — creates shell with `variantAttributeNames`
- [ ] `POST /admin/products/:id/variants` — adds one variant with its own images
- [ ] `PATCH /admin/products/:id/variants/:variantId` — update a single variant
- [ ] `DELETE /admin/products/:id/variants/:variantId` — cleans up that variant's Cloudinary images
- [ ] SKU uniqueness enforced across all variants
- [ ] Computed "starting from" price for listings (min variant price)
- [ ] Tests: add variant, duplicate SKU rejected, delete variant cleans up images, stock per-variant

## 6. Customer-facing product browsing

- [ ] `GET /products` with cursor-based pagination (infinite scroll — not offset/page based)
- [ ] Filters: category, fabric, color, price range, handloom-only, in-stock-only
- [ ] Sort options: newest, price asc/desc, top-rated
- [ ] `GET /products/search?q=` using Mongo `$text` index (note: migrate to Atlas Search later if needed)
- [ ] `GET /products/:slug` — full detail, includes variants if applicable
- [ ] Response shape handles simple vs variant products consistently on the frontend contract
- [ ] Tests: pagination doesn't skip/duplicate items across pages, filters combine correctly, search relevance sane

## 7. Cart

- [ ] Cart model (userId, items: productId/variantId, qty, priceSnapshot)
- [ ] `GET /cart`, `POST /cart` (add item), `PATCH /cart/:itemId` (qty), `DELETE /cart/:itemId`
- [ ] Price snapshot vs live price — decide and document how price changes after adding to cart are handled
- [ ] Stock validation when adding/updating cart items
- [ ] Cart merge strategy on login (guest cart → user cart, if guest carts are supported)
- [ ] Tests: add/update/remove, adding out-of-stock item rejected, qty can't exceed stock

## 8. Wishlist

- [ ] Wishlist model (userId, productIds[])
- [ ] `GET /wishlist`, `POST /wishlist/:productId`, `DELETE /wishlist/:productId`
- [ ] Tests: add/remove, duplicate add is a no-op not an error

## 9. Orders & checkout

- [ ] Order model (items snapshot, shippingAddress, status enum, payment fields, timestamps)
- [ ] `POST /orders` — creates order from cart, snapshots prices (don't reference live cart afterward)
- [ ] `GET /orders/my`, `GET /orders/:id` (ownership check — customer can only see their own)
- [ ] Order status transitions defined (pending → paid → shipped → delivered / cancelled) with a state machine, not free-form string updates
- [ ] Stock reserved/decremented at order creation, restored on cancellation
- [ ] Tests: full order lifecycle, cancellation restores stock, can't view another user's order

## 10. Payments (Razorpay)

- [ ] `POST /payments/create-order` — creates Razorpay order tied to internal order id
- [ ] `POST /payments/verify` — verifies client-side payment signature
- [ ] `POST /payments/webhook` — verifies Razorpay webhook signature, this is the **source of truth** for marking orders paid, not the client callback
- [ ] Idempotency handling on webhook (Razorpay can retry delivery — don't double-process)
- [ ] Refund flow (at least admin-triggered manual refund via Razorpay API)
- [ ] Payment failure handling — order stays pending/failed, stock released
- [ ] Tests: webhook signature validation (valid + tampered), duplicate webhook delivery is safe, failed payment doesn't mark order paid

## 11. Reviews

- [ ] Review model (userId, productId, rating, comment, images[], approved flag)
- [ ] `POST /reviews` — only allowed if user purchased the product (verified delivered order)
- [ ] `GET /products/:id/reviews` — only approved reviews shown publicly
- [ ] Admin: `GET /admin/reviews`, `PATCH /admin/reviews/:id/approve`, delete
- [ ] Product `ratingAvg`/`reviewCount` recalculated on new approved review
- [ ] Tests: can't review without purchase, unapproved reviews hidden from public endpoint

## 12. Order tracking

- [ ] Tracking fields on Order (carrier, trackingId, status history log with timestamps)
- [ ] `GET /orders/:id/tracking` — customer-facing status + history
- [ ] Admin: `PATCH /admin/orders/:id/status` — updates status + appends to history log
- [ ] Tests: status history is append-only and ordered correctly

## 13. Admin dashboard

- [ ] `GET /admin/dashboard` — order counts by status, revenue (today/week/month), low-stock alerts, recent orders
- [ ] Efficient aggregation queries (use Mongo aggregation pipeline, not fetch-all-then-compute-in-JS)
- [ ] Tests: dashboard numbers match manually computed expected values on seeded data

## 14. Security pass

- [ ] All admin routes behind `requireAdmin`, verified with a test that a customer JWT is rejected
- [ ] No sensitive fields (password hash, tokens) ever returned in API responses — check every serializer
- [ ] Input sanitization against NoSQL injection (reject/strip `$`-prefixed keys in user input)
- [ ] File upload validated for type/size before sending to Cloudinary (don't trust client mimetype alone)
- [ ] Secrets loaded from environment/secrets manager, never hardcoded
- [ ] HTTPS enforced at API Gateway level
- [ ] Dependency vulnerability scan (`npm audit`) run and addressed

## 15. Testing pass

- [ ] Unit tests for all services (business logic isolated from Express req/res)
- [ ] Integration tests for every route (Jest + Supertest) against an in-memory or test Mongo instance
- [ ] Test coverage report generated — target meaningful coverage on services/controllers, not just a number
- [ ] Seed script for local/test data (categories, products of both types, a test admin, a test customer)
- [ ] Manual end-to-end pass: register → browse → add to cart → checkout → pay (test mode) → admin marks shipped → customer sees tracking

## 16. Performance & reliability

- [ ] Mongoose indexes added: slug (unique), category, text index for search, compound indexes matching common filter combinations
- [ ] N+1 query check on list endpoints (use `.populate()` deliberately, not per-item queries in a loop)
- [ ] Lambda cold start acceptable — connection reuse confirmed under repeated invocations
- [ ] Pagination limits enforced server-side (client can't request `limit=10000`)
- [ ] Basic load test on `/products` and `/orders` (even a simple autocannon run)

## 17. Deployment & ops

- [ ] `serverless.yml` / SAM template finalized — stages for dev/staging/prod
- [ ] Environment variables per stage configured (not shared dev/prod secrets)
- [ ] CI pipeline: lint → type-check → test → deploy on merge to main
- [ ] CloudWatch alarms for error rate / latency spikes
- [ ] Rollback plan documented (previous Lambda version redeploy)
- [ ] API documentation generated (OpenAPI/Swagger or at minimum a Postman collection) and kept in sync

## 18. Final pre-launch review

- [ ] Every checklist item above checked off and verified, not just implemented
- [ ] Fresh clone + `.env` setup works end-to-end for a new developer with no tribal knowledge
- [ ] All TODOs/FIXMEs in code resolved or explicitly deferred with a ticket
- [ ] Admin can fully manage the catalog and orders without needing direct DB access
- [ ] Real Razorpay test-mode transaction completed successfully end-to-end
