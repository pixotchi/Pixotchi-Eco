import { expect, test } from '@playwright/test';
import {
  getNotificationResponseError,
  parseBaseCampaignPreview,
  parseBaseCampaignResult,
  parseEligiblePlants,
  parseNotificationKeyDeletion,
  parseNotificationKeys,
  parseNotificationOutcome,
  parseNotificationStats,
  readNotificationResponse,
} from '../../lib/admin-notification-data';

const ADDRESS = '0x1234567890abcdef1234567890ABCDEF12345678';
const OTHER_ADDRESS = '0x2222222222222222222222222222222222222222';
const DATE = '2026-09-08T08:00:00.000Z';
const INVALID_COUNTS = [-1, 0.5, '1', null, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];
const INVALID_ADDRESSES = ['', 'alice.eth', '0x1234', `0x${'g'.repeat(40)}`, `0x${'1'.repeat(39)}`, `0x${'1'.repeat(41)}`, 123, null];

function campaign() {
  return {
    id: 'campaign-1', title: 'Plant reminder', message: 'Your plants need care.', status: 'completed',
    audienceMode: 'selected', requestedCount: 2, resolvedCount: 2, sentCount: 1, failedCount: 1, updatedAt: DATE,
  };
}

function plantStats() {
  return { sentCount: 2, thresholdHours: 12, totalRuns: 3, recent: [{ legacy: ['saved', null] }, 'old log'], lastRun: { details: [true, 4, null] } };
}

function neynarStats() {
  return { success: true, provider: 'neynar', stats: { plantTOD: plantStats(), global: { sentCount: 0, recent: [] }, eligibleFids: ['1', '42'] } };
}

function baseStats() {
  const snapshot = { id: 'snapshot-1', uniqueAddresses: 2, pagesFetched: 1, completedAt: DATE };
  return {
    success: true, provider: 'base', stats: {
      plantTOD: plantStats(),
      audience: { enabledCount: 2, currentSnapshot: snapshot, history: [snapshot], syncState: { cursor: null } },
      campaigns: { recent: [campaign()] },
    },
  };
}

function eligible(provider: 'base' | 'neynar') {
  return {
    success: true,
    provider,
    summary: { totalEligiblePlants: 2, throttledUsers: 0, wouldNotify: 1, ...(provider === 'base' ? { addressesWithEligiblePlants: 1 } : { fidsWithEligiblePlants: 1 }) },
    eligible: [{ ...(provider === 'base' ? { address: ADDRESS } : { fid: 42, address: ADDRESS }), userThrottled: false, plants: [{ id: 0, hoursLeft: 0, throttled: false }, { id: 2, hoursLeft: 1.5, throttled: true }] }],
  };
}

function preview() {
  return { recipients: [ADDRESS, OTHER_ADDRESS], requestedCount: 2, resolvedCount: 2, snapshotCount: null, snapshotMatchedCount: null, notes: ['Selection resolved.'] };
}

function keys() {
  return { success: true, totalKeys: 1, returnedKeys: 1, grouped: { notification: [{ key: 'notification:42', type: 'string', ttl: -1, value: { nested: ['saved', null, 5] } }] } };
}

test('Neynar stats accept the required counters and preserve raw legacy logs', () => {
  const input = neynarStats();
  expect(parseNotificationStats(input, 'neynar')).toEqual(input);
  const legacy = { ...input, provider: undefined };
  expect(parseNotificationStats(legacy, 'neynar').stats.eligibleFids).toEqual(['1', '42']);
});

test('Base stats accept snapshots, campaign history and an empty current snapshot', () => {
  const input = baseStats();
  expect(parseNotificationStats(input, 'base')).toEqual(input);
  expect(parseNotificationStats({ ...input, stats: { ...input.stats, audience: { ...input.stats.audience, currentSnapshot: null } } }, 'base').stats.audience?.currentSnapshot).toBeNull();
});

