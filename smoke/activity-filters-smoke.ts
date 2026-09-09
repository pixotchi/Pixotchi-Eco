import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { warehouseActivityQuery } from '../lib/warehouse-activity';

import {
  ACTIVITY_CATEGORY_IDS,
  ACTIVITY_DIRECTION_IDS,
  createActivityPerspective,
  EMPTY_ACTIVITY_PERSPECTIVE,
  filterActivityEvents,
  getActivityCategory,
  getActivityDirection,
  hasActivityPerspective,
  isDirectionalActivityCategory,
  parseActivityCategory,
  parseActivityDirection,
  resolveActivityDirection,
} from '../lib/activity-filters';
import type {
  ActivityEvent,
  AttackEvent,
  BarracksRaidEvent,
  KilledEvent,
  MintEvent,
  RouletteSpinResultEvent,
} from '../lib/types';

const projectFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Fixtures. Plant 10 and land 100 belong to the viewer; 20 / 200 belong to a rival.
// ---------------------------------------------------------------------------

const viewer = createActivityPerspective(['10', '11'], ['100']);

const attack = (
  id: string,
  { attacker, winner, loser }: { attacker: string; loser: string; winner: string },
): AttackEvent => ({
  __typename: 'Attack',
  attacker,
  attackerName: `plant-${attacker}`,
  id,
  loser,
  loserName: `plant-${loser}`,
  scoresWon: '1000000000000',
  timestamp: '1700000000',
  winner,
  winnerName: `plant-${winner}`,
});

const killed = (id: string, { deadId, nftId }: { deadId: string; nftId: string }): KilledEvent => ({
  __typename: 'Killed',
  deadId,
  id,
  killer: '0xkiller',
  loserName: `plant-${deadId}`,
  nftId,
  reward: '0',
  timestamp: '1700000000',
  winnerName: `plant-${nftId}`,
});

const raid = (
  id: string,
  { attackerLandId, defenderLandId }: { attackerLandId: string; defenderLandId: string },
): BarracksRaidEvent => ({
  __typename: 'BarracksRaidEvent',
  attackerLandId,
  attackerWon: true,
  blockHeight: '1',
  defenderLandId,
  id,
  raidId: id,
  timestamp: '1700000000',
});

const mint: MintEvent = {
  __typename: 'Mint',
  id: 'mint-1',
  nftId: '10',
  timestamp: '1700000000',
};

const roulette: RouletteSpinResultEvent = {
  __typename: 'RouletteSpinResultEvent',
  bettingToken: '0xseed',
  blockHeight: '1',
  id: 'roulette-1',
  landId: '100',
  payout: '0',
  player: '0xviewer',
  timestamp: '1700000000',
  winningNumber: 7,
  won: false,
};

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

assert.equal(getActivityCategory(attack('a', { attacker: '10', loser: '20', winner: '10' })), 'attacks');
assert.equal(getActivityCategory(killed('k', { deadId: '20', nftId: '10' })), 'attacks');
assert.equal(getActivityCategory(raid('r', { attackerLandId: '100', defenderLandId: '200' })), 'attacks');
assert.equal(getActivityCategory(mint), 'plants');
assert.equal(getActivityCategory(roulette), 'casino');
assert.equal(getActivityCategory({ __typename: 'QuestFinalizedEvent' }), 'lands');
assert.equal(getActivityCategory({ __typename: 'CasinoBuiltEvent' }), 'lands');

// The category map is exhaustive over the ActivityEvent union at compile time; this
// guards the runtime contract the UI depends on.
assert.deepEqual([...ACTIVITY_CATEGORY_IDS], ['all', 'attacks', 'plants', 'lands', 'casino']);
assert.deepEqual([...ACTIVITY_DIRECTION_IDS], ['all', 'incoming', 'outgoing']);

// ---------------------------------------------------------------------------
// Direction resolution
// ---------------------------------------------------------------------------

