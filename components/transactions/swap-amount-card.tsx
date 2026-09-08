import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const SWAP_EDITABLE_AMOUNT_CLASS = 'ock-compat-font w-full min-w-0 border-none rounded-sm bg-transparent leading-none text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4';
export const SWAP_OUTPUT_AMOUNT_CLASS = 'ock-compat-font w-full min-w-0 break-all bg-transparent leading-none text-foreground/85';

export function SwapAmountCard({ label, selector, amount, balance, max, status, output = false }: {
  label: ReactNode; selector: ReactNode; amount: ReactNode; balance: ReactNode; max?: ReactNode; status?: ReactNode; output?: boolean;
}) {
  return <div className={cn('my-0.5 box-border w-full rounded-[var(--radius-panel)] p-3 [--swap-amount-max:2rem] tablet:p-4 tablet:[--swap-amount-max:2.5rem]',
    output ? 'surface-inset' : 'surface-panel border focus-within:border-primary')} data-testid="ockSwapAmountInput_Container">
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 tablet:gap-x-3 tablet:gap-y-2">
      <div className="col-start-1 row-start-1 self-end text-sm text-muted-foreground tablet:self-center">{label}</div>
      <div className="col-start-2 row-span-2 row-start-1 justify-self-end self-center tablet:row-span-1">{selector}</div>
      <div className="col-start-1 row-start-2 min-w-0 tablet:[grid-column:1_/_-1]" style={{ containerType: 'inline-size' }}>{amount}</div>
      <div className="col-start-1 row-start-3 min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere] tablet:[grid-column:1_/_-1] tablet:pr-16">{balance}</div>
      {max && <div className="col-start-2 row-start-3 -my-2 justify-self-end tablet:-my-3">{max}</div>}
    </div>
    {status && <div className="mt-2 text-xs text-muted-foreground">{status}</div>}
  </div>;
}
