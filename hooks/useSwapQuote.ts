"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSwapJson, parseSwapQuote, SwapRequestError } from '@/lib/swap/response';
import type { SwapQuoteResponse, UserSwapTokenId } from '@/lib/swap/types';
import { waitForMonitorDelay } from '@/lib/transaction-monitor';

export type QuoteState = { status: 'idle' } | { status: 'loading'; retryAttempt?: number }
  | { status: 'ready'; quote: SwapQuoteResponse } | { status: 'error'; error: string; retriable: boolean };
type QuoteRequest = { sellToken: UserSwapTokenId; buyToken: UserSwapTokenId; amountIn: bigint; originAddress?: string };
export type SwapQuoteReader = (request: QuoteRequest, signal?: AbortSignal) => Promise<unknown>;
const readQuote: SwapQuoteReader = (request, signal) => fetchSwapJson('/api/swap/quote', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', signal,
  body: JSON.stringify({ ...request, amountIn: request.amountIn.toString() }),
});
const transient = (error: unknown) => !(error instanceof SwapRequestError) || error.status === undefined || error.status === 429 || error.status >= 500;

/** One quote authority for debounce, idle refresh, explicit Retry and submission refresh. */
export function useSwapQuote({ address, sellToken, buyToken, amountIn, visible, executing, deferred, read = readQuote }: {
  address?: string; sellToken: UserSwapTokenId; buyToken: UserSwapTokenId; amountIn: bigint | null;
  visible: boolean; executing: boolean; deferred: boolean; read?: SwapQuoteReader;
}) {
  const scope = `${address?.toLowerCase() ?? 'disconnected'}:${sellToken}:${buyToken}:${amountIn ?? ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const sequence = useRef(0);
  const active = useRef<AbortController | null>(null);
  const activity = useRef(0);
  const [stored, setStored] = useState<{ scope: string; value: QuoteState }>({ scope, value: { status: 'idle' } });
  const quoteState: QuoteState = stored.scope === scope ? stored.value : { status: 'idle' };
  const markQuoteActivity = useCallback(() => { activity.current = Date.now(); }, []);
  const fetchQuoteOnce = useCallback(async (amount: bigint, signal?: AbortSignal) => {
    const request = { sellToken, buyToken, amountIn: amount, originAddress: address };
    return parseSwapQuote(await read(request, signal), request);
  }, [address, buyToken, read, sellToken]);

  const refresh = useCallback(async (background = false, automatic = false): Promise<SwapQuoteResponse | null> => {
    if (!amountIn || amountIn <= BigInt(0) || !visible) return null;
    if (background && active.current) return null;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const requestId = ++sequence.current;
    const current = () => !controller.signal.aborted && currentScope.current === scope && sequence.current === requestId;
    if (!background) setStored({ scope, value: { status: 'loading' } });
    try {
      let quote: SwapQuoteResponse;
      for (let attempt = 0; ; attempt++) {
        try { quote = await fetchQuoteOnce(amountIn, controller.signal); break; }
        catch (error) {
          if (!current() || !automatic || !transient(error) || attempt >= 2) throw error;
          setStored({ scope, value: { status: 'loading', retryAttempt: attempt + 1 } });
          await waitForMonitorDelay(400 * 2 ** attempt, controller.signal);
        }
      }
      if (!current()) return null;
      setStored({ scope, value: { status: 'ready', quote } });
      return quote;
    } catch (error) {
      if (!current()) return null;
      const failure: QuoteState = { status: 'error', error: error instanceof Error ? error.message : 'Failed to fetch swap quote', retriable: transient(error) };
      setStored(previous => background && previous.scope === scope && previous.value.status === 'ready' ? previous : { scope, value: failure });
      return null;
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, [amountIn, fetchQuoteOnce, scope, visible]);

  useEffect(() => {
    markQuoteActivity();
    if (!visible || !amountIn || amountIn <= BigInt(0)) {
      setStored({ scope, value: { status: 'idle' } });
      return;
    }
    let disposed = false;
    // Transport retries stay bounded and are cancelled with this exact draft.
    const attempt = async () => {
      if (disposed) return;
      await refresh(false, true);
    };
    const timer = setTimeout(() => { void attempt(); }, 250);
    return () => { disposed = true; clearTimeout(timer); active.current?.abort(); active.current = null; };
  }, [amountIn, markQuoteActivity, refresh, scope, visible]);

  useEffect(() => {
    if (!visible || executing || deferred || quoteState.status === 'loading') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - activity.current >= 5_000) void refresh(true);
    }, 5_000);
    return () => clearInterval(timer);
  }, [deferred, executing, quoteState.status, refresh, visible]);

  const refreshQuoteNow = useCallback(() => refresh(), [refresh]);
  return { quoteState, fetchQuoteOnce, refreshQuoteNow, markQuoteActivity };
}
