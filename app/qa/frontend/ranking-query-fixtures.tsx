"use client";
import { useCallback, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLandLeaderboard } from '@/hooks/useLandLeaderboard';
import type { LandLeaderboardEntry } from '@/lib/land-ranking';
import { ResourceState } from '@/components/ui/resource-state';
import { Button } from '@/components/ui/button';
import { getSpinReadState } from '@/lib/spin-read-state';

function RankingQueryContent() {
  const [reads, setReads] = useState(0);
  const pending = useRef<{ resolve: (rows: LandLeaderboardEntry[]) => void; reject: (error: Error) => void } | null>(null);
  const read = useCallback(() => new Promise<LandLeaderboardEntry[]>((resolve, reject) => { pending.current = { resolve, reject }; setReads(value => value + 1); }), []);
  const ranking = useLandLeaderboard({ enabled: true, read });
  const secondObserver = useLandLeaderboard({ enabled: true, read });
  return <section aria-label="Land ranking query fixture" className="max-w-md space-y-3 rounded border bg-card p-4">
    {ranking.error ? <ResourceState status="error" title="Land ranking unavailable" description={ranking.error} onRetry={() => { void ranking.refresh(); }} />
      : ranking.loading ? <p role="status">Loading land ranking</p> : ranking.rows.length === 0 ? <p>No lands ranked yet</p> : <ol>{ranking.rows.map(row => <li key={row.landId}>{row.rank}. {row.name}</li>)}</ol>}
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => pending.current?.reject(new Error('RPC unavailable'))}>Fail ranking read</Button>
      <Button onClick={() => pending.current?.resolve([1, 2].map(id => ({ landId: id, name: `Land ${id}`, experiencePoints: BigInt(id) })))}>Resolve ranking read</Button>
    </div>
    <output aria-label="Land ranking read count">{reads}</output>
    <output aria-label="Second ranking observer count">{secondObserver.rows.length}</output>
  </section>;
}

function SpinReadFixture() {
  const [input, setInput] = useState({ hasMetadata: false, loading: false, failed: true });
  const read = getSpinReadState(input);
  return <section aria-label="Spin read fixture" className="max-w-md space-y-3 rounded border bg-card p-4">
    <h2>{read.title}</h2>
    <Button disabled={!read.canStart}>Start fixture spin</Button>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setInput({ hasMetadata: false, loading: true, failed: false })}>Retry spin read</Button>
      <Button onClick={() => setInput({ hasMetadata: true, loading: false, failed: false })}>Resolve spin read</Button>
      <Button onClick={() => setInput({ hasMetadata: true, loading: false, failed: true })}>Fail spin refresh</Button>
    </div>
  </section>;
}

export function RankingQueryFixtures() {
  const [client] = useState(() => new QueryClient());
  return <><QueryClientProvider client={client}><RankingQueryContent /></QueryClientProvider><SpinReadFixture /></>;
}
