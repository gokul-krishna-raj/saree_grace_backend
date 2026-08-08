# Deployment & Operations Runbook

## Stages

Three stages, each an isolated set of AWS resources (Lambda function, API
Gateway, CloudWatch log group) and isolated secrets — `dev`, `staging`, `prod`.
Nothing is shared between them; a `dev` MongoDB Atlas cluster is never the
same cluster as `prod`.

```
npm run deploy               # deploys `dev`  (serverless deploy --stage dev)
npx serverless deploy --stage staging
npm run deploy:prod          # deploys `prod` (serverless deploy --stage prod)
```

## Per-stage secrets

Secrets are never committed. Two supported ways to supply them to
`serverless.yml` (which reads everything via `${env:VAR, 'default'}`):

1. **Local/manual deploy**: create a gitignored `.env.<stage>` (e.g.
   `.env.prod`) — `useDotenv: true` in `serverless.yml` loads it
   automatically when `--stage <stage>` is passed.
2. **CI (recommended for staging/prod)**: store each secret as a GitHub
   Actions Environment secret (`Settings → Environments → <stage>`), scoped
   so only workflow runs targeting that environment can read them. See
   `.github/workflows/ci.yml` for the `dev` example — `staging`/`prod`
   follow the same pattern with a manual `workflow_dispatch` approval gate
   instead of deploying on every push to `main`.

Required per-stage values: `MONGODB_URI`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `CORS_ORIGINS`, `GOOGLE_CLIENT_ID`,
`CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`,
`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`. Generate
`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` with `openssl rand -hex 32` — a
different pair per stage, never reused from dev in prod.

## HTTPS

Enforced at the API Gateway level by default: the auto-generated
`execute-api.<region>.amazonaws.com` endpoint only ever serves HTTPS — there
is no plaintext HTTP listener to disable. For a custom domain
(`api.sareegrace.com`), provision an ACM certificate in the same region and
attach it via API Gateway custom domain names; HTTP→HTTPS redirect is
handled by CloudFront/API Gateway, not by application code.

## CloudWatch alarms

Set these up per stage (via the AWS console, or codify with the
`serverless-plugin-aws-alerts` plugin if more stages are added later):

| Alarm | Metric | Suggested threshold |
| --- | --- | --- |
| High error rate | `Errors / Invocations` on the `api` Lambda | > 5% over 5 min |
| High latency | `Duration` p99 on the `api` Lambda | > 3000ms over 5 min |
| Throttling | `Throttles` on the `api` Lambda | > 0 over 5 min |
| Concurrent executions near limit | `ConcurrentExecutions` | > 80% of account limit |

Structured JSON logs (`src/utils/logger.ts`) are already CloudWatch-Logs
Insights-friendly — every line is one JSON object with `level`, `message`,
and contextual fields (`requestId`, `route`, `status`, `durationMs`), so
alarms can also be built on
[metric filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html)
over `{ $.level = "error" }`.

## Rollback plan

Every `serverless deploy` publishes a new Lambda version and updates the
alias. To roll back:

```bash
# List recent deployments (serverless keeps deployment history in S3)
npx serverless deploy list --stage prod

# Roll back to a specific timestamp from the list above
npx serverless rollback --stage prod --timestamp <timestamp>
```

This restores both the Lambda code and the CloudFormation stack (API Gateway
config, IAM role, etc.) to that deployment's state. Database migrations (if
any are ever introduced) are NOT rolled back automatically — schema changes
must be additive/backward-compatible for at least one deploy cycle so a code
rollback never leaves the app pointed at data it can't read.

## Promotion flow

`main` branch pushes auto-deploy to `dev` (see CI workflow). Promotion to
`staging` and `prod` is a manual `workflow_dispatch` run of the same
build/test job against the target stage, gated by required reviewers on the
GitHub Environment — this is deliberate: payments and order state are
high-stakes enough that "merge to main auto-deploys prod" is not an
acceptable default.

## Local Lambda emulation

```bash
npm run build
npm run offline    # serverless-offline, serves http://localhost:4000
```

This runs the exact `dist/lambda.js` handler used in production behind a
local API Gateway emulator — useful for verifying `serverless.yml` routing
and cold-start behavior without deploying.
