"use client";

import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import {
  isAbortError,
  onOwnerResourceInvalidation,
  ownerInvalidationMatches,
  retryOwnerRead,
  type OwnerResourceInvalidationDetail,
} from "@/lib/owner-resource-invalidation";

/**
 * One owner-scoped onchain list (plants, lands, ...) with React Query as the
 * single source of truth.
 *
 * Why this exists
 * ---------------
 * Plants and Lands each used to run their own imperative read: a `fetchQuery`
 * call whose result was copied into `useState` behind a stack of generation /
 * pending / queued / abort guards, plus a 30s "already refreshed" timestamp
 * that gated the only re-fetch path.
 *
 * That shape had a fatal failure mode. `<Activity mode="hidden">` and React
 * StrictMode both run effect cleanups without a real unmount, so the
 * `useEffect(() => () => abortRef.current?.abort(), [])` cleanup aborted a read
 * that was still in flight. The read then completed normally and wrote the data
 * into the query cache, but the copy step saw `signal.aborted` and returned
 * without committing, while its `finally` still cleared `loading`. The view
 * settled on "No Lands Yet!" with the real data sitting in the cache one layer
 * below, and the 30s guard — already burned by the aborted attempt — blocked
 * every retry.
 *
 * The fix is structural rather than another guard: nothing copies query data
 * into component state any more. Every read path writes into the cache and the
 * mounted `useQuery` observer renders it, so a cancelled reconciliation can
 * never strand a view that has data. Cancellation now only stops further
 * polling; it can no longer discard a result.
 *
 * Owner isolation is structural too. The query key carries the owner, so a late
 * read for wallet A writes into wallet A's entry and is invisible to wallet B —
 * no generation counter required.
 */

export type OwnerResourceListDomain = "plants" | "lands";

export type OwnerResourceInvariant<TItem> = (items: TItem[]) => boolean;

export type OwnerResourceReconcileOptions<TItem> = {
  /** Bypass `staleTime` and read from chain even if the cache looks fresh. */
  force?: boolean;
  /**
   * Post-transaction invariant. The read repeats on a bounded backoff until the
   * chain reflects the mutation, so a confirmed action never leaves the UI
   * showing pre-transaction state.
   */
  until?: OwnerResourceInvariant<TItem>;
};

type UseOwnerResourceListOptions<TItem> = {
  /**
   * Derives the reconciliation invariant for an external invalidation event.
   * Returning `undefined` performs a single forced read instead of polling.
   */
  buildInvariant?: (
    detail: OwnerResourceInvalidationDetail,
    baseline: TItem[],
  ) => OwnerResourceInvariant<TItem> | undefined;
  domain: OwnerResourceListDomain;
  /** Extra gating on top of "an owner is connected". */
  enabled?: boolean;
  /** Cache lifetime after the last observer unmounts. */
  gcTimeMs?: number;
  /** In-app tab visibility. Background polling only runs while visible. */
  isVisible: boolean;
  /** Local state to drop when the wallet disconnects. */
  onClear?: () => void;
  ownerKey: string | null;
  queryFn: () => Promise<TItem[]>;
  queryKey: QueryKey;
  /** Background refresh cadence while visible. `0` disables polling. */
  refetchIntervalMs?: number;
  /**
   * Lets a view ignore invalidations it already answers itself with a stronger
   * invariant, so the shared listener cannot cancel that reconciliation.
   */
  shouldHandleInvalidation?: (detail: OwnerResourceInvalidationDetail) => boolean;
  staleTimeMs?: number;
};

export type OwnerResourceListResult<TItem> = {
  error: unknown;
  isError: boolean;
  /** True only while the first read for this owner is still outstanding. */
  isLoading: boolean;
  items: TItem[];
  reconcile: (options?: OwnerResourceReconcileOptions<TItem>) => Promise<void>;
};

const DEFAULT_STALE_TIME_MS = 30_000;
const DEFAULT_GC_TIME_MS = 5 * 60_000;
const DEFAULT_REFETCH_INTERVAL_MS = 60_000;

// One shared, frozen instance so `items` keeps a stable identity while a query
// has no data. An unstable empty array would churn every consumer's effects.
const EMPTY_LIST: readonly never[] = Object.freeze([]);

