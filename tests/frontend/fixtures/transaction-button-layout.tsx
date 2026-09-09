import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseAbi } from 'viem';
import StakingDialog from '@/components/staking/staking-dialog';
import GameTransaction from '@/components/transactions/game-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import { PaymasterProvider } from '@/lib/paymaster-context';
import { fixtureWallet } from './transaction-core-wallet';

Object.assign(window, { fixtureWallet });

function Fixture() {
  const [open, setOpen] = useState(false);
  return <PaymasterProvider>
    <button onClick={() => setOpen(true)}>Open staking</button>
    <StakingDialog open={open} onOpenChange={setOpen} />
    <section aria-label="Compact transaction actions" style={{ width: 120 }}>
      <GameTransaction calls={[{ address: `0x${'2'.repeat(40)}`, abi: parseAbi(['function claim()']), functionName: 'claim', args: [] }]}
        effects="none" intentKey="qa:compact-action" trackStreak={false}
        buttonText="Claim" buttonClassName="h-11 min-h-11 px-2.5 py-0 text-xs"
        showToast={false} />
      <DisabledTransaction buttonText="Insufficient SEED balance" buttonClassName="w-full" />
    </section>
  </PaymasterProvider>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
