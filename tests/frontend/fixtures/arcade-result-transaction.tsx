import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { GameTransactionProps } from '@/components/transactions/game-transaction';
import type { LifecycleStatus } from '@/components/transactions/transaction-kit';

export const useAccount = () => ({ address: `0x${'1'.repeat(40)}` });

/** Exercise the real Box adapter and receipt decoder without wallet execution. */
export default function Transaction({ buttonText, buttonClassName, disabled, onStatusUpdate }: GameTransactionProps) {
  useEffect(() => {
    const complete = (event: Event) => onStatusUpdate?.((event as CustomEvent<LifecycleStatus>).detail);
    window.addEventListener('fixture:box-status', complete);
    return () => window.removeEventListener('fixture:box-status', complete);
  }, [onStatusUpdate]);
  return <Button className={buttonClassName} disabled={disabled} onClick={() => onStatusUpdate?.({ statusName: 'buildingTransaction', statusData: { transactionReceipts: [] } })}>{buttonText}</Button>;
}