test('Stats reject absent provider-specific sections and unsuccessful envelopes', () => {
  for (const provider of ['base', 'neynar'] as const) {
    expect(() => parseNotificationStats({ success: true, stats: { plantTOD: plantStats() } }, provider)).toThrow('Invalid notification stats response. Please retry.');
    for (const success of [false, 'true', undefined]) {
      expect(() => parseNotificationStats({ ...neynarStats(), success }, provider)).toThrow('Invalid notification stats response. Please retry.');
    }
  }
});

test('Stats reject an explicit provider mismatch', () => {
  expect(() => parseNotificationStats(neynarStats(), 'base')).toThrow('Notification provider changed. Refresh the page and retry.');
  expect(() => parseNotificationStats(baseStats(), 'neynar')).toThrow('Notification provider changed. Refresh the page and retry.');
});

test('Stats reject malformed nested counters, arrays and FID strings', () => {
  const input = neynarStats();
  for (const field of ['sentCount', 'totalRuns']) {
    for (const value of INVALID_COUNTS) {
      expect(() => parseNotificationStats({ ...input, stats: { ...input.stats, plantTOD: { ...input.stats.plantTOD, [field]: value } } }, 'neynar'), `${field}: ${String(value)}`).toThrow('Invalid notification stats response.');
    }
  }
  for (const value of [0, -1, '12', null, Number.POSITIVE_INFINITY]) {
    expect(() => parseNotificationStats({ ...input, stats: { ...input.stats, plantTOD: { ...input.stats.plantTOD, thresholdHours: value } } }, 'neynar')).toThrow('Invalid notification stats response.');
  }
  const invalidStats = [
    { ...input.stats, plantTOD: { ...input.stats.plantTOD, recent: {} } },
    { ...input.stats, global: { sentCount: -1, recent: [] } },
    { ...input.stats, global: { sentCount: 1, recent: null } },
    { ...input.stats, eligibleFids: {} },
    ...[0, '0', '-1', '1.5', '01', '9007199254740992', null].map(value => ({ ...input.stats, eligibleFids: [value] })),
  ];
  for (const stats of invalidStats) expect(() => parseNotificationStats({ ...input, stats }, 'neynar')).toThrow('Invalid notification stats response.');
});

test('Base stats reject malformed audience history, snapshot dates and campaign fields', () => {
  const input = baseStats();
  const invalidAudiences = [
    { ...input.stats.audience, enabledCount: '2' },
    { ...input.stats.audience, history: {} },
    { ...input.stats.audience, history: [{ ...input.stats.audience.currentSnapshot, completedAt: 'yesterday-ish' }] },
    ...[{ uniqueAddresses: -1 }, { pagesFetched: 0.5 }, { completedAt: null }, { id: ' ' }].map(patch => ({ ...input.stats.audience, currentSnapshot: { ...input.stats.audience.currentSnapshot, ...patch } })),
  ];
  for (const audience of invalidAudiences) expect(() => parseNotificationStats({ ...input, stats: { ...input.stats, audience } }, 'base')).toThrow('Invalid notification stats response.');
  for (const patch of [{ status: 'queued' }, { audienceMode: 'segment' }, { updatedAt: 'invalid' }, { sentCount: -1 }, { resolvedCount: '2' }, { title: null }]) {
    expect(() => parseNotificationStats({ ...input, stats: { ...input.stats, campaigns: { recent: [{ ...campaign(), ...patch }] } } }, 'base')).toThrow('Invalid notification stats response.');
  }
  expect(() => parseNotificationStats({ ...input, stats: { ...input.stats, campaigns: { recent: {} } } }, 'base')).toThrow('Invalid notification stats response.');
});

test('Eligible Neynar plants accept positive integer FIDs and default the provider', () => {
  const input = eligible('neynar');
  expect(parseEligiblePlants(input, 'neynar')).toEqual(input);
  const legacy = { ...input, provider: undefined };
  expect(parseEligiblePlants(legacy, 'neynar').provider).toBe('neynar');
});

test('Eligible Base plants accept hex addresses and default the provider', () => {
  const input = eligible('base');
  expect(parseEligiblePlants(input, 'base')).toEqual(input);
  const legacy = { ...input, provider: undefined };
  expect(parseEligiblePlants(legacy, 'base').provider).toBe('base');
});

