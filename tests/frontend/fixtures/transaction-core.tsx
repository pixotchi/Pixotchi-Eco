import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Transaction, TransactionButton, TransactionToastAction } from '@/components/transactions/transaction-kit';
import { TransferPlanReview } from '@/components/transactions/transfer-plan-review';
import { fixtureWallet } from './transaction-core-wallet';
import StakingDialog from '@/components/staking/staking-dialog';
import TransferAssetsDialog from '@/components/transactions/transfer-assets-dialog';
import { createPendingEvmCallsDigest, createPendingEvmRecord, getBrowserPendingEvmStorage, writePendingEvmRecord } from '@/lib/pending-evm-transaction';

function Fixture() {
  const [ready, setReady] = useState(true);
  const [draft, setDraft] = useState('0x01');
  const [mounted, setMounted] = useState(true);
  const [preflight, setPreflight] = useState('allow');
  const [preflightCalls, setPreflightCalls] = useState(0);
  const [reconciliation, setReconciliation] = useState('immediate');
  const [pendingConfirmation, setPendingConfirmation] = useState<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const [error, setError] = useState('');
  const [, render] = useState(0);
  useEffect(() => {
    fixtureWallet.notify = () => render(n => n + 1);
    return () => { fixtureWallet.notify = () => {}; };
  }, []);
  const [pendingPreflight, setPendingPreflight] = useState<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [stakingOpen, setStakingOpen] = useState(false);
  const [transferMounted, setTransferMounted] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const calls = [{ to: `0x${'2'.repeat(40)}` as const, data: draft as `0x${string}` }, { to: `0x${'3'.repeat(40)}` as const, data: '0x02' as const }];
  return <main>
    <button onClick={() => setStakingOpen(true)}>Open staking</button>
    <StakingDialog open={stakingOpen} onOpenChange={setStakingOpen} />
    <button onClick={() => { setTransferMounted(true); setTransferOpen(true); }}>Open transfer</button>
    {transferMounted && <TransferAssetsDialog open={transferOpen} onOpenChange={setTransferOpen} />}
    <label><input type="checkbox" checked={ready} onChange={event => setReady(event.target.checked)} />Ready</label>
    <label>Draft<input value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <label>Capabilities<select value={fixtureWallet.capability} onChange={event => { fixtureWallet.capability = event.target.value as typeof fixtureWallet.capability; render(n => n + 1); }}>
      {['supported', 'unsupported', 'missing', 'failure', 'deferred'].map(mode => <option key={mode}>{mode}</option>)}
    </select></label>
    <label>Preflight<select value={preflight} onChange={event => setPreflight(event.target.value)}>
      {['allow', 'false', 'throw', 'async', 'pending'].map(mode => <option key={mode}>{mode}</option>)}
    </select></label>
    <label>Reconciliation<select value={reconciliation} onChange={event => setReconciliation(event.target.value)}>
      {['immediate', 'failed', 'deferred'].map(mode => <option key={mode}>{mode}</option>)}
    </select></label>
    <button onClick={() => { fixtureWallet.accountAddress = `0x${'5'.repeat(40)}`; render(n => n + 1); }}>Switch wallet</button>
    <button onClick={() => pendingConfirmation?.resolve()}>Resolve reconciliation</button>
    <button onClick={() => pendingConfirmation?.reject(new Error('Refresh delayed'))}>Reject reconciliation</button>
    <label><input type="checkbox" checked={fixtureWallet.rejectWallet} onChange={event => { fixtureWallet.rejectWallet = event.target.checked; render(n => n + 1); }} />Reject wallet</label>
    <label><input type="checkbox" checked={fixtureWallet.ambiguousWallet} onChange={event => { fixtureWallet.ambiguousWallet = event.target.checked; render(n => n + 1); }} />Ambiguous wallet result</label>
    <label><input type="checkbox" checked={fixtureWallet.deferWallet} onChange={event => { fixtureWallet.deferWallet = event.target.checked; render(n => n + 1); }} />Delay next wallet request</label>
    <button onClick={() => fixtureWallet.resolveWallet?.()}>Resolve wallet request</button>
    <button onClick={() => { fixtureWallet.resolveCapabilities?.(); }}>Resolve capabilities</button>
    <button onClick={() => pendingPreflight?.resolve()}>Resolve preflight</button>
    <button onClick={() => pendingPreflight?.reject(new Error('Fresh validation failed'))}>Reject preflight</button>
    <button onClick={() => {
      writePendingEvmRecord(getBrowserPendingEvmStorage(), createPendingEvmRecord({
        identity: { accountAddress: `0x${'1'.repeat(40)}`, chainId: 8453, intentKey: 'qa:another-operation' },
        callsDigest: createPendingEvmCallsDigest(calls), connectorId: 'transaction-core-fixture', method: 'batch', proof: { kind: 'reservation' },
      }));
    }}>Reserve wallet elsewhere</button>
    <button onClick={() => setMounted(value => !value)}>Toggle controller</button>
    <output aria-label="Wallet calls">{fixtureWallet.walletCalls}</output>
    <output aria-label="Preflight calls">{preflightCalls}</output>
    <output aria-label="Error">{error}</output>
    {mounted && <Transaction calls={calls} effects="none" intentKey="qa:transaction-core" canSubmit={ready}
      onConfirmed={() => {
        if (reconciliation === 'failed') throw new Error('Refresh delayed');
        if (reconciliation === 'deferred') return new Promise<void>((resolve, reject) => setPendingConfirmation({ resolve, reject }));
      }}
      onBeforeSubmit={() => {
        setPreflightCalls(n => n + 1);
        if (preflight === 'false') return false;
        if (preflight === 'throw') throw new Error('Fresh validation failed');
        if (preflight === 'pending') setReady(false);
        if (preflight === 'async') return new Promise<void>((resolve, reject) => setPendingPreflight({ resolve, reject }));
      }}
      onError={failure => { setError(failure instanceof Error ? failure.message : String(failure)); render(n => n + 1); }}
      onStatus={() => render(n => n + 1)} resetAfter={0}>
      <TransactionButton text="Submit" render={({ context, isDisabled, onSubmit }) => <>
        <button onClick={onSubmit} disabled={isDisabled}>Submit</button>
        <button onClick={() => context.submit('retry')}>Direct retry entry</button>
        <button onClick={() => context.submit('button')}>Direct submit entry</button>
        <output aria-label="Executing">{String(context.isExecuting)}</output>
        <output aria-label="Status">{context.status.statusName}</output>
      </>} />
      <TransactionToastAction />
    </Transaction>}
    <button onClick={() => setReviewOpen(value => !value)}>Toggle review</button>
    <button onClick={() => setStep(1)}>Complete first transfer</button>
    {reviewOpen && <TransferPlanReview plan={{ targetAddress: `0x${'4'.repeat(40)}`, chainId: 8453,
      steps: [{ kind: 'plant', plantId: 17 }, { kind: 'land', landId: '1112' }], nextStepIndex: step,
      successfulPlantIds: step ? [17] : [], successfulLandIds: [], failedPlantIds: [], failedLandIds: [] }} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
