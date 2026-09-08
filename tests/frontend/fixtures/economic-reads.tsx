import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import StakingDialog from '@/components/staking/staking-dialog';
import MarketplaceDialog from '@/components/transactions/marketplace-dialog';
import { getStakeComposite } from '@/lib/contracts';
import { economyFixture } from './economic-read-io';

Object.assign(window, { economyFixture });

function Fixture() {
  const [stakingOpen, setStakingOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [compositeResult, setCompositeResult] = useState('');
  return <main>
    <button onClick={() => setStakingOpen(true)}>Open staking</button>
    <StakingDialog open={stakingOpen} onOpenChange={setStakingOpen} />
    <button onClick={() => setMarketOpen(true)}>Open marketplace</button>
    <MarketplaceDialog open={marketOpen} onOpenChange={setMarketOpen} landId={BigInt(1112)} />
    {['stake', 'allowance', 'optional'].map(failure => <button key={failure} onClick={async () => {
      const values = [[BigInt(0), BigInt(0)], BigInt(0), null, null, null];
      const responses = values.map((result, index) => (index === (failure === 'stake' ? 0 : failure === 'allowance' ? 1 : 2)
        ? { status: 'failure', error: new Error('RPC unavailable') }
        : { status: 'success', result }));
      try {
        const client = { multicall: async () => responses } as unknown as Parameters<typeof getStakeComposite>[1];
        const result = await getStakeComposite(economyFixture.address, client);
        setCompositeResult(`ready:${String(result.stake?.staked)}:${String(result.approved)}`);
      } catch { setCompositeResult('unavailable'); }
    }}>Read {failure} failure</button>)}
    <output aria-label="Composite result">{compositeResult}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