// Viewer attacks and wins.
assert.equal(
  getActivityDirection(attack('a1', { attacker: '10', loser: '20', winner: '10' }), viewer),
  'outgoing',
);
// Viewer attacks and loses.
assert.equal(
  getActivityDirection(attack('a2', { attacker: '10', loser: '10', winner: '20' }), viewer),
  'outgoing',
);
// Viewer is attacked and loses.
assert.equal(
  getActivityDirection(attack('a3', { attacker: '20', loser: '10', winner: '20' }), viewer),
  'incoming',
);
// Regression: viewer is attacked and successfully defends. The defender only appears
// as `winner`, so this case is invisible unless winner is checked too.
assert.equal(
  getActivityDirection(attack('a4', { attacker: '20', loser: '20', winner: '10' }), viewer),
  'incoming',
);
// Unrelated plants.
assert.equal(
  getActivityDirection(attack('a5', { attacker: '20', loser: '21', winner: '20' }), viewer),
  null,
);

// Kills: nftId is the killer, deadId is the burned plant.
assert.equal(getActivityDirection(killed('k1', { deadId: '20', nftId: '10' }), viewer), 'outgoing');
assert.equal(getActivityDirection(killed('k2', { deadId: '10', nftId: '20' }), viewer), 'incoming');
assert.equal(getActivityDirection(killed('k3', { deadId: '21', nftId: '20' }), viewer), null);

// Land raids.
assert.equal(
  getActivityDirection(raid('r1', { attackerLandId: '100', defenderLandId: '200' }), viewer),
  'outgoing',
);
assert.equal(
  getActivityDirection(raid('r2', { attackerLandId: '200', defenderLandId: '100' }), viewer),
  'incoming',
);

// Non-combat events are never directional.
assert.equal(getActivityDirection(mint, viewer), null);
assert.equal(getActivityDirection(roulette, viewer), null);

// Without perspective nothing is classifiable.
assert.equal(
  getActivityDirection(attack('a6', { attacker: '20', loser: '10', winner: '20' }), EMPTY_ACTIVITY_PERSPECTIVE),
  null,
);

// ---------------------------------------------------------------------------
// Perspective helpers
// ---------------------------------------------------------------------------

assert.equal(hasActivityPerspective(viewer), true);
assert.equal(hasActivityPerspective(EMPTY_ACTIVITY_PERSPECTIVE), false);
assert.equal(hasActivityPerspective(null), false);
// Numeric plant ids from contract reads must match string ids from the indexer.
assert.equal(createActivityPerspective([10], [100]).plantIds.has('10'), true);
assert.equal(createActivityPerspective([10], [100]).landIds.has('100'), true);

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const feed: ActivityEvent[] = [
  attack('a-out', { attacker: '10', loser: '20', winner: '10' }),
  attack('a-in', { attacker: '20', loser: '20', winner: '10' }),
  killed('k-in', { deadId: '10', nftId: '20' }),
  raid('r-out', { attackerLandId: '100', defenderLandId: '200' }),
  mint,
  roulette,
];

const ids = (events: readonly ActivityEvent[]) => events.map((event) => event.id);

// 'all' with no direction returns the feed untouched (and the same reference).
assert.equal(filterActivityEvents(feed, { category: 'all' }), feed);

assert.deepEqual(
  ids(filterActivityEvents(feed, { category: 'attacks', perspective: viewer })),
  ['a-out', 'a-in', 'k-in', 'r-out'],
);
assert.deepEqual(ids(filterActivityEvents(feed, { category: 'plants' })), ['mint-1']);
assert.deepEqual(ids(filterActivityEvents(feed, { category: 'casino' })), ['roulette-1']);
assert.deepEqual(ids(filterActivityEvents(feed, { category: 'lands' })), []);

// The community ask: attacks on me only.
assert.deepEqual(
  ids(filterActivityEvents(feed, { category: 'attacks', direction: 'incoming', perspective: viewer })),
  ['a-in', 'k-in'],
);
assert.deepEqual(
  ids(filterActivityEvents(feed, { category: 'attacks', direction: 'outgoing', perspective: viewer })),
  ['a-out', 'r-out'],
);

