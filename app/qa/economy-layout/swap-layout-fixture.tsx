'use client';

import { useState } from 'react';
import { SwapAmountCard, SWAP_EDITABLE_AMOUNT_CLASS, SWAP_OUTPUT_AMOUNT_CLASS } from '@/components/transactions/swap-amount-card';
import { SwapExecutionNotice } from '@/components/transactions/swap-execution-notice';
import { swapAmountFontSize } from '@/components/swap-amount-layout';
import { Button } from '@/components/ui/button';
import { useLastSwapTransaction } from '@/hooks/useLastSwapTransaction';

const firstOwner = `0x${'1'.repeat(40)}`;
export function SwapLayoutFixture() {
  const [amount, setAmount] = useState('1');
  const [owner, setOwner] = useState(firstOwner);
  const [message, setMessage] = useState<string | null>(null);
  const { lastTransaction, remember } = useLastSwapTransaction(owner);
  return <main className="mx-auto w-full max-w-lg p-6">
    <section aria-label="Swap layout fixture">
      <SwapAmountCard label={<label htmlFor="layout-amount">Sell</label>}
        selector={<Button variant="outline">ETH</Button>}
        amount={<input id="layout-amount" className={SWAP_EDITABLE_AMOUNT_CLASS} value={amount} onChange={event => setAmount(event.target.value)} style={{ fontSize: `min(${swapAmountFontSize(amount)}, var(--swap-amount-max))` }} />}
        max={<Button variant="ghost">Max</Button>} balance="Balance: 0.000023" />
      <SwapAmountCard output label="Buy · estimated" selector={<Button variant="outline">SEED</Button>}
        amount={<div className={SWAP_OUTPUT_AMOUNT_CLASS} style={{ fontSize: `min(${swapAmountFontSize(amount)}, var(--swap-amount-max))` }}>{amount}</div>}
        balance="Balance: 6.18" />
      <Button className="mt-4 w-full">Swap</Button>
      <SwapExecutionNotice message={message} lastTransaction={lastTransaction} />
    </section>
    <div className="mt-8 flex flex-col gap-2">
      <Button onClick={() => remember(`0x${'a'.repeat(64)}`, 'swap')}>Record fixture receipt</Button>
      <Button onClick={() => setOwner(`0x${'2'.repeat(40)}`)}>Change fixture wallet</Button>
      <Button onClick={() => setMessage('Your transaction is still awaiting confirmation. You can safely return to this screen and follow its status using the transaction link below. No additional payment is needed.')}>Show recovery guidance</Button>
    </div>
  </main>;
}
