// CI gate equivalent to `npm audit --omit=dev --audit-level=high`, except for an explicit
// allowlist of advisories we've reviewed and accepted temporarily. Every entry needs a reason
// and an owner action — this is a stopgap, not a way to silence audit.
//
// Usage: npm audit --omit=dev --json | node .github/scripts/audit-gate.mjs
import { readFileSync } from 'node:fs';

const ALLOWLIST = {
  // zod <4.6.6 memory exhaustion on oversized constrained collections. The only fix is the
  // zod 3 -> 4 major upgrade, which breaks our request validators.
  // TODO: remove once the backend is migrated to zod 4.
  'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5': 'pending zod 4 migration',
};
const BLOCKING = new Set(['high', 'critical']);

const report = JSON.parse(readFileSync(0, 'utf8'));
const blocking = [];
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    // String entries point at another vulnerable package, which is reported on its own.
    if (typeof via === 'string' || !BLOCKING.has(via.severity)) continue;
    if (ALLOWLIST[via.url]) {
      console.warn(`Allowed (${ALLOWLIST[via.url]}): ${via.name} — ${via.title} ${via.url}`);
    } else {
      blocking.push(`${via.severity}: ${via.name} — ${via.title} ${via.url}`);
    }
  }
}

if (blocking.length > 0) {
  console.error(`npm audit found ${blocking.length} blocking advisories:\n${blocking.join('\n')}`);
  process.exit(1);
}
console.log('npm audit: no blocking advisories.');
