import type { Query, QueryClient } from '@tanstack/react-query';
import type { OwnerResourceInvalidationDetail } from './owner-resource-invalidation';

export type OwnerResourceQueryMeta = {
  ownerResourceRead: (options?: { blockNumber?: bigint }) => Promise<unknown>;
};

const refreshes = new WeakMap<Query, { generation: number; blockNumber?: bigint }>();

/** Keep inactive owner lists current without depending on a screen's Effects. */
export async function invalidateOwnerResourceQueries(
  client: QueryClient,
  detail: OwnerResourceInvalidationDetail,
): Promise<void> {
  const queries = client.getQueryCache().findAll({ predicate: (query) => {
    const [kind, owner] = query.queryKey;
    const domain = kind === 'plantsByOwner' ? 'plants' : kind === 'landsByOwner' ? 'lands' : null;
    return domain !== null && detail.domains.includes(domain)
      && (!detail.address || owner === detail.address);
  } });

  await Promise.all(queries.map(async (query) => {
    const previous = refreshes.get(query);
    const receipt = detail.receiptBlock === undefined ? undefined : BigInt(detail.receiptBlock);
    const refresh = {
      generation: (previous?.generation ?? 0) + 1,
      blockNumber: receipt === undefined ? previous?.blockNumber
        : previous?.blockNumber !== undefined && previous.blockNumber > receipt ? previous.blockNumber : receipt,
    };
    refreshes.set(query, refresh);
    const isCurrent = () => refreshes.get(query) === refresh;
    const filters = { queryKey: query.queryKey, exact: true };
    if (detail.clear) {
      await client.cancelQueries(filters);
      if (isCurrent()) client.removeQueries(filters);
      return;
    }
    // Invalidate before yielding: a tab opened during reconciliation must not
    // treat the pre-receipt cache as fresh. Active screens retain their stronger
    // mutation-specific invariants and own their refetch.
    await client.invalidateQueries({ ...filters, refetchType: 'none' });
    if (!isCurrent()) return;
    if (query.isActive()) return;
    const read = (query.meta as OwnerResourceQueryMeta | undefined)?.ownerResourceRead;
    if (!read) return;
    await client.cancelQueries(filters);
    if (!isCurrent()) return;
    await client.fetchQuery({
      queryKey: query.queryKey,
      meta: query.meta,
      queryFn: () => read({ blockNumber: receipt === undefined ? undefined : refresh.blockNumber }),
      staleTime: 0,
    });
  }));
}
