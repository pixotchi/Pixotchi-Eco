"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AmountField } from '@/components/ui/amount-field';
import { TokenAmount } from '@/components/ui/token-amount';
import { RouletteBetList } from '@/components/transactions/roulette-bet-list';
import { GameDialogHeading } from '@/components/transactions/game-dialog-heading';
import { AssetMultiSelect } from '@/components/ui/asset-multi-select';
import { ApprovalState, type ApprovalReadState } from '@/components/ui/approval-state';
import { ProductionSummary } from '@/components/building-details/production-summary';

export function DialogLayoutFixtures() {
  const [layout, setLayout] = useState<'form' | 'detail' | 'game'>('form');
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [bets, setBets] = useState([{ id: 'one', label: 'Corner 1,2,4,5', amount: '0.000000000000000001' }, { id: 'two', label: '6-Line 25-30', amount: '999999999999999999.99' }]);
  const [plants, setPlants] = useState<number[]>([]);
  const [lands, setLands] = useState<string[]>([]);
  const [refreshed, setRefreshed] = useState(false);
  const [approval, setApproval] = useState<ApprovalReadState>('loading');
  const content = <><AmountField label="Layout amount" unit="SEED" value={amount} onChange={event => setAmount(event.target.value)} />
    {Array.from({ length: 12 }, (_, index) => <p key={index} className="my-3 text-sm">Long content row {index + 1}. Details remain readable when the viewport or text size changes.</p>)}
    <Button variant="outline">Last content action</Button></>;
  return <>
    <section aria-label="Named dialog layouts" className="space-y-3">
      <label htmlFor="fixture-layout">Dialog layout</label><select id="fixture-layout" value={layout} onChange={event => setLayout(event.target.value as typeof layout)} className="ml-3 min-h-11 rounded border bg-card px-3"><option>form</option><option>detail</option><option>game</option></select>
      <Button onClick={() => setOpen(true)}>Open layout dialog</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent layout={layout} padding="compact" hideCloseButton={layout === 'game'}>
          {layout === 'game' ? <><GameDialogHeading title="game layout" onClose={() => setOpen(false)} /><DialogDescription className="sr-only">A named scroll contract.</DialogDescription></>
            : <DialogHeader><DialogTitle>{layout} layout</DialogTitle><DialogDescription>A named scroll contract.</DialogDescription></DialogHeader>}
          {layout === 'game' ? <div data-testid="layout-content" className="py-3">{content}</div> : <DialogBody data-testid="layout-content">{content}</DialogBody>}
          <DialogFooter sticky={layout === 'game' ? true : undefined}><Button onClick={() => setOpen(false)}>Finish layout check</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
    <section aria-label="Bet removal fixture" className="max-w-md rounded-lg bg-slate-950 p-3"><RouletteBetList bets={bets} limit={15} locked={false} tokenLogo="/icons/ethlogo.svg" tokenSymbol="ETH" onClear={() => setBets([])} onRemove={id => setBets(previous => previous.filter(bet => bet.id !== id))} /></section>
    <section aria-label="Token precision fixture" className="max-w-xs space-y-2">
      <TokenAmount amount={BigInt(1)} unit="SEED" />
      <TokenAmount amount={BigInt('9007199254740993123456789123456789')} unit="SEED" mode="exact" />
      <TokenAmount amount={BigInt(1)} unit="ETH" mode="estimate" precision={6} />
    </section>
    <section aria-label="Transfer selection fixture" className="max-w-sm space-y-4">
      <AssetMultiSelect label="Plants selected" assetLabel="Plant" items={[{id: refreshed ? 3 : 1, name: 'A very long plant name with several words'}, {id: 2}]} selectedIds={plants} onChange={setPlants} />
      <AssetMultiSelect label="Lands selected" assetLabel="Land" items={[{id: '712'}, {id: '760', name: 'Home'}]} selectedIds={lands} onChange={setLands} />
      <Button onClick={() => setRefreshed(true)}>Refresh fixture assets</Button>
      <label htmlFor="fixture-approval">Approval read state</label><select id="fixture-approval" value={approval} onChange={event => setApproval(event.target.value as ApprovalReadState)} className="min-h-11 rounded border bg-card px-3"><option>loading</option><option>error</option><option>approved</option><option>required</option></select>
      <ApprovalState label="Plants" state={approval}><Button>Approve fixture plants</Button></ApprovalState>
    </section>
    <section aria-label="Production readouts fixture" className="max-w-sm rounded border p-4">
      <ProductionSummary building={{level: 1, isUpgrading: false, productionRatePlantPointsPerDay: BigInt(1), productionRatePlantLifetimePerDay: BigInt(0), accumulatedPoints: BigInt('9007199254740993123456789'), accumulatedLifetime: BigInt(400 * 86400 + 3661)}} />
    </section>
  </>;
}
