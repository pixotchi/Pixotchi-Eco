"use client";
import { useCallback, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSwapQuote, type SwapQuoteReader } from '@/hooks/useSwapQuote';
import { useBarracksSnapshot, type BarracksSnapshotV2 } from '@/hooks/useBarracksSnapshot';
import { useStakeLeaderboard, useRocksLeaderboard, type RankingReader } from '@/hooks/useApiLeaderboards';
import { AmountField } from '@/components/ui/amount-field';
import { ResourceState } from '@/components/ui/resource-state';
import { Button } from '@/components/ui/button';
import { fixtureAddress, fixtureBarracks, fixtureQuote } from './controller-data';

type Pending<T> = { resolve: (value: T) => void; reject: (error: unknown) => void };
const sectionClass = 'max-w-xl space-y-3 rounded border bg-card p-4';
function SwapQuoteFixture() {
  const [amount, setAmount] = useState('1');
  const [owner, setOwner] = useState(fixtureAddress);
  const [visible, setVisible] = useState(true);
  const [reads, setReads] = useState(0);
  const pending = useRef<Array<Pending<unknown> & { amount: bigint; owner?: string; signal?: AbortSignal }>>([]);
  const read: SwapQuoteReader = useCallback((request, signal) => new Promise((resolve, reject) => {
    pending.current.push({ resolve, reject, amount: request.amountIn, owner: request.originAddress, signal });
    setReads(n => n + 1);
  }), []);
  const { quoteState, refreshQuoteNow } = useSwapQuote({ address: owner, sellToken: 'ETH', buyToken: 'SEED',
    amountIn: /^\d+$/.test(amount) ? BigInt(amount) : null, visible, executing: false, deferred: false, read });
  const resolve = (index: number) => {
    const request = pending.current[index];
    if (request) request.resolve(fixtureQuote({ amountIn: request.amount }));
  };
  return <section aria-label="Swap controller fixture" className={sectionClass}>
    <AmountField label="Quote amount" unit="wei" value={amount} onChange={event => setAmount(event.target.value)} />
    <output aria-label="Quote state">{quoteState.status === 'ready' ? `Ready ${quoteState.quote.amountIn}` : quoteState.status}</output>
    <output aria-label="Quote reads">{reads}</output>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => resolve(0)}>Resolve first quote</Button>
      <Button onClick={() => resolve(pending.current.length - 1)}>Resolve newest quote</Button>
      <Button onClick={() => { pending.current.at(-1)?.resolve({}); }}>Return malformed quote</Button>
      <Button onClick={() => { void refreshQuoteNow(); }}>Retry quote</Button>
      <Button onClick={() => setOwner(`0x${'2'.repeat(40)}`)}>Change quote wallet</Button>
      <Button onClick={() => setVisible(value => !value)}>{visible ? 'Hide quote panel' : 'Show quote panel'}</Button>
    </div>
  </section>;
}

function BarracksControllerFixture() {
  const [landId, setLandId] = useState(BigInt(1));
  const [reads, setReads] = useState(0);
  const pending = useRef<Array<Pending<BarracksSnapshotV2> & { landId: bigint }>>([]);
  const read = useCallback((id: bigint) => new Promise<BarracksSnapshotV2>((resolve, reject) => {
    pending.current.push({ landId: id, resolve, reject }); setReads(n => n + 1);
  }), []);
  const snapshot = useBarracksSnapshot({ landId, read });
  return <section aria-label="Barracks controller fixture" className={sectionClass}>
    <output aria-label="Barracks land">Land {landId.toString()}</output>
    <output aria-label="Barracks reads">{reads}</output>
    {snapshot.loading ? <p role="status">Loading army</p> : !snapshot.landState ? <ResourceState status="error" title="Army unavailable" onRetry={() => { void snapshot.loadState(); }} />
      : <output aria-label="Stationed army">{snapshot.landState.stationedSwordsmanTroops.toString()} swordsmen</output>}
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setLandId(BigInt(2))}>Change Barracks land</Button>
      <Button onClick={() => { pending.current.filter(request => request.landId === BigInt(1)).forEach(request => request.resolve(fixtureBarracks(request.landId))); }}>Resolve first army</Button>
      <Button onClick={() => { const request = pending.current.at(-1); request?.resolve(fixtureBarracks(request.landId)); }}>Resolve newest army</Button>
      <Button onClick={() => pending.current.at(-1)?.reject(new Error('Unavailable'))}>Fail army read</Button>
      <Button onClick={() => { void snapshot.loadState(false); }}>Refresh army</Button>
    </div>
  </section>;
}

function ApiRankingContent() {
  const [reads, setReads] = useState(0);
  const [rocksVisible, setRocksVisible] = useState(true);
  const stakePending = useRef<Pending<unknown> | null>(null);
  const rocksPending = useRef<Pending<unknown> | null>(null);
  const readStake: RankingReader = useCallback(() => new Promise((resolve, reject) => { stakePending.current = { resolve, reject }; setReads(n => n + 1); }), []);
  const readRocks: RankingReader = useCallback(() => new Promise((resolve, reject) => { rocksPending.current = { resolve, reject }; }), []);
  const stake = useStakeLeaderboard({ enabled: true, read: readStake });
  const second = useStakeLeaderboard({ enabled: true, read: readStake });
  const rocks = useRocksLeaderboard({ enabled: rocksVisible, read: readRocks });
  return <section aria-label="API ranking controller fixture" className={sectionClass}>
    {stake.error ? <ResourceState status="error" title="Stake unavailable" onRetry={() => { void stake.refresh(); }} />
      : stake.loading ? <p role="status">Loading stake</p> : <output aria-label="Stake entries">{stake.rows.length}</output>}
    <output aria-label="Stake reads">{reads}</output><output aria-label="Other stake observer">{second.rows.length}</output>
    {rocksVisible && <output aria-label="Rocks availability">{rocks.disabledNotice ?? (rocks.loading ? 'Loading Rocks' : 'Available')}</output>}
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => stakePending.current?.resolve({ success: true, leaderboard: [{}] })}>Return malformed stake</Button>
      <Button onClick={() => stakePending.current?.resolve({ success: true, leaderboard: [{ rank: 1, address: fixtureAddress, stakedAmount: '1000000000000000000' }] })}>Resolve stake</Button>
      <Button onClick={() => rocksPending.current?.resolve({ success: true, disabled: true, message: 'Season paused', leaderboard: [] })}>Pause Rocks service</Button>
      <Button onClick={() => setRocksVisible(value => !value)}>{rocksVisible ? 'Hide Rocks board' : 'Show Rocks board'}</Button>
    </div>
  </section>;
}
export function ControllerFixtures() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <><SwapQuoteFixture /><BarracksControllerFixture /><QueryClientProvider client={client}><ApiRankingContent /></QueryClientProvider></>;
}
