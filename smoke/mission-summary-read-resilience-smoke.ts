import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MissionProofPersistenceError,
  resolveMissionDayRead,
  resolveMissionScoreRead,
} from '../lib/gamification-service';

const DAY = '2026-09-04';

const absent = resolveMissionDayRead({ status: 'missing' }, DAY);
assert.equal(absent.date, DAY);
assert.equal(absent.pts, 0, 'a confirmed missing mission day should render an empty state');

assert.throws(
  () => resolveMissionDayRead({ status: 'unavailable', error: new Error('offline') }, DAY),
  MissionProofPersistenceError,
  'a Redis outage must not render as an empty mission day',
);
assert.throws(
  () => resolveMissionDayRead({ status: 'ok', value: 'corrupt-json' }, DAY),
  MissionProofPersistenceError,
  'corrupt mission data must not render as an empty mission day',
);

assert.equal(resolveMissionScoreRead(null), 0, 'an absent sorted-set member has a zero score');
assert.equal(resolveMissionScoreRead('17'), 17);
assert.throws(
  () => resolveMissionScoreRead('not-a-score'),
  MissionProofPersistenceError,
  'a corrupt stored score must not render as zero',
);

const routeSource = readFileSync(
  resolve(process.cwd(), 'app/api/gamification/missions/route.ts'),
  'utf8',
);
const getHandler = routeSource.slice(
  routeSource.indexOf('export async function GET'),
  routeSource.indexOf('export async function POST'),
);
assert.match(getHandler, /error instanceof MissionProofPersistenceError/);
assert.match(getHandler, /status: 503/);
assert.match(getHandler, /'Cache-Control': 'private, no-store'/);

console.log('mission summary read resilience smoke: ok');
