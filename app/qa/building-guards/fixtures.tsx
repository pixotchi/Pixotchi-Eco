"use client";

import { useCallback, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useQuestRewardsAvailability, type QuestRewardsSnapshot } from '@/hooks/useQuestRewardsAvailability';
import { useBarracksRaidPreview } from '@/hooks/useBarracksRaidPreview';
import { requireQuestFinalizeReady, getQuestRewardRequirements } from '@/lib/quest-rewards-readiness';
import { fixtureQuestConfiguration } from './quest-data';
import type { BarracksRaidPreviewV2 } from '@/lib/types';

const rewardFunding: QuestRewardsSnapshot = {
  seedBalance: getQuestRewardRequirements(fixtureQuestConfiguration).seed, seedAllowance: getQuestRewardRequirements(fixtureQuestConfiguration).seed,
  leafBalance: getQuestRewardRequirements(fixtureQuestConfiguration).leaf, leafAllowance: getQuestRewardRequirements(fixtureQuestConfiguration).leaf,
  configuration: fixtureQuestConfiguration,
  sources: { seed: '0x0000000000000000000000000000000000000001', leaf: '0x0000000000000000000000000000000000000002', resolvedOnchain: true },
};

function QuestRewardFixture() {
  const pending = useRef<{ resolve: (value: QuestRewardsSnapshot) => void; reject: (error: Error) => void } | null>(null);
  const [reads, setReads] = useState(0);
  const [submissions, setSubmissions] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [openSubmissions, setOpenSubmissions] = useState(0);
  const simulation = useRef<{ resolve: (result: boolean) => void; reject: (error: Error) => void } | null>(null);
  const read = useCallback(() => new Promise<QuestRewardsSnapshot>((resolve, reject) => {
    pending.current = { resolve, reject };
    setReads(count => count + 1);
  }), []);
  const rewards = useQuestRewardsAvailability(true, read);
  return <section aria-label="Quest return funding" className="space-y-2 rounded border p-4">
    <p>Rewards: {rewards.error ? 'error' : !rewards.isReady ? 'checking' : rewards.isUnavailable ? 'unavailable' : 'ready'}</p>
    <button disabled={!rewards.isReady || rewards.isUnavailable || submitting} onClick={async () => {
      setSubmitting(true); setMessage('');
      try { await rewards.requireReady(); setSubmissions(count => count + 1); }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Unavailable'); }
      finally { setSubmitting(false); }
    }}>Return farmer</button>
    <button onClick={() => pending.current?.resolve(rewardFunding)}>Resolve funded rewards</button>
    <button onClick={() => pending.current?.resolve({ ...rewardFunding, seedAllowance: BigInt(0) })}>Resolve depleted rewards</button>
    <button onClick={() => pending.current?.resolve({ ...rewardFunding, configuration: {
      ...fixtureQuestConfiguration, ranges: { ...fixtureQuestConfiguration.ranges, maxSeedReward: fixtureQuestConfiguration.ranges.maxSeedReward + BigInt(1) },
    } })}>Resolve increased reward range</button>
    <button onClick={() => pending.current?.reject(new Error('Read unavailable'))}>Fail reward read</button>
    <button onClick={() => pending.current?.reject(new Error('Quest configuration unavailable'))}>Fail quest settings read</button>
    <button disabled={rewards.isRefreshing} onClick={() => void rewards.refresh()}>Retry reward read</button>
    <button onClick={async () => {
      setMessage('');
      try {
        await requireQuestFinalizeReady(() => new Promise<boolean>((resolve, reject) => { simulation.current = { resolve, reject }; }), () => true);
        setOpenSubmissions(count => count + 1);
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Unavailable'); }
    }}>Open committed loot</button>
    <button onClick={() => simulation.current?.resolve(true)}>Resolve payable loot</button>
    <button onClick={() => simulation.current?.resolve(false)}>Resolve expired loot</button>
    <button onClick={() => simulation.current?.reject(new Error('Not payable'))}>Fail loot simulation</button>
    <output aria-label="Reward read count">{reads}</output>
    <output aria-label="Quest submissions">{submissions}</output>
    <output aria-label="Loot submissions">{openSubmissions}</output>
    {message && <p role="alert">{message}</p>}
  </section>;
}

function previewFor(swordsmen: bigint, phalanx: bigint): BarracksRaidPreviewV2 {
  return {
    statusCode: 0, attackerWon: true, swordsmenRequested: swordsmen, phalanxRequested: phalanx,
    attackerSwordsmenBefore: swordsmen, attackerPhalanxBefore: phalanx, defenderSwordsmenBefore: BigInt(4), defenderPhalanxBefore: BigInt(0),
    attackerSwordsmenLost: BigInt(1), attackerPhalanxLost: BigInt(0), defenderSwordsmenLost: BigInt(4), defenderPhalanxLost: BigInt(0),
    survivingAttackerSwordsmen: swordsmen - BigInt(1), survivingAttackerPhalanx: phalanx, survivingDefenderSwordsmen: BigInt(0), survivingDefenderPhalanx: BigInt(0),
    attackerPower: BigInt(10), defenderPower: BigInt(4), pendingPoints: BigInt(100), pendingLifetime: BigInt(0), carryPointsCap: BigInt(100), carryLifetimeCap: BigInt(0),
    estimatedPointsLoot: BigInt(100), estimatedLifetimeLoot: BigInt(0), attackerCooldownEndsAt: BigInt(0), defenderCooldownEndsAt: BigInt(0),
  };
}

function RaidPreviewFixture() {
  const [owner, setOwner] = useState('wallet-a');
  const [land, setLand] = useState(BigInt(1));
  const [target, setTarget] = useState(BigInt(2));
  const [swordsmen, setSwordsmen] = useState(BigInt(10));
  const [block, setBlock] = useState(BigInt(100));
  const [enabled, setEnabled] = useState(true);
  const [submissions, setSubmissions] = useState(0);
  const requests = useRef<{ target: bigint; resolve: () => void; reject: () => void }[]>([]);
  const read = useCallback((_land: bigint, targetId: bigint, swords: bigint, phalanx: bigint) => new Promise<BarracksRaidPreviewV2>((resolve, reject) => {
    requests.current.push({ target: targetId, resolve: () => resolve(previewFor(swords, phalanx)), reject: () => reject(new Error('Unavailable')) });
  }), []);
  const raid = useBarracksRaidPreview({ enabled, owner, landId: land, targetLandId: target, swordsmen, phalanx: BigInt(0), currentBlock: block, read });
  return <section aria-label="Raid preview identity" className="space-y-2 rounded border p-4">
    <p>Target {target.toString()}, troops {swordsmen.toString()}</p>
    <p role="status" aria-label="Raid preview status">{raid.preview ? `Preview troops ${raid.preview.swordsmenRequested}` : raid.isLoading ? 'Updating preview' : 'Preview unavailable'}</p>
    {raid.error && <p role="alert">{raid.error}</p>}
    <button disabled={!raid.preview || raid.preview.statusCode !== 0} onClick={() => { raid.requireReady(); setSubmissions(count => count + 1); }}>Submit raid</button>
    <button onClick={() => setTarget(BigInt(3))}>Select target 3</button>
    <button onClick={() => setTarget(BigInt(4))}>Select target 4</button>
    <button onClick={() => setSwordsmen(BigInt(20))}>Send 20 troops</button>
    <button onClick={() => setOwner('wallet-b')}>Switch raid wallet</button>
    <button onClick={() => setLand(BigInt(8))}>Switch attacker land</button>
    <button onClick={() => setBlock(value => value + BigInt(1))}>Next preview block</button>
    <button onClick={() => setEnabled(false)}>Disable preview feature</button>
    <button onClick={() => requests.current.at(-1)?.resolve()}>Resolve current preview</button>
    <button onClick={() => requests.current.find(request => request.target === BigInt(3))?.resolve()}>Resolve old target 3</button>
    <button onClick={() => requests.current.at(-1)?.reject()}>Fail current preview</button>
    <button onClick={raid.refresh}>Retry preview</button>
    <output aria-label="Raid submissions">{submissions}</output>
  </section>;
}

export function BuildingGuardFixtures() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  return <QueryClientProvider client={client}><main className="mx-auto max-w-2xl space-y-4 p-4">
    <h1>Building transaction guards</h1>
    <p>Injected read responses only. No wallets, live reads or transactions.</p>
    <QuestRewardFixture /><RaidPreviewFixture />
  </main></QueryClientProvider>;
}
