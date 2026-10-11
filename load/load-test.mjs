/**
 * Load test for the main read screens (Phase 7). Signs in once, then drives the busiest reads
 * concurrently and checks p95 latency against the spec target (reads under 300 ms).
 *
 *   LOAD_URL=http://127.0.0.1:4010 LOAD_HOST=demo.localhost LOAD_USER=superadmin \
 *   LOAD_PASSWORD=... npm run load            # optional: LOAD_CONNECTIONS=20 LOAD_SECONDS=20
 *
 * Point it at a staging copy, never at a live hospital: it is real traffic.
 */
import autocannon from 'autocannon';

const base = process.env.LOAD_URL ?? 'http://127.0.0.1:4000';
const host = process.env.LOAD_HOST ?? 'demo.localhost';
const user = process.env.LOAD_USER ?? 'superadmin';
const password = process.env.LOAD_PASSWORD;
const connections = Number(process.env.LOAD_CONNECTIONS ?? 20);
const duration = Number(process.env.LOAD_SECONDS ?? 15);
const READ_P95_MS = 300;

if (!password) {
  console.error('Set LOAD_PASSWORD (the test user’s password).');
  process.exit(2);
}

const login = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hms-host': host },
  body: JSON.stringify({ username: user, password }),
});
if (!login.ok) {
  console.error(`Sign-in failed: ${login.status}`);
  process.exit(2);
}
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');

const READS = [
  ['Who am I', '/api/v1/auth/me'],
  ['Home page', '/api/v1/home?panel=superadmin'],
  ['Patient search', '/api/v1/patients?q=ra&limit=25'],
  ['OPD queue', '/api/v1/opd/queue'],
  ['Bed board', '/api/v1/ipd/beds'],
  ['Lab worklist', '/api/v1/lab/items?limit=50'],
  ['Bills', '/api/v1/billing/bills?limit=25'],
  ['Pharmacy queue', '/api/v1/pharmacy/rx-queue'],
  ['Approvals count', '/api/v1/approvals/count'],
];

const results = [];
for (const [name, path] of READS) {
  const r = await autocannon({
    url: `${base}${path}`,
    connections,
    duration,
    headers: { cookie, 'x-hms-host': host, accept: 'application/json' },
  });
  const non2xx = r.non2xx + r.errors;
  results.push({
    name,
    path,
    rps: Math.round(r.requests.average),
    p50: r.latency.p50,
    p95: r.latency.p97_5 ?? r.latency.p90, // autocannon reports p90, p97.5 and p99
    p99: r.latency.p99,
    non2xx,
  });
  console.log(
    `${name.padEnd(18)} ${String(Math.round(r.requests.average)).padStart(5)} req/s  p50 ${r.latency.p50} ms  p97.5 ${r.latency.p97_5} ms  p99 ${r.latency.p99} ms  errors ${non2xx}`,
  );
}

const slow = results.filter((r) => r.p95 > READ_P95_MS);
const failed = results.filter((r) => r.non2xx > 0);
console.log(
  `\n${connections} connections, ${duration} s per read. Target: p95 under ${READ_P95_MS} ms (p97.5 shown, stricter).`,
);
if (slow.length) console.log(`Over target: ${slow.map((r) => r.name).join(', ')}`);
if (failed.length)
  console.log(`Errors: ${failed.map((r) => `${r.name} (${r.non2xx})`).join(', ')}`);
process.exitCode = slow.length || failed.length ? 1 : 0;
