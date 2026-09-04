import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function loadEnvFile(fileName: string) {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function extractLua(source: string, constantName: string): string {
  const marker = `const ${constantName} = \``;
  const start = source.indexOf(marker);
  assert(start >= 0, `${constantName} is missing.`);
  const bodyStart = start + marker.length;
  const end = source.indexOf('\`;', bodyStart);
  assert(end >= 0, `${constantName} is not terminated.`);
  return source.slice(bodyStart, end);
}

function asNumbers(value: unknown): number[] {
  assert(Array.isArray(value), 'Redis script result was not an array.');
  return value.map(Number);
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const servicePath = resolve(process.cwd(), 'lib/ai-service.ts');
  const source = readFileSync(servicePath, 'utf8');
  const streamStart = source.indexOf('export async function streamAIMessage');
  const sendStart = source.indexOf('export async function sendAIMessage');
  const trackStart = source.indexOf('export async function trackAIUsage');
  assert(streamStart >= 0 && sendStart > streamStart && trackStart > sendStart, 'AI service sections are missing.');

  const streamSource = source.slice(streamStart, sendStart);
  const sendSource = source.slice(sendStart, trackStart);
  const streamOnEnd = streamSource.slice(streamSource.indexOf('onEnd: async ({ isAborted'));
  assert(streamSource.includes('reserveAIRequestBudget(address, modelConfig)'), 'Streaming generation is not reserved up front.');
  assert(sendSource.includes('reserveAIRequestBudget(address, modelConfig)'), 'Non-streaming generation is not reserved up front.');
  assert(
    streamOnEnd.indexOf('settleAIUsageReservation') < streamOnEnd.indexOf('if (streamWasAborted)'),
    'Streaming abort returns before accounting settlement.',
  );
  assert(
    streamOnEnd.indexOf('settleAIUsageReservation') < streamOnEnd.indexOf("if (!responseText.trim())"),
    'Empty streams return before accounting settlement.',
  );
  assert(
    streamOnEnd.includes('conservative: streamWasAborted || usageMeasurementIncomplete || tokensUsed === 0'),
    'Aborted streams do not conservatively settle unreported provider usage.',
  );
  assert(!streamSource.includes('trackAIUsage('), 'Streaming generation still double-charges through trackAIUsage.');
  assert(!sendSource.includes('trackAIUsage('), 'Non-streaming generation still double-charges through trackAIUsage.');
  assert(
    source.includes("throw new AIUsageAccountingUnavailableError('AI usage accounting is unavailable.')"),
    'Missing Redis does not fail AI usage accounting closed.',
  );

  const redisImport = await import('../lib/redis');
  const redis = redisImport.redis;
  if (!redis) {
    console.log(JSON.stringify({ liveRedis: 'skipped', ok: true }));
    return;
  }

  const reserveLua = extractLua(source, 'RESERVE_AI_USAGE_LUA');
  const settleLua = extractLua(source, 'SETTLE_AI_USAGE_LUA');
  const refundLua = extractLua(source, 'REFUND_AI_USAGE_LUA');
  const incrementLua = extractLua(source, 'INCREMENT_AI_USAGE_LUA');
  const id = randomUUID();
  const usageKey = `ai:accounting_smoke:usage:${id}`;
  const firstReservationKey = `ai:accounting_smoke:reservation:${id}:1`;
  const secondReservationKey = `ai:accounting_smoke:reservation:${id}:2`;
  const thirdReservationKey = `ai:accounting_smoke:reservation:${id}:3`;
  const indexKey = `ai:accounting_smoke:index:${id}`;
  const corruptUsageKey = `ai:accounting_smoke:corrupt:${id}`;
  const corruptReservationKey = `ai:accounting_smoke:corrupt_reservation:${id}`;
  const keys = [
    usageKey,
    firstReservationKey,
    secondReservationKey,
    thirdReservationKey,
    indexKey,
    corruptUsageKey,
    corruptReservationKey,
  ];

  try {
    const reserveArgs = ['2', '100', '60', '2099-01-01', '300'];
    const firstReserve = asNumbers(await redis.eval(
      reserveLua,
      [usageKey, firstReservationKey, indexKey],
      reserveArgs,
    ));
    assert(firstReserve.join(',') === '1,0,0,60', `Unexpected first reservation: ${firstReserve.join(',')}`);

    const secondReserve = asNumbers(await redis.eval(
      reserveLua,
      [usageKey, secondReservationKey, indexKey],
      reserveArgs,
    ));
    assert(secondReserve.join(',') === '1,1,60,40', `Unexpected second reservation: ${secondReserve.join(',')}`);

    const blockedReserve = asNumbers(await redis.eval(
      reserveLua,
      [usageKey, thirdReservationKey, indexKey],
      reserveArgs,
    ));
    assert(blockedReserve[0] === 0 && blockedReserve[1] === 2 && blockedReserve[2] === 100, 'Atomic caps were bypassed.');

    const settlement = asNumbers(await redis.eval(
      settleLua,
      [usageKey, firstReservationKey],
      ['12', '8', '4', '0', '0', '0', '0', 'stop', 'smoke-model', 'smoke-provider', '300'],
    ));
    assert(settlement.join(',') === '1,52', `Reservation was not settled to actual usage: ${settlement.join(',')}`);

    const duplicateSettlement = asNumbers(await redis.eval(
      settleLua,
      [usageKey, firstReservationKey],
      ['12', '8', '4', '0', '0', '0', '0', 'stop', 'smoke-model', 'smoke-provider', '300'],
    ));
    assert(duplicateSettlement[0] === 0, 'Duplicate settlement was not idempotent.');

    const refund = asNumbers(await redis.eval(
      refundLua,
      [usageKey, secondReservationKey],
      ['300'],
    ));
    assert(refund.join(',') === '1,12', `Unused reservation was not refunded: ${refund.join(',')}`);

    const increment = asNumbers(await redis.eval(
      incrementLua,
      [usageKey, indexKey],
      ['2099-01-01', '5', '3', '2', '0', '0', '0', '0', 'stop', 'smoke-model', 'smoke-provider', '300'],
    ));
    assert(increment.join(',') === '1,17', `Atomic increment failed: ${increment.join(',')}`);

    const usage = await redis.get<Record<string, unknown>>(usageKey);
    assert(usage && Number(usage.messages) === 2, 'Message accounting did not reserve, refund, and increment correctly.');
    assert(Number(usage.tokens) === 17, 'Token accounting did not settle without double charging.');
    assert(Number(usage.reservedMessages) === 0, 'Message reservation was left open.');
    assert(Number(usage.reservedTokens) === 0, 'Token reservation was left open.');

    await redis.set(corruptUsageKey, 'not-json', { ex: 300 });
    const corruptReserve = asNumbers(await redis.eval(
      reserveLua,
      [corruptUsageKey, corruptReservationKey, indexKey],
      reserveArgs,
    ));
    assert(corruptReserve[0] === -1, 'Corrupt accounting data did not fail closed.');

    console.log(JSON.stringify({ liveRedis: 'passed', ok: true }));
  } finally {
    await redis.del(...keys);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
