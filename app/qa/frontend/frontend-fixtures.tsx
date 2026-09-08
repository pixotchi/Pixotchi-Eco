"use client";

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { AmountField } from '@/components/ui/amount-field';
import { Card } from '@/components/ui/card';
import { ResourceState } from '@/components/ui/resource-state';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PlantCareCatalog } from '@/components/plant-care-catalog';
import { PlantCareLayout } from '@/components/plant-care-layout';
import QuantitySelector from '@/components/quantity-selector';
import { QuestDifficultySelector } from '@/components/building-details/quest-difficulty-selector';
import { RouletteBettingTable } from '@/components/transactions/roulette-betting-table';
import { MarketplaceOrderSummary } from '@/components/transactions/marketplace-order-summary';
import { ChatComposer } from '@/components/chat/chat-composer';
import { TransactionFeedbackCard } from '@/components/transactions/transaction-feedback-card';
import { getTransactionFeedback } from '@/lib/transaction-feedback';
import type { GardenItem, ShopItem } from '@/lib/types';
import { ActionFixtures } from './action-fixtures';
import { QuestQueryFixtures } from './quest-query-fixtures';
import { DialogLayoutFixtures } from './dialog-layout-fixtures';
import { SeedPurchaseQuoteFixtures } from './seed-purchase-quote-fixtures';

const DenseSurfaceFixtures = dynamic(() => import('./dense-surface-fixtures').then(module => module.DenseSurfaceFixtures));
const RankingQueryFixtures = dynamic(() => import('./ranking-query-fixtures').then(module => module.RankingQueryFixtures));
const ControllerFixtures = dynamic(() => import('./controller-fixtures').then(module => module.ControllerFixtures));
const PlantAttackFixtures = dynamic(() => import('./plant-attack-fixtures').then(module => module.PlantAttackFixtures));

const gardenItems: GardenItem[] = [
  { id: '0', name: 'Sunlight', price: BigInt('17250000000000000000'), points: 48000000000000, timeExtension: 0 },
  { id: '1', name: 'Water', price: BigInt('25875000000000000000'), points: 0, timeExtension: 43200 },
  { id: '2', name: 'Fertilizer', price: BigInt('35937500000000000000'), points: 137500000000000, timeExtension: 0 },
  { id: '3', name: 'Pollinator', price: BigInt('43125000000000000000'), points: 0, timeExtension: 93600 },
  { id: '4', name: 'Magic Soil', price: BigInt('60375000000000000000'), points: 273000000000000, timeExtension: 0 },
  { id: '5', name: 'Dream Dew', price: BigInt('69000000000000000000'), points: 180000000000000, timeExtension: 172800 },
  { id: '6', name: 'Botano', price: BigInt('86250000000000000000'), points: 450000000000000, timeExtension: 0 },
  { id: '7', name: 'Moonlight', price: BigInt('97750000000000000000'), points: 0, timeExtension: 272160 },
  { id: '8', name: 'Nitro', price: BigInt('122187500000000000000'), points: 510000000000000, timeExtension: 259200 },
  // Proposed values are fixtures only; the live catalog always reads the contract.
  { id: '9', name: 'Superbloom', price: BigInt('37500000000000000000000'), points: 250000000000000000, timeExtension: 1209600 },
  { id: '10', name: 'Everdew', price: BigInt('20000000000000000000000'), points: 125000000000000000, timeExtension: 7776000 },
  { id: '11', name: 'Raincloud', price: BigInt('200000000000000000000'), points: 0, timeExtension: 604800 },
];

