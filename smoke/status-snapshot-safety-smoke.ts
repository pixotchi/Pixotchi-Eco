import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseStatusSnapshot,
  toPublicStatusSnapshot,
} from '../lib/status-snapshot';

const statusPageSource = readFileSync(new URL('../app/status/page.tsx', import.meta.url), 'utf8');
const statusRouteSource = readFileSync(
  new URL('../app/api/status/checks/route.ts', import.meta.url),
  'utf8',
);

assert.match(statusPageSource, /toPublicStatusSnapshot\(await getCachedStatusSnapshot\(\)\)/);
assert.match(statusRouteSource, /toPublicStatusSnapshot\(snapshot\)/);

const legacySnapshot = {
  generatedAt: '2026-09-04T21:45:06.493Z',
  overall: 'operational',
  services: [
    {
      id: 'rpc',
      label: 'https://provider.example/v2/private-api-key',
      status: 'operational',
      latencyMs: 123,
      details: 'Diagnostic endpoint: https://provider.example/v2/private-api-key',
      metrics: {
        healthyCount: 5,
        totalCount: 5,
        rankedUrls: ['https://provider.example/v2/private-api-key'],
        endpoints: [
          {
            url: 'https://provider.example/v2/private-api-key',
            vendor: 'provider',
          },
        ],
      },
    },
    {
      id: 'future-internal-check',
      label: 'https://provider.example/v2/private-api-key',
      status: 'operational',
      details: 'https://provider.example/v2/private-api-key',
    },
  ],
};

const parsedLegacy = parseStatusSnapshot(legacySnapshot);
assert.ok(parsedLegacy, 'a structurally valid legacy snapshot should remain usable');

const publicSnapshot = toPublicStatusSnapshot(parsedLegacy);
const serializedPublicSnapshot = JSON.stringify(publicSnapshot);
assert.equal(serializedPublicSnapshot.includes('private-api-key'), false);
assert.equal(serializedPublicSnapshot.includes('"rankedUrls"'), false);
assert.equal(serializedPublicSnapshot.includes('"endpoints"'), false);
assert.equal(publicSnapshot.services.length, 1, 'unknown internal checks must be omitted by default');
assert.equal(publicSnapshot.services[0]?.label, 'RPC Cluster');
assert.equal('details' in (publicSnapshot.services[0] ?? {}), false);
assert.deepEqual(publicSnapshot.services[0]?.metrics, {
  healthyCount: 5,
  totalCount: 5,
});

for (const invalidMetrics of [
  { healthyCount: 6, totalCount: 5 },
  { healthyCount: 1.5, totalCount: 5 },
  { healthyCount: -1, totalCount: 5 },
  { healthyCount: 1, totalCount: Number.POSITIVE_INFINITY },
]) {
  const parsed = parseStatusSnapshot({
    ...legacySnapshot,
    services: [{ ...legacySnapshot.services[0], metrics: invalidMetrics }],
  });
  assert.ok(parsed);
  assert.equal(
    toPublicStatusSnapshot(parsed).services[0]?.metrics,
    undefined,
    'invalid RPC counts must be omitted rather than rendered as misleading health data',
  );
}

for (const malformed of [
  null,
  {},
  { ...legacySnapshot, generatedAt: 'not-a-date' },
  { ...legacySnapshot, overall: 'fine' },
  { ...legacySnapshot, services: 'not-an-array' },
  {
    ...legacySnapshot,
    services: [{ ...legacySnapshot.services[0], status: 'fine' }],
  },
  {
    ...legacySnapshot,
    services: [{ ...legacySnapshot.services[0], metrics: [] }],
  },
]) {
  assert.equal(parseStatusSnapshot(malformed), null);
}

console.log('Status snapshot validation and public redaction smoke checks passed.');
