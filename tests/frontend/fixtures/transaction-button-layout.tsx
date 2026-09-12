import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseAbi } from 'viem';
import StakingDialog from '@/components/staking/staking-dialog';
import GameTransaction from '@/components/transactions/game-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import { PaymasterProvider } from '@/lib/paymaster-context';
import { fixtureWallet } from './transaction-core-wallet';
import TransferAssetsDialog from '@/components/transactions/transfer-assets-dialog';
import { AppToaster } from '@/components/ui/app-toaster';
import { BATCH_ROUTER_ADDRESS, PIXOTCHI_NFT_ADDRESS, createNftOperatorApprovalCall } from '@/lib/contracts';
import { createPendingEvmCallsDigest, createPendingEvmRecord, getBrowserPendingEvmStorage, PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS, writePendingEvmRecord } from '@/lib/pending-evm-transaction';

Object.assign(window, { fixtureWallet, seedStaleApproval() {
  const call = createNftOperatorApprovalCall(PIXOTCHI_NFT_ADDRESS, BATCH_ROUTER_ADDRESS);
  writePendingEvmRecord(getBrowserPendingEvmStorage(), createPendingEvmRecord({
    identity: { accountAddress: fixtureWallet.accountAddress, chainId: 8453, intentKey: `transfer-assets:v1:approval:${PIXOTCHI_NFT_ADDRESS.toLowerCase()}:${BATCH_ROUTER_ADDRESS.toLowerCase()}` },
    callsDigest: createPendingEvmCallsDigest([call]),
    connectorId: 'transaction-core-fixture', method: 'batch', proof: { kind: 'reservation' },
    submittedAt: Date.now() - PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS - 1_000,
  }));
} });

function Fixture() {
  const [open, setOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferMounted, setTransferMounted] = useState(false);
  return <PaymasterProvider>
    <AppToaster />
    <button onClick={() => setOpen(true)}>Open staking</button>
    <StakingDialog open={open} onOpenChange={setOpen} />
    <button onClick={() => { setTransferMounted(true); setTransferOpen(true); }}>Open transfer</button>
    {transferMounted && <TransferAssetsDialog open={transferOpen} onOpenChange={setTransferOpen} />}
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