export function FrontendFixtures({ includeSecondary = true }: { includeSecondary?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [amount, setAmount] = useState('');
  const [questDifficulty, setQuestDifficulty] = useState(0);
  const [selected, setSelected] = useState<GardenItem | ShopItem | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [careReviewRequest, setCareReviewRequest] = useState(0);
  const [lastBet, setLastBet] = useState('');
  const [rouletteLocked, setRouletteLocked] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const [blockEscape, setBlockEscape] = useState(false);
  const [resource, setResource] = useState<'error' | 'empty'>('error');
  const [publicDraft, setPublicDraft] = useState('');
  const [aiDraft, setAiDraft] = useState('');
  const [sendSucceeds, setSendSucceeds] = useState(false);
  const [sent, setSent] = useState(0);
  const [feedbackState, setFeedbackState] = useState('idle');
  const feedback = getTransactionFeedback({ statusName: feedbackState, hasProof: true, syncDelayed: true });

  return <main data-fixtures-ready={ready} className="mx-auto max-w-6xl space-y-6 p-4">
    <h1 className="text-xl font-semibold">Frontend regression fixtures</h1>
    <ActionFixtures />
    <QuestQueryFixtures />
    <DialogLayoutFixtures />
    {includeSecondary && <DenseSurfaceFixtures />}
    {includeSecondary && <RankingQueryFixtures />}
    <section aria-label="Resource amount" className="max-w-md">
      <Card><AmountField label="Points to add" unit="PTS" value={amount} onChange={e => setAmount(e.target.value)} balance="70.5022" onMax={() => setAmount('70.5022')} error={Number(amount) > 70.5022 ? 'Amount exceeds available PTS.' : undefined} />
        <Button className="mt-3" disabled={!amount || Number(amount) > 70.5022}>Apply PTS</Button></Card>
    </section>
    <section aria-label="Asset selector" className="max-w-md">
      <DropdownMenu><DropdownMenuTrigger asChild><Button className="w-full">Select a plant</Button></DropdownMenuTrigger>
        <DropdownMenuContent matchTriggerWidth><DropdownMenuItem>Very long plant name · #22419</DropdownMenuItem><DropdownMenuItem>TYJ · #1</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </section>
    <section aria-label="Care catalog" className="@container max-w-[640px]">
      <PlantCareLayout selectionKey={selected?.id ?? null} reviewRequest={careReviewRequest} catalog={<div aria-label="Care choices"><PlantCareCatalog gardenItems={gardenItems} shopItems={[]} selectedItem={selected} itemType="garden"
        onSelect={option => { setSelected(option.item); setCareReviewRequest(request => request + 1); }} /></div>}
        details={<div className="space-y-3"><p aria-label="Care review">{selected ? `Review ${selected.name}` : 'Choose a care item below.'}</p>
          {selected && <div role="group" aria-label="Purchase quantity"><QuantitySelector quantity={quantities[selected.id] ?? 1} min={1} max={80} onQuantityChange={value => setQuantities(q => ({ ...q, [selected.id]: value }))} /></div>}
        </div>} />
    </section>
    <section aria-label="Quest difficulty fixture" className="max-w-sm">
      <QuestDifficultySelector label="Quest difficulty" value={questDifficulty} onChange={setQuestDifficulty} durationLabels={['~3h', '~6h', '~12h']} />
    </section>
    <section aria-label="Read failure" className="max-w-md">
      <ResourceState status={resource} title={resource === 'error' ? 'Production unavailable' : 'Nothing ready to collect'} description={resource === 'error' ? 'The network read failed.' : 'Your next production is still growing.'} onRetry={resource === 'error' ? () => setResource('empty') : undefined} />
    </section>
    <section aria-label="Exact marketplace amounts" className="max-w-md">
      <Card><MarketplaceOrderSummary order={{ id: BigInt(1), seller: '0x0000000000000000000000000000000000000001', sellToken: 1, amount: BigInt(1), amountAsk: BigInt('1000000000000000000000000000000000000'), isActive: true }} /></Card>
    </section>
    <section aria-label="Roulette fixture" className="min-w-0 rounded-lg bg-slate-950 p-3 text-white">
      <label><input type="checkbox" checked={rouletteLocked} onChange={event => setRouletteLocked(event.target.checked)} /> Lock roulette betting</label>
      <RouletteBettingTable bettingInputDisabled={rouletteLocked} addBet={(type, label, numbers) => setLastBet(`${type}:${label}:${numbers.join(',')}`)} hasBet={(type, numbers) => lastBet.startsWith(`${type}:`) && lastBet.endsWith(`:${numbers.join(',')}`)} />
      <output aria-label="Selected bet" className="block">{lastBet}</output>
    </section>
    <section aria-label="Chat fixtures" className="grid gap-4 tablet:grid-cols-2">
      <ChatComposer activeMode="public" message={publicDraft} onMessageChange={setPublicDraft} activeSending={false} publicChatAuthenticated publicChatLoading={false} cancelActiveSend={() => {}}
        onSend={async () => { setSent(n => n + 1); return sendSucceeds; }} />
      <ChatComposer activeMode="ai" message={aiDraft} onMessageChange={setAiDraft} activeSending={false} publicChatAuthenticated publicChatLoading={false} cancelActiveSend={() => {}}
        onSend={async () => { setSent(n => n + 1); return sendSucceeds; }} />
      <Button onClick={() => setSendSucceeds(true)}>Allow successful send</Button><output aria-label="Send count">{sent}</output>
    </section>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={blockEscape} onChange={event => setBlockEscape(event.target.checked)} />Keep confirmation open on Escape</label>
    <Button onClick={() => setDialogOpen(true)}>Open fixture dialog</Button>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent><DialogHeader><DialogTitle>Resource action</DialogTitle><DialogDescription>A scrollable action with a nested confirmation.</DialogDescription></DialogHeader>
        <DialogBody><AmountField label="Dialog amount" unit="PTS" value={amount} onChange={e => setAmount(e.target.value)} />
          <Button onClick={() => setNestedOpen(true)} className="mt-4">Review action</Button><div className="h-96" aria-hidden="true" /></DialogBody>
        <DialogFooter sticky><Button onClick={() => setDialogOpen(false)}>Done</Button></DialogFooter>
      </DialogContent>
      <Dialog open={nestedOpen} onOpenChange={setNestedOpen}><DialogContent layer="nested" size="sm" onEscapeKeyDown={event => { if (blockEscape) event.preventDefault(); }}><DialogHeader><DialogTitle>Confirm resource action</DialogTitle><DialogDescription>Nothing will be submitted.</DialogDescription></DialogHeader><DialogBody>Review your amount: {amount || '0'} PTS</DialogBody><DialogFooter><Button onClick={() => setNestedOpen(false)}>Back to amount</Button></DialogFooter></DialogContent></Dialog>
    </Dialog>
    <label htmlFor="fixture-feedback-state" className="block space-y-2">Transaction state</label><select id="fixture-feedback-state" className="h-11 rounded border bg-card px-3" value={feedbackState} onChange={e => setFeedbackState(e.target.value)}>
      {['idle', 'buildingTransaction', 'transactionPending', 'submissionAmbiguous', 'transactionStale', 'confirmedSyncing', 'success', 'rejected', 'reverted'].map(state => <option key={state}>{state}</option>)}
    </select>
    {feedback && <TransactionFeedbackCard feedback={feedback} onDismiss={() => setFeedbackState('idle')} />}
    {includeSecondary && <PlantAttackFixtures />}
    <SeedPurchaseQuoteFixtures />
    {includeSecondary && <ControllerFixtures />}
  </main>;
}
