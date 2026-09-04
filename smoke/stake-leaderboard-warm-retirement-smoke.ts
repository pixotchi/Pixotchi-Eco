import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const projectFile = (path: string) => readFileSync(
  new URL(`../${path}`, import.meta.url),
  'utf8',
);

// The old endpoint was not scheduled or otherwise referenced. It merely
// performed the same cache-backed read as a foreground request, so retaining
// it invites an unaudited scheduler to spend RPC/ENS quota without preventing
// a cache-miss rebuild. The normal request path remains the single cache owner.
assert.equal(
  existsSync(new URL('../app/api/leaderboard/stake/warm/route.ts', import.meta.url)),
  false,
  'the unused stake leaderboard warm endpoint must stay retired',
);

const stakeService = projectFile('lib/stake-leaderboard-service.ts');
assert.match(stakeService, /const CACHE_TTL = 15 \* 60/);
assert.match(stakeService, /const cached = await redis\.get\(CACHE_KEY\)/);
assert.match(stakeService, /const allStakers = await getAllStakersFromContract\(readClient\)/);
assert.match(stakeService, /await redis\.setex\(CACHE_KEY, CACHE_TTL, serialized\)/);

const vercelConfig = JSON.parse(projectFile('vercel.json')) as {
  crons?: Array<{ path?: string }>;
};
const scheduledPaths = vercelConfig.crons?.map(({ path }) => path) ?? [];
for (const requiredPath of [
  '/api/status/checks',
  '/api/notifications/cron/plant-care',
  '/api/notifications/cron/base-audience-sync',
]) {
  assert.equal(
    scheduledPaths.includes(requiredPath),
    true,
    `existing cron consumer ${requiredPath} must be preserved`,
  );
}
assert.equal(
  scheduledPaths.includes('/api/leaderboard/stake/warm'),
  false,
  'a redundant warm cron must not be added alongside the existing consumers',
);

console.log('stake leaderboard warm retirement smoke passed');
