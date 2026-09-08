'use client';

import { useState } from 'react';
import { MintLandSummary, MintReview, MintStrainPicker } from '@/components/mint/mint-presentation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TokenAmount } from '@/components/ui/token-amount';
import type { Strain } from '@/lib/types';

const strains: Strain[] = [
  { id: 1, name: 'OG' }, { id: 2, name: 'FLORA' }, { id: 3, name: 'TYJ' },
  { id: 4, name: 'Temporarily unavailable' }, { id: 5, name: 'Sold out' },
].map(({ id, name }) => ({ id, name, mintPrice: 100, mintPriceRaw: BigInt(100), totalSupply: 100,
  totalMinted: id === 5 ? 100 : 10, maxSupply: 100, isActive: id !== 4,
  getStrainTotalLeft: id === 5 ? 0 : 90, strainInitialTOD: 86400 }));

function WalletMintExample({ isSolana = false }: { isSolana?: boolean }) {
  const [selected, setSelected] = useState(1);
  const [pending, setPending] = useState(false);
  const wallet = isSolana ? 'Solana' : 'Base';
  return <Card aria-label={`${wallet} mint example`}>
    <CardHeader><CardTitle>{wallet} plant mint</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <MintStrainPicker strains={strains} selectedId={selected} onSelect={setSelected}
        imageForStrain={() => '/icons/plant1.svg'} pending={pending} isSolana={isSolana} />
      <MintReview label={`${wallet} mint review`} description={isSolana ? 'Mint via Solana Bridge. Success is reported after the action executes on Base.' : undefined}>
        <p className="text-sm">Selected: {strains.find(strain => strain.id === selected)?.name}</p>
        <Button className="h-auto min-h-11 w-full whitespace-normal [overflow-wrap:anywhere]" onClick={() => setPending(true)} disabled={pending}>
          {pending ? 'Confirming your mint transaction' : 'Mint selected plant'}
        </Button>
      </MintReview>
    </CardContent>
  </Card>;
}

export function MintLayoutFixture() {
  return <main aria-label="Mint layout examples" className="mx-auto w-full max-w-6xl space-y-4 p-6">
    <div className="grid min-w-0 gap-4 tablet:grid-cols-2">
      <WalletMintExample />
      <WalletMintExample isSolana />
    </div>
    <Card aria-label="Land mint example" className="max-w-lg">
      <CardHeader><CardTitle>Mint a Land</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <MintLandSummary price={<TokenAmount amount={BigInt('1234567890123456789000000000000000000')} unit="SEED" mode="exact" />}
          availability="123,456,789 / 123,456,790" />
        <MintReview label="Land mint review">
          <p className="text-sm">Land prices and availability are checked again before signing.</p>
          <Button className="h-auto min-h-11 w-full whitespace-normal [overflow-wrap:anywhere]">Mint land for 1,234,567,890 SEED</Button>
        </MintReview>
      </CardContent>
    </Card>
  </main>;
}