test('Eligible Neynar plants reject malformed FIDs and optional addresses', () => {
  const input = eligible('neynar');
  for (const fid of [0, -1, 0.5, '42', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => parseEligiblePlants({ ...input, eligible: [{ ...input.eligible[0], fid }] }, 'neynar'), `fid: ${String(fid)}`).toThrow('Invalid eligible plants response.');
  }
  for (const address of INVALID_ADDRESSES) {
    expect(() => parseEligiblePlants({ ...input, eligible: [{ ...input.eligible[0], address }] }, 'neynar')).toThrow('Invalid eligible plants response.');
  }
});

test('Eligible Base plants require a complete hex address', () => {
  const input = eligible('base');
  for (const address of [...INVALID_ADDRESSES, undefined]) {
    expect(() => parseEligiblePlants({ ...input, eligible: [{ ...input.eligible[0], address }] }, 'base')).toThrow('Invalid eligible plants response.');
  }
});

test('Eligible plants reject a provider mismatch', () => {
  expect(() => parseEligiblePlants(eligible('neynar'), 'base')).toThrow('Invalid eligible plants response.');
  expect(() => parseEligiblePlants(eligible('base'), 'neynar')).toThrow('Invalid eligible plants response.');
});

test('Eligible plants reject invalid summaries and malformed nested plant arrays', () => {
  for (const provider of ['base', 'neynar'] as const) {
    const input = eligible(provider);
    const identityCount = provider === 'base' ? 'addressesWithEligiblePlants' : 'fidsWithEligiblePlants';
    for (const field of ['totalEligiblePlants', 'throttledUsers', 'wouldNotify', identityCount]) {
      for (const value of [-1, 0.5, '1', undefined]) {
        expect(() => parseEligiblePlants({ ...input, summary: { ...input.summary, [field]: value } }, provider)).toThrow('Invalid eligible plants response.');
      }
    }
    expect(() => parseEligiblePlants({ ...input, eligible: {} }, provider)).toThrow('Invalid eligible plants response.');
    for (const patch of [{ userThrottled: 'false' }, { plants: {} }, { plants: [null] }, { plants: [{ id: -1, hoursLeft: 1 }] }, { plants: [{ id: 1.5, hoursLeft: 1 }] }, { plants: [{ id: 1, hoursLeft: -1 }] }, { plants: [{ id: 1, hoursLeft: '1' }] }, { plants: [{ id: 1, hoursLeft: 1, throttled: null }] }]) {
      expect(() => parseEligiblePlants({ ...input, eligible: [{ ...input.eligible[0], ...patch }] }, provider)).toThrow('Invalid eligible plants response.');
    }
  }
});

test('Missing plant throttle information defaults to throttled for both providers', () => {
  for (const provider of ['base', 'neynar'] as const) {
    const input = eligible(provider);
    const result = parseEligiblePlants({ ...input, eligible: [{ ...input.eligible[0], plants: [{ id: 1, hoursLeft: 0 }, { id: 2, hoursLeft: 2, throttled: false }] }] }, provider);
    expect(result.eligible[0].plants.map(plant => plant.throttled)).toEqual([true, false]);
  }
});

test('Grouped Redis keys retain arbitrary values and valid TTL states', () => {
  const input = keys();
  expect(parseNotificationKeys(input)).toEqual(input);
  const exactKey = 'notification:42 ';
  expect(parseNotificationKeys({ ...input, grouped: { notification: [{ ...input.grouped.notification[0], key: exactKey }] } }).grouped.notification[0].key).toBe(exactKey);
  for (const ttl of [-2, -1, 0, 3600, null]) {
    expect(parseNotificationKeys({ ...input, grouped: { notification: [{ ...input.grouped.notification[0], ttl }] } }).grouped.notification[0].ttl).toBe(ttl);
  }
});