// A stale direction must never blank out a non-combat category.
assert.deepEqual(
  ids(filterActivityEvents(feed, { category: 'plants', direction: 'incoming', perspective: viewer })),
  ['mint-1'],
);

// Direction without perspective (the public feed) degrades to no direction filter.
assert.deepEqual(
  ids(filterActivityEvents(feed, { category: 'attacks', direction: 'incoming' })),
  ['a-out', 'a-in', 'k-in', 'r-out'],
);
assert.deepEqual(
  ids(filterActivityEvents(feed, {
    category: 'attacks',
    direction: 'incoming',
    perspective: EMPTY_ACTIVITY_PERSPECTIVE,
  })),
  ['a-out', 'a-in', 'k-in', 'r-out'],
);

// ---------------------------------------------------------------------------
// Direction resolution used by the UI + URL state
// ---------------------------------------------------------------------------

assert.equal(isDirectionalActivityCategory('attacks'), true);
assert.equal(isDirectionalActivityCategory('plants'), false);
assert.equal(resolveActivityDirection('attacks', 'incoming', viewer), 'incoming');
assert.equal(resolveActivityDirection('plants', 'incoming', viewer), 'all');
assert.equal(resolveActivityDirection('attacks', 'incoming', EMPTY_ACTIVITY_PERSPECTIVE), 'all');
assert.equal(resolveActivityDirection('attacks', 'incoming', null), 'all');

assert.equal(parseActivityCategory('attacks'), 'attacks');
assert.equal(parseActivityCategory('nope'), null);
assert.equal(parseActivityCategory(null), null);
assert.equal(parseActivityDirection('outgoing'), 'outgoing');
assert.equal(parseActivityDirection('sideways'), null);

// ---------------------------------------------------------------------------
// Indexer query must cover defensive wins
// ---------------------------------------------------------------------------

const activityService = projectFile('lib/activity-service.ts');
assert.match(
  activityService,
  /attacks\([^)]*where: \{ \$\{ACTIVITY_WINDOW_FILTER\}, OR: \[\{ attacker_in: \$plantIds \}, \{ winner_in: \$plantIds \}, \{ loser_in: \$plantIds \}\]\}/,
  'GET_MY_ACTIVITY_QUERY must match attacks where the viewer defended successfully (winner_in).',
);

// ---------------------------------------------------------------------------
// Every collection must be window-bounded, and limits must not be hardcoded
// ---------------------------------------------------------------------------

// A row limit without a time bound returns the newest N of all time and lets the
// post-filter throw most of them away, which both wastes payload and silently
// truncates busy wallets. Assert the invariant per query so a newly added
// collection cannot skip it.
const QUERY_REGIONS: Array<{ limitToken: string; name: string }> = [
  { limitToken: '${ALL_ACTIVITY_LIMIT}', name: 'GET_ALL_ACTIVITY_QUERY' },
  { limitToken: '${MY_ACTIVITY_LIMIT}', name: 'GET_MY_ACTIVITY_QUERY' },
  { limitToken: '${ALL_ACTIVITY_LIMIT}', name: 'GET_ALL_BARRACKS_ACTIVITY_QUERY' },
  { limitToken: '${MY_ACTIVITY_LIMIT}', name: 'GET_MY_BARRACKS_ACTIVITY_QUERY' },
];