export function useOwnerResourceList<TItem>({
  buildInvariant,
  domain,
  enabled = true,
  gcTimeMs = DEFAULT_GC_TIME_MS,
  isVisible,
  onClear,
  ownerKey,
  queryFn,
  queryKey,
  refetchIntervalMs = DEFAULT_REFETCH_INTERVAL_MS,
  shouldHandleInvalidation,
  staleTimeMs = DEFAULT_STALE_TIME_MS,
}: UseOwnerResourceListOptions<TItem>): OwnerResourceListResult<TItem> {
  const queryClient = useQueryClient();
  const isEnabled = Boolean(ownerKey) && enabled;

  const query = useQuery<TItem[]>({
    enabled: isEnabled,
    gcTime: gcTimeMs,
    queryFn,
    queryKey,
    // React Query's focus manager already listens for `visibilitychange`, and
    // the reconnect hook covers `online`. Both used to be hand-wired listeners
    // behind a 15s throttle in each view.
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    // Only the visible tab polls: a hidden <Activity> unmounts this observer,
    // and a backgrounded document pauses the interval on its own.
    refetchInterval: isVisible && refetchIntervalMs > 0 ? refetchIntervalMs : false,
    staleTime: staleTimeMs,
  });

  const items = (query.data ?? (EMPTY_LIST as unknown as TItem[]));

  // Read paths capture these at call time rather than closing over them, so
  // `reconcile` keeps a stable identity across renders. An unstable callback is
  // what made the old visibility effect re-run (and re-arm its 30s guard) on
  // every data change.
  const itemsRef = useRef(items);
  const ownerKeyRef = useRef(ownerKey);
  const queryFnRef = useRef(queryFn);
  const queryKeyRef = useRef(queryKey);
  const staleTimeRef = useRef(staleTimeMs);
  itemsRef.current = items;
  ownerKeyRef.current = ownerKey;
  queryFnRef.current = queryFn;
  queryKeyRef.current = queryKey;
  staleTimeRef.current = staleTimeMs;

  // Reconciliations run concurrently rather than superseding each other. Each
  // post-transaction pass carries its own acceptance invariant, so cancelling an
  // in-flight one (as a single-slot ref would) could drop the very check that
  // proves a confirmed mutation is visible. React Query deduplicates the reads
  // underneath, so overlapping passes cost no extra round-trips.
  const activeReconcilesRef = useRef(new Set<AbortController>());

  const reconcile = useCallback(
    async ({ force = false, until }: OwnerResourceReconcileOptions<TItem> = {}) => {
      const owner = ownerKeyRef.current;
      if (!owner) return;

      // A plain refresh is fully subsumed by any pass already running; only an
      // invariant-bearing pass has a reason of its own to keep polling.
      if (!until && activeReconcilesRef.current.size > 0) return;

      // Capture the identity of this reconciliation up front. The key contains
      // the owner, so even a read that lands after a wallet switch writes into
      // the wallet it was started for and can never bleed across accounts.
      const key = queryKeyRef.current;
      const read = queryFnRef.current;
      const staleTime = staleTimeRef.current;

      const controller = new AbortController();
      activeReconcilesRef.current.add(controller);

      const readOnce = async () => {
        if (force || until) {
          await queryClient.invalidateQueries({
            exact: true,
            queryKey: key,
            refetchType: "none",
          });
        }
        // fetchQuery writes straight into the cache, so the mounted observer
        // renders the result even if this reconciliation is cancelled a moment
        // later. Concurrent calls for the same key are deduped by React Query.
        return queryClient.fetchQuery<TItem[]>({
          queryFn: read,
          queryKey: key,
          staleTime: force || until ? 0 : staleTime,
        });
      };

      try {
        if (until) {
          await retryOwnerRead(readOnce, { accept: until, signal: controller.signal });
        } else {
          await readOnce();
        }
      } catch (error) {
        // A cancelled reconciliation is routine (wallet switch, unmount). Any
        // real read failure is already recorded on the query itself, which owns
        // retry and error surfacing.
        if (!isAbortError(error)) {
          console.error(`Failed to reconcile ${domain}:`, error);
        }
      } finally {
        activeReconcilesRef.current.delete(controller);
      }
    },
    [domain, queryClient],
  );

  const abortAllReconciles = useCallback(() => {
    for (const controller of activeReconcilesRef.current) controller.abort();
    activeReconcilesRef.current.clear();
  }, []);

  // Stop polling when the owner changes or the view goes away. This only ends
  // the reconciliation loop; anything already fetched is in the cache.
  useEffect(() => {
    return abortAllReconciles;
  }, [abortAllReconciles, ownerKey]);

  const buildInvariantRef = useRef(buildInvariant);
  const onClearRef = useRef(onClear);
  const shouldHandleInvalidationRef = useRef(shouldHandleInvalidation);
  buildInvariantRef.current = buildInvariant;
  onClearRef.current = onClear;
  shouldHandleInvalidationRef.current = shouldHandleInvalidation;

  useEffect(() => {
    return onOwnerResourceInvalidation((detail) => {
      if (!ownerInvalidationMatches(detail, ownerKeyRef.current, domain)) return;

      if (detail.clear) {
        abortAllReconciles();
        queryClient.removeQueries({ exact: true, queryKey: queryKeyRef.current });
        onClearRef.current?.();
        return;
      }

      if (shouldHandleInvalidationRef.current?.(detail) === false) return;

      const until = buildInvariantRef.current?.(detail, itemsRef.current);
      void reconcile({ force: detail.force, until });
    });
  }, [abortAllReconciles, domain, queryClient, reconcile]);

  return {
    error: query.error,
    isError: query.isError,
    // Never report loading once data exists: a background refresh must not
    // replace a rendered farm with a skeleton.
    isLoading: isEnabled && query.isPending,
    items,
    reconcile,
  };
}