test('Grouped Redis keys reject malformed arrays, keys, types, counters and TTLs', () => {
  const input = keys();
  for (const grouped of [null, [], { notification: {} }, { notification: [null] }]) {
    expect(() => parseNotificationKeys({ ...input, grouped })).toThrow('Invalid notification keys response.');
  }
  for (const patch of [{ key: 1 }, { key: ' ' }, { type: {} }, { type: '' }, { ttl: -3 }, { ttl: 0.5 }, { ttl: '60' }]) {
    expect(() => parseNotificationKeys({ ...input, grouped: { notification: [{ ...input.grouped.notification[0], ...patch }] } })).toThrow('Invalid notification keys response.');
  }
  for (const field of ['totalKeys', 'returnedKeys']) {
    for (const value of INVALID_COUNTS) expect(() => parseNotificationKeys({ ...input, [field]: value })).toThrow('Invalid notification keys response.');
  }
});

test('Deletion acknowledgements require a nonnegative integer count', () => {
  expect(parseNotificationKeyDeletion({ success: true, deletedCount: 0 })).toEqual({ success: true, deletedCount: 0 });
  for (const deletedCount of [...INVALID_COUNTS, undefined]) {
    expect(() => parseNotificationKeyDeletion({ success: true, deletedCount })).toThrow('Invalid notification deletion response.');
  }
});

test('Campaign previews accept recipient addresses, notes and nullable snapshot counts', () => {
  expect(parseBaseCampaignPreview({ success: true, preview: preview() })).toEqual(preview());
  const empty = { recipients: [], requestedCount: 0, resolvedCount: 0, snapshotCount: 0, snapshotMatchedCount: 0, notes: [] };
  expect(parseBaseCampaignPreview({ success: true, preview: empty })).toEqual(empty);
});

test('Campaign previews reject invalid notes, identities, counts and recipient count mismatches', () => {
  const invalidPreviews = [
    { ...preview(), notes: 'Ready' }, { ...preview(), notes: [null] }, { ...preview(), recipients: {} },
    { ...preview(), resolvedCount: 1 }, { ...preview(), requestedCount: -1 }, { ...preview(), snapshotCount: '2' }, { ...preview(), snapshotMatchedCount: -1 },
    ...INVALID_ADDRESSES.map(address => ({ ...preview(), recipients: [address, OTHER_ADDRESS] })),
  ];
  for (const value of invalidPreviews) expect(() => parseBaseCampaignPreview({ success: true, preview: value })).toThrow('Invalid campaign preview response.');
});

test('Campaign results retain the original JSON alongside validated counts', () => {
  const input = { success: true, campaign: campaign(), preview: preview(), result: { sentCount: 1, failedCount: 1, delivery: [{ payload: [null, true, 'extra'] }] }, diagnostic: { providerResponse: ['opaque'] } };
  const result = parseBaseCampaignResult(input);
  expect(result.result).toEqual({ sentCount: 1, failedCount: 1 });
  expect(result.raw).toBe(input);
  expect(result.raw).toEqual(input);
});

test('Campaign results reject malformed result counts and campaign metadata', () => {
  const input = { success: true, campaign: campaign(), preview: preview(), result: { sentCount: 1, failedCount: 1 } };
  for (const field of ['sentCount', 'failedCount']) {
    for (const value of [...INVALID_COUNTS, undefined]) expect(() => parseBaseCampaignResult({ ...input, result: { ...input.result, [field]: value } })).toThrow('Invalid campaign result response.');
  }
  expect(() => parseBaseCampaignResult({ ...input, campaign: { ...campaign(), updatedAt: 'invalid' } })).toThrow('Invalid campaign result response.');
  expect(() => parseBaseCampaignResult({ ...input, preview: { ...preview(), resolvedCount: 1 } })).toThrow('Invalid campaign result response.');
});

test('Response reading passes successful JSON through the supplied parser', async () => {
  const input = neynarStats();
  let parserCalls = 0;
  const result = await readNotificationResponse(Response.json(input), value => { parserCalls += 1; return parseNotificationStats(value, 'neynar'); }, 'Could not load stats.');
  expect(parserCalls).toBe(1);
  expect(result).toEqual(input);
});