for (const { limitToken, name } of QUERY_REGIONS) {
  const start = activityService.indexOf(`const ${name} = \``);
  assert.notEqual(start, -1, `${name} not found`);
  const bodyStart = activityService.indexOf('`', start + `const ${name} = `.length) + 1;
  const bodyEnd = activityService.indexOf('`;', bodyStart);
  const body = activityService.slice(bodyStart, bodyEnd);

  // Inspect each actual collection declaration. The warehouse interpolation
  // also contains a window token, but is not itself a GraphQL collection.
  const collections = body.match(/\b\w+\(\s*orderBy: "timestamp"[\s\S]*?\)\s*\{/g) ?? [];
  assert.ok(collections.length > 0, `${name}: no collections found`);
  for (const collection of collections) {
    assert.ok(collection.includes('${ACTIVITY_WINDOW_FILTER}'), `${name}: collection is not window-bounded: ${collection.trim()}`);
    assert.ok(collection.includes(`limit: ${limitToken}`), `${name}: collection does not use ${limitToken}: ${collection.trim()}`);
  }
  // GraphQL rejects a declared-but-unused variable, so this must hold at runtime too.
  assert.match(body, /\$cutoff: BigInt!/, `${name} must declare the $cutoff variable`);
}

for (const limit of [100, 1000]) {
  const filter = 'timestamp_gt: $cutoff, OR: [{ landId_in: $landIds }, { plantId_in: $plantIds }]';
  const warehouse = warehouseActivityQuery(limit, filter);
  const collections = warehouse.match(/^\s*\w+\(orderBy: "timestamp"[^\n]*/gm) ?? [];
  assert.equal(collections.length, 2, 'Both Warehouse resource collections must remain queried');
  for (const collection of collections) {
    assert.ok(collection.includes(`limit: ${limit}`));
    assert.ok(collection.includes(`where: { ${filter} }`), 'Warehouse scope and window must be preserved');
  }
  assert.equal((warehouse.match(/items \{ id timestamp blockHeight landId plantId/g) ?? []).length, 2, 'Both Warehouse resources must retain source and destination identity');
}

assert.doesNotMatch(activityService, /limit: 100/, 'Row limits must come from the named constants, not literals.');
assert.match(activityService, /const INDEXER_MAX_LIMIT = 1000;/, 'Indexer ceiling must be recorded.');
assert.match(activityService, /const MY_ACTIVITY_LIMIT = INDEXER_MAX_LIMIT;/, 'Personal feed must use the full ceiling.');
assert.match(activityService, /const ALL_ACTIVITY_LIMIT = 100;/, 'Public feed stays deliberately truncated.');

// Cutoffs are bucketed so the request body is stable inside a bucket and the
// fetch cache can hit; the exact boundary still trims the response.
assert.match(activityService, /const WINDOW_CUTOFF_BUCKET_SECONDS = 60;/);
assert.match(activityService, /function getActivityWindow\(\): ActivityWindow/);
assert.match(activityService, /function filterToWindow\(activities: ActivityEvent\[\], startsAt: number\)/);
assert.doesNotMatch(activityService, /filterLast24Hours/, 'Superseded by the shared window helper.');

// Both feeds must pass the cutoff through, including the optional barracks calls.
assert.match(activityService, /fetchGraphQLData\(GET_ALL_ACTIVITY_QUERY, \{ cutoff \}\)/);
assert.match(activityService, /fetchOptionalBarracksActivity\(cutoff\)/);
assert.match(activityService, /fetchOptionalMyBarracksActivity\(landIds, cutoff\)/);

// The personal feed must hand the client the assets it was scoped to.
assert.match(activityService, /export type MyActivityFeed = \{/);
assert.match(activityService, /export function getCachedMyActivityFeed\(/);
const myActivityRoute = projectFile('app/api/activity/my/route.ts');
assert.match(myActivityRoute, /getCachedMyActivityFeed\(address\)/);
assert.match(myActivityRoute, /\{ activities, count: activities\.length, landIds, plantIds \}/);

// The shell delegates scoped URL/history ownership to the query-state bridge.
// Behavior across tab switches and history is covered by architecture-medium.
const gameShell = projectFile('app/(game)/page.tsx');
assert.match(gameShell, /useGameNavigation\(isMiniApp\)/);
const navigation = projectFile('hooks/useGameNavigation.ts');
assert.match(navigation, /key: 'tab'/);
assert.match(navigation, /useWebQueryState<Tab>/);
const queryState = projectFile('hooks/useWebQueryState.ts');
assert.match(queryState, /readWebQueryValue/);
assert.match(queryState, /writeWebQueryValue/);
assert.match(navigation, /navigateWebQueryTab/);

console.log('Activity filters smoke passed');
