import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { invalidateOwnerResourceQueries } from '../lib/owner-resource-query-cache';
import type { OwnerResourceInvalidationDetail } from '../lib/owner-resource-invalidation';
import { getPlantLifetime } from '../lib/plant-lifetime';
import { isDeterministicBaseRpcError } from '../lib/base-rpc';
import { filterActivityEvents } from '../lib/activity-filters';
import type { WarehouseAssignmentEvent } from '../lib/types';
import { normalizeWarehouseActivity } from '../lib/warehouse-activity';

async function main() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['plantsByOwner', 'alice'];
  const reads: (bigint | undefined)[] = [];
  const read = async (options?: { blockNumber?: bigint }) => {
    reads.push(options?.blockNumber);
    return [{ score: Number(options?.blockNumber ?? 1) }];
  };
  await client.fetchQuery({ queryKey: key, queryFn: () => read(), meta: { ownerResourceRead: read }, staleTime: 60_000 });
  client.setQueryData(['plantsByOwner', 'bob'], [{ score: 9 }]);
  client.setQueryData(['landsByOwner', 'alice'], [{ level: 2 }]);
  const detail = (block: number): OwnerResourceInvalidationDetail => ({ address: 'alice', domains: ['plants'], eventId: `test:${block}`, force: true, requestedAt: Date.now(), receiptBlock: block });
  // A hidden Activity has no active query subscription. Its still-fresh cache
  // must update at the receipt block before the player returns to the screen.
  await invalidateOwnerResourceQueries(client, detail(100));
  assert.deepEqual(client.getQueryData(key), [{ score: 100 }]);
  assert.deepEqual(client.getQueryData(['plantsByOwner', 'bob']), [{ score: 9 }]);
  assert.deepEqual(client.getQueryData(['landsByOwner', 'alice']), [{ level: 2 }]);

  // Overlapping receipt notifications must not deduplicate onto an older read.
  await Promise.all([invalidateOwnerResourceQueries(client, detail(102)), invalidateOwnerResourceQueries(client, detail(101))]);
  assert.deepEqual(client.getQueryData(key), [{ score: 102 }]);
  assert.equal(reads.at(-1), BigInt(102));
  await invalidateOwnerResourceQueries(client, { ...detail(103), receiptBlock: undefined });
  assert.equal(reads.at(-1), undefined, 'ordinary refreshes must read latest, not reuse an old receipt snapshot');

  const observer = new QueryObserver(client, { queryKey: key, queryFn: () => read(), staleTime: Infinity, meta: { ownerResourceRead: read } });
  const unsubscribe = observer.subscribe(() => {});
  const before = reads.length;
  await invalidateOwnerResourceQueries(client, detail(103));
  assert.equal(reads.length, before, 'active screens retain ownership of their reconciliation');
  assert.equal(client.getQueryState(key)?.isInvalidated, true);
  unsubscribe();
  await invalidateOwnerResourceQueries(client, { ...detail(104), clear: true });
  assert.equal(client.getQueryState(key), undefined);
  client.clear();

  const now = 1_788_566_000;
  assert.equal(getPlantLifetime(now + 450_000, now).timeUntilStarvingHours, 125);
  assert.equal(getPlantLifetime(now - 1, now).timeUntilStarvingSeconds, 0);
  assert.equal(getPlantLifetime(0, now).timeUntilStarvingHours, 0);
  assert.equal(getPlantLifetime(now, now).timeUntilStarvingSeconds, 0);

  const restricted = { code: -32600, message: 'Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range. Upgrade to PAYG.' };
  assert.equal(isDeterministicBaseRpcError(restricted), false);
  assert.equal(isDeterministicBaseRpcError({ code: -32600, message: 'Invalid JSON RPC request.', cause: restricted }), false, 'wrapped plan restrictions must allow fallback');
  assert.equal(isDeterministicBaseRpcError({ code: -32602, message: 'invalid address' }), true);
  assert.equal(isDeterministicBaseRpcError({ code: 3, message: 'execution reverted' }), true);

  const event: WarehouseAssignmentEvent = { __typename: 'WarehouseAssignmentEvent', id: 'warehouse:1', timestamp: String(now), blockHeight: '100', landId: '712', plantId: '22419', resource: 'points', amount: '1000000000000' };
  assert.equal(filterActivityEvents([event], { category: 'lands' }).length, 1);
  assert.equal(filterActivityEvents([event], { category: 'all' }).length, 1);
  assert.equal(filterActivityEvents([event], { category: 'casino' }).length, 0);
  const normalized = normalizeWarehouseActivity({
    plantPointsAssignedEvents: { items: [{ ...event, addedPoints: '1000000000000' }] },
    plantLifetimeAssignedEvents: { items: [{ ...event, lifetime: '3600' }] },
  });
  assert.deepEqual(normalized.map(({ resource, amount }) => ({ resource, amount })), [{ resource: 'points', amount: '1000000000000' }, { resource: 'lifetime', amount: '3600' }]);
  assert.notEqual(normalized[0].id, normalized[1].id, 'different event types must not collide');
  console.log('UI/UX audit regression checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
