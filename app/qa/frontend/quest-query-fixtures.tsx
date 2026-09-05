"use client";

import { useCallback, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLandQuestSlots } from '@/hooks/useLandQuestSlots';
import { LandQuestSummary } from '@/components/land-action-summary';
import { Button } from '@/components/ui/button';
import type { QuestSlot } from '@/lib/quest-slots';

const idleSlot: QuestSlot = { difficulty: 0, startBlock: BigInt(0), endBlock: BigInt(0), pseudoRndBlock: BigInt(0), coolDownBlock: BigInt(0) };

function QuestQueryFixtureContent() {
  const [owner, setOwner] = useState('wallet-a');
  const [land, setLand] = useState(BigInt(1));
  const [chainId, setChainId] = useState(8453);
  const [requests, setRequests] = useState(0);
  const pending = useRef(new Map<string, { resolve: (slots: QuestSlot[]) => void; reject: (error: Error) => void }>());
  const scope = `${owner}:${chainId}:${land}`;
  const read = useCallback(() => new Promise<QuestSlot[]>((resolve, reject) => {
    pending.current.set(scope, { resolve, reject });
    setRequests(value => value + 1);
  }), [scope]);
  const overview = useLandQuestSlots({ owner, chainId, landId: land, read });
  const panel = useLandQuestSlots({ owner, chainId, landId: land, read });
  return <section aria-label="Quest query fixture" className="max-w-lg space-y-3 rounded border bg-card p-4">
    <div role="region" aria-label="Quest overview observer"><LandQuestSummary quests={overview} block={BigInt(500)} /></div>
    <div role="region" aria-label="Quest panel observer"><LandQuestSummary quests={panel} block={BigInt(500)} /></div>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => pending.current.get(scope)?.resolve(Array.from({ length: owner === 'wallet-a' ? 3 : 2 }, () => idleSlot))}>Resolve current quests</Button>
      <Button onClick={() => pending.current.get(scope)?.reject(new Error('Read unavailable'))}>Fail current quests</Button>
      <Button onClick={() => setOwner('wallet-b')}>Select quest wallet B</Button>
      <Button onClick={() => setLand(BigInt(2))}>Select quest land 2</Button>
      <Button onClick={() => setChainId(84532)}>Select quest test network</Button>
      <Button onClick={() => pending.current.get('wallet-a:8453:1')?.resolve([idleSlot, idleSlot, idleSlot])}>Resolve old wallet A</Button>
    </div>
    <output aria-label="Quest network read count">{requests}</output>
    <output aria-label="Quest fixture scope">{scope}</output>
  </section>;
}

export function QuestQueryFixtures() {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><QuestQueryFixtureContent /></QueryClientProvider>;
}