test('Response errors narrow object error messages and skip the parser on failure', async () => {
  const fallback = 'Could not load stats.';
  let parserCalls = 0;
  const parser = (value: unknown) => { parserCalls += 1; return value; };
  for (const input of [null, 4, 'Unavailable', [], { error: 42 }, { error: { message: 'Unavailable' } }, { error: '' }, { error: '   ' }]) {
    expect(getNotificationResponseError(input, fallback)).toBe(fallback);
    await expect(readNotificationResponse(Response.json(input, { status: 503 }), parser, fallback)).rejects.toThrow(`${fallback} (HTTP 503)`);
  }
  await expect(readNotificationResponse(Response.json({ error: 'Provider unavailable' }, { status: 502 }), parser, fallback)).rejects.toThrow('Provider unavailable');
  await expect(readNotificationResponse(Response.json({ success: false, error: 'Refresh required' }), parser, fallback)).rejects.toThrow('Refresh required');
  await expect(readNotificationResponse(Response.json({ success: false, error: null }), parser, fallback)).rejects.toThrow(`${fallback} (HTTP 200)`);
  expect(parserCalls).toBe(0);
});

test('Response reading reports invalid JSON for successful and failed HTTP responses', async () => {
  const fallback = 'Could not load stats.';
  let parserCalls = 0;
  const parser = (value: unknown) => { parserCalls += 1; return value; };
  await expect(readNotificationResponse(new Response('{', { status: 200 }), parser, fallback)).rejects.toThrow(`Invalid JSON response. ${fallback}`);
  await expect(readNotificationResponse(new Response('<html>Unavailable</html>', { status: 503 }), parser, fallback)).rejects.toThrow(`${fallback} (HTTP 503)`);
  expect(parserCalls).toBe(0);
});

test('Debug outcomes validate success metadata and retain arbitrary original JSON', () => {
  const input = { success: true, debug: { recipient: [null, 42, { historic: true }], message: 'stored response' }, logs: ['one', { two: 2 }] };
  const result = parseNotificationOutcome(input);
  expect(result.success).toBe(true);
  expect(result.raw).toBe(input);
  for (const value of [null, [], 'success', { success: false }, { success: 'true' }, { success: true, completed: 'yes' }, { success: true, skipped: 1 }]) {
    expect(() => parseNotificationOutcome(value, 'debug')).toThrow('Invalid debug outcome response.');
  }
});

test('Sync outcomes require a completion boolean or an explicit skipped result', () => {
  for (const patch of [{ completed: true }, { completed: false }, { skipped: true }]) {
    const input = { success: true, ...patch, syncState: { cursor: ['opaque', null] } };
    expect(parseNotificationOutcome(input, 'sync').raw).toBe(input);
  }
  for (const value of [{ success: true }, { success: true, skipped: false }, { success: true, completed: 'true' }, { success: false, completed: true }]) {
    expect(() => parseNotificationOutcome(value, 'sync')).toThrow('Invalid sync outcome response.');
  }
});

test('Trigger outcomes require a positive FID and a sent or dry-run acknowledgement', () => {
  for (const patch of [{ sent: true }, { dryRun: true }]) {
    const input = { success: true, fid: 42, ...patch, result: { rawProviderPayload: ['opaque', null] } };
    expect(parseNotificationOutcome(input, 'trigger').raw).toBe(input);
  }
  for (const fid of [0, -1, 1.5, '42', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => parseNotificationOutcome({ success: true, fid, sent: true }, 'trigger')).toThrow('Invalid trigger outcome response.');
  }
  for (const patch of [{}, { sent: false }, { dryRun: false }, { sent: 'true' }, { dryRun: 'true' }]) {
    expect(() => parseNotificationOutcome({ success: true, fid: 42, ...patch }, 'trigger')).toThrow('Invalid trigger outcome response.');
  }
});

test('Reset outcomes require a deletion count and preserve additional JSON', () => {
  const input = { success: true, deletedCount: 0, detail: { keys: [] } };
  expect(parseNotificationOutcome(input, 'reset').raw).toBe(input);
  for (const deletedCount of [-1, '1', undefined]) {
    expect(() => parseNotificationOutcome({ success: true, deletedCount }, 'reset')).toThrow('Invalid reset outcome response.');
  }
});
