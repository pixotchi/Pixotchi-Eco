'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TokenAmount } from '@/components/ui/token-amount';
import QuantitySelector from '@/components/quantity-selector';
import { MintShareModal } from '@/components/mint-share-modal';
import { AssetMultiSelect } from '@/components/ui/asset-multi-select';
import { LowFoundationFixtures } from './low-foundation-fixtures';

export function FoundationFixtures() {
  const [ready, setReady] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [quantityValid, setQuantityValid] = useState(true);
  const [purchased, setPurchased] = useState(0);
  const [open, setOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [long, setLong] = useState(false);
  const [selected, setSelected] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<number[]>([1]);
  useEffect(() => setReady(true), []);
  return <main data-fixtures-ready={ready} className="space-y-6 p-4">
    <h1>Foundation behavior checks</h1>
    <div className="app-shell-inner mx-auto w-full bg-card" data-connected="true" data-testid="tablet-shell">Player content</div>
    <section aria-label="Theme contrast" className="space-y-3">
      {['bg-card', 'surface-lifted', 'surface-subpanel'].map(surface => <div key={surface} data-surface={surface} className={`${surface} flex flex-wrap items-start gap-3 rounded-xl p-4`}>
        <Badge variant="info" data-contrast="info">Route information</Badge>
        <Badge variant="chain" data-contrast="chain">Base network</Badge>
        <Button variant="link" data-contrast="link">Inspect details</Button>
        <button type="button" data-contrast="success" className="rounded-lg bg-[hsl(var(--success))] bg-[image:var(--gradient-success)] px-4 py-3 text-sm text-[hsl(var(--success-foreground))]">Approved</button>
        <button type="button" data-contrast="following" className="profile-follow-button follow-button follow-button-following rounded-lg px-4 py-3 text-sm">Following</button>
      </div>)}
    </section>
    <section aria-label="Direct quantity purchase" className="flex flex-wrap items-start gap-4">
      <QuantitySelector quantity={quantity} onQuantityChange={setQuantity} onValidityChange={setQuantityValid} min={1} max={80} />
      <Button disabled={!quantityValid} onClick={() => setPurchased(quantity)}>Buy selected quantity</Button>
      <output aria-label="Purchased quantity">{purchased}</output>
    </section>
    <section aria-label="Exact token amount"><TokenAmount amount={BigInt('9007199254740993123456789123456789')} unit="SEED" mode="compact" /></section>
    <DropdownMenu><DropdownMenuTrigger asChild><Button>Open long menu</Button></DropdownMenuTrigger>
      <DropdownMenuContent aria-label="Available choices" className="w-96">
        {Array.from({ length: 50 }, (_, i) => <DropdownMenuItem key={i} onSelect={() => setSelected(String(i + 1))}>Choice {i + 1}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    <output aria-label="Chosen menu item">{selected}</output>
    <section aria-label="Large asset collection" className="max-w-sm">
      <AssetMultiSelect label="Lands to transfer" assetLabel="Land" items={Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Garden ${i + 1}` }))} selectedIds={selectedAssets} onChange={setSelectedAssets} />
      <output aria-label="Selected land IDs">{selectedAssets.join(',')}</output>
    </section>
    <Button onClick={() => { setLong(false); setOpen(true); }}>Open late dialog</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent layout="form">
      <DialogHeader><DialogTitle>Dynamic content</DialogTitle><DialogDescription>Content can expand after this dialog opens.</DialogDescription></DialogHeader>
      <DialogBody data-testid="dynamic-scroll" style={{ height: 160, flex: 'none' }}>
        <div>{long ? Array.from({ length: 30 }, (_, i) => `Expanded content line ${i + 1}. `).join('') : 'Short content.'}</div>
      </DialogBody>
      <DialogFooter><Button onClick={() => setLong(value => !value)}>Toggle content length</Button><Button onClick={() => setOpen(false)}>Finish reading</Button></DialogFooter>
    </DialogContent></Dialog>
    <Button onClick={() => setShareOpen(true)}>Open mint share</Button>
    <MintShareModal open={shareOpen} onOpenChange={setShareOpen} data={{ address: '0x1111111111111111111111111111111111111111', strainId: 1, strainName: 'Flora', mintedAt: '2025-06-15T15:06:40Z' }} />
    <LowFoundationFixtures />
  </main>;
}
