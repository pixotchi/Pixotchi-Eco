"use client";

import { useCallback, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useSeedPurchaseQuote } from '@/hooks/useSeedPurchaseQuote';
import type { SeedPurchaseQuote } from '@/lib/swap/seed-purchase-quote';

const unit = BigInt('37500000000000000000000');

function SeedPurchaseQuoteFixtureContent() {
  const [quantity, setQuantity] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [requests, setRequests] = useState(0);
  const pending = useRef(new Map<string, { resolve: (quote: SeedPurchaseQuote) => void; reject: (error: Error) => void }>());
  const read = useCallback((amount: bigint) => new Promise<SeedPurchaseQuote>((resolve, reject) => {
    pending.current.set(amount.toString(), { resolve, reject });
    setRequests(value => value + 1);
  }), []);
  const amount = unit * BigInt(quantity);
  const { quote, isLoading, error, retry } = useSeedPurchaseQuote(amount, enabled, read);
  const resolve = (value: bigint) => pending.current.get(value.toString())?.resolve({
    seedAmount: value, ethAmount: value / BigInt(1000), ethAmountWithBuffer: value / BigInt(900),
  });

  return <section aria-label="SEED purchase quote fixture" className="max-w-lg space-y-3 rounded border bg-card p-4">
    <output aria-label="Quoted SEED amount">{quote?.seedAmount.toString() ?? 'none'}</output>
    <output aria-label="Quote read count">{requests}</output>
    <p role="status">{isLoading ? 'Updating ETH quote' : error ? 'ETH quote unavailable' : quote ? 'Quote ready' : 'No ETH quote'}</p>
    <Button disabled={!quote || isLoading}>Submit quoted purchase</Button>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setQuantity(10)}>Select ten items</Button>
      <Button onClick={() => setQuantity(0)}>Clear quantity</Button>
      <Button onClick={() => resolve(amount)}>Resolve current quote</Button>
      <Button onClick={() => resolve(unit)}>Resolve old one-item quote</Button>
      <Button onClick={() => pending.current.get(amount.toString())?.reject(new Error('RPC unavailable'))}>Fail current quote</Button>
      <Button onClick={() => void retry()}>Refresh ETH quote</Button>
      <Button onClick={() => setEnabled(false)}>Use SEED payment</Button>
    </div>
  </section>;
}

export function SeedPurchaseQuoteFixtures() {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><SeedPurchaseQuoteFixtureContent /></QueryClientProvider>;
}
