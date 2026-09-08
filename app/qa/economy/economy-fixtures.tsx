"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useSeedPurchaseQuote } from '@/hooks/useSeedPurchaseQuote';
import { useMintCatalog } from '@/hooks/useMintCatalog';
import { MarketplaceOrderList } from '@/components/transactions/marketplace-order-list';
import type { MarketplaceOrder } from '@/lib/marketplace-order';
import type { Strain } from '@/lib/types';

const firstStrain: Strain = { id: 1, name: 'First', mintPrice: 100, mintPriceRaw: BigInt(100), totalSupply: 1, totalMinted: 1, maxSupply: 10, isActive: true, getStrainTotalLeft: 9, strainInitialTOD: 3600 };
const secondStrain: Strain = { ...firstStrain, id: 2, name: 'Second', mintPrice: 200, mintPriceRaw: BigInt(200) };

function QuoteFixture() {
  const [identity, setIdentity] = useState('plant:1');
  const [amount, setAmount] = useState(BigInt(100));
  const [submitted, setSubmitted] = useState(0);
  const [message, setMessage] = useState('');
  const network = useRef({ failure: false, multiplier: BigInt(2) });
  const reader = async (seedAmount: bigint) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (network.current.failure) throw new Error('Quote service unavailable');
    return { seedAmount, ethAmount: seedAmount * network.current.multiplier, ethAmountWithBuffer: seedAmount * network.current.multiplier };
  };
  const quote = useSeedPurchaseQuote(amount, true, reader, identity);
  return <section aria-label="Quote fixture" className="space-y-2">
    <h1>Economy regressions</h1>
    <p data-testid="quote-identity">{identity}</p>
    <p data-testid="quote-amount">{quote.quote?.ethAmountWithBuffer.toString() ?? 'unavailable'}</p>
    <p data-testid="quote-state">{quote.isLoading ? 'loading' : quote.error ? 'error' : 'ready'}</p>
    <button onClick={() => { setIdentity('plant:2'); setAmount(BigInt(200)); }}>Select different price</button>
    <button onClick={() => setIdentity('plant:same-price')}>Select same price</button>
    <button onClick={() => { network.current.failure = true; void quote.retry(); }}>Fail quote</button>
    <button onClick={() => { network.current.failure = false; void quote.retry(); }}>Retry ETH quote</button>
    <button onClick={() => { network.current.multiplier = BigInt(3); }}>Change market price</button>
    <button disabled={!quote.quote || quote.isLoading} onClick={async () => {
      setMessage('');
      try { await quote.requireCurrentQuote(); setSubmitted((count) => count + 1); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    }}>Submit ETH mint</button>
    <p data-testid="submissions">{submitted}</p>
    <p role="status">{message}</p>
  </section>;
}

function CatalogFixture() {
  const catalog = useMintCatalog();
  return <section aria-label="Catalog fixture" className="space-y-2">
    <button onClick={() => catalog.updateCatalog([firstStrain, secondStrain])}>Load catalog</button>
    <button onClick={() => catalog.selectStrain(2)}>Select second strain</button>
    <button onClick={() => catalog.updateCatalog([firstStrain, { ...secondStrain, mintPriceRaw: BigInt(400), totalMinted: 10 }])}>Refresh sold-out catalog</button>
    <button onClick={() => catalog.updateCatalog([firstStrain])}>Remove selected strain</button>
    <p data-testid="catalog-selection">{catalog.selectedStrainId ?? 'none'}</p>
    <p data-testid="catalog-price">{catalog.selectedStrain?.mintPriceRaw.toString() ?? 'unavailable'}</p>
    <p data-testid="catalog-remaining">{catalog.selectedStrain ? catalog.selectedStrain.maxSupply - catalog.selectedStrain.totalMinted : 'unavailable'}</p>
  </section>;
}

const orders: MarketplaceOrder[] = Array.from({ length: 101 }, (_, index) => ({ id: BigInt(101 - index), seller: '0x0000000000000000000000000000000000000001', sellToken: 1, amount: BigInt(10), amountAsk: BigInt(1), isActive: true }));

function OrdersFixture() {
  const [cancelled, setCancelled] = useState('');
  return <section aria-label="Orders fixture" className="space-y-2">
    <div aria-label="All owned orders"><MarketplaceOrderList orders={orders} pageSize={48}>{(order) => <div>Order {String(order.id)} <button onClick={() => setCancelled(String(order.id))}>Cancel order {String(order.id)}</button></div>}</MarketplaceOrderList></div>
    <div aria-label="Price level"><MarketplaceOrderList orders={orders.slice(0, 21)} pageSize={20}>{(order) => <div>Order {String(order.id)} <button onClick={() => setCancelled(String(order.id))}>Cancel order {String(order.id)}</button></div>}</MarketplaceOrderList></div>
    <p data-testid="cancelled-order">{cancelled}</p>
  </section>;
}

export function EconomyFixtures() {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><main className="space-y-8 p-6"><QuoteFixture /><CatalogFixture /><OrdersFixture /></main></QueryClientProvider>;
}
