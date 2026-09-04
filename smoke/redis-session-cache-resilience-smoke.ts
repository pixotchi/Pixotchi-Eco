import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseCachedStakeLeaderboard,
} from '../lib/stake-leaderboard-service';
import {
  parseCachedUserGameStats,
  type UserGameStats,
} from '../lib/user-stats-service';
import {
  ChatAuthError,
  resolveChatSessionReadResult,
  type ChatSessionRecord,
} from '../lib/chat-auth';

const session: ChatSessionRecord = {
  address: '0x1111111111111111111111111111111111111111',
  createdAt: 1,
  id: 'session-id',
  method: 'base-siwe',
  provider: 'base',
};

const stats: UserGameStats = {
  totalPlants: 0,
  healthyPlants: 0,
  dyingPlants: 0,
  totalPTS: 0,
  totalRewards: 0,
  totalStars: 0,
  avgLevel: 0,
  plantDetails: [],
  totalLands: 0,
  totalLandXP: 0,
  totalStoredPTS: 0,
  totalStoredTOD: 0,
  landsWithCasino: 0,
  landsWithBarracks: 0,
  landDetails: [],
  villageBuildings: [],
  townBuildings: [],
  totalDailyPTSProduction: 0,
  totalDailyTODProduction: 0,
  unclaimedPTS: 0,
  unclaimedTOD: 0,
  formattedSeedBalance: '0',
  formattedLeafBalance: '0',
  formattedPixotchiBalance: '0',
  plantsNeedingCare: [],
  timestamp: 1,
};

function main() {
  const cachedStake = [{
    address: session.address,
    ensName: 'farmer.eth',
    rank: 1,
    stakedAmount: '500000000000000000',
  }];

  for (const value of [cachedStake, JSON.stringify(cachedStake)]) {
    assert.deepEqual(parseCachedStakeLeaderboard(value), [{
      address: session.address,
      ensName: 'farmer.eth',
      rank: 1,
      stakedAmount: BigInt('500000000000000000'),
    }]);
  }
  assert.equal(parseCachedStakeLeaderboard('[{"rank":1}]'), null);
  assert.equal(parseCachedStakeLeaderboard('{'), null);

  for (const value of [stats, JSON.stringify(stats)]) {
    assert.deepEqual(parseCachedUserGameStats(value), stats);
  }
  assert.equal(parseCachedUserGameStats({ ...stats, plantDetails: [{}] }), null);
  assert.equal(parseCachedUserGameStats('{'), null);

  assert.deepEqual(
    resolveChatSessionReadResult(session.id, { status: 'ok', value: session }),
    { session, sessionId: session.id },
  );
  assert.deepEqual(
    resolveChatSessionReadResult(session.id, { status: 'missing' }),
    { session: null, sessionId: session.id },
  );
  assert.throws(
    () => resolveChatSessionReadResult(session.id, {
      status: 'unavailable',
      error: new Error('Upstash unavailable'),
    }),
    (error) => error instanceof ChatAuthError && error.status === 503,
  );

  const sessionRoute = readFileSync(
    resolve(process.cwd(), 'app/api/chat/auth/session/route.ts'),
    'utf8',
  );
  assert.match(
    sessionRoute,
    /error instanceof ChatAuthError[\s\S]*createChatAuthErrorResponse\(error\)/,
    'session route must return ChatAuthError(503) without clearing the session cookie',
  );

  console.log('Redis cache and session resilience smoke passed.');
}

main();
