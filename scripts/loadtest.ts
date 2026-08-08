/**
 * Basic smoke load test against a running local server (npm run dev, in a
 * separate terminal) using autocannon via npx — no autocannon devDependency
 * is committed (it pulls in a vulnerable transitive `uuid`/`hyperid`), so
 * this always fetches the latest release on demand instead.
 *
 * Usage:
 *   npm run dev                      # in one terminal
 *   npm run loadtest                 # in another
 *   TOKEN=<accessToken> npm run loadtest   # also load-tests /orders/my
 */
import { spawnSync } from 'child_process';

const BASE_URL = process.env.LOADTEST_BASE_URL ?? 'http://localhost:4000/api/v1';
const DURATION_SECONDS = process.env.LOADTEST_DURATION ?? '10';
const CONNECTIONS = process.env.LOADTEST_CONNECTIONS ?? '20';

function runAutocannon(label: string, url: string, extraArgs: string[] = []): void {
  console.warn(`\n=== Load test: ${label} (${url}) ===`);
  const result = spawnSync(
    'npx',
    ['--yes', 'autocannon', '-c', CONNECTIONS, '-d', DURATION_SECONDS, ...extraArgs, url],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error(`Load test for ${label} exited with code ${result.status}`);
  }
}

runAutocannon('GET /products', `${BASE_URL}/products`);
runAutocannon('GET /products/search?q=saree', `${BASE_URL}/products/search?q=saree`);

const token = process.env.TOKEN;
if (token) {
  runAutocannon('GET /orders/my', `${BASE_URL}/orders/my`, [
    '-H',
    `Authorization: Bearer ${token}`,
  ]);
} else {
  console.warn(
    '\nSet TOKEN=<accessToken> to also load-test the authenticated GET /orders/my endpoint.',
  );
}
