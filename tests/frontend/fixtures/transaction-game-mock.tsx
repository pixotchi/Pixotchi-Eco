import type { GameTransactionProps } from '@/components/transactions/game-transaction';
import { Button } from '@/components/ui/button';

/** Staking's real render/builders run; this boundary prevents wallet execution. */
export default function GameTransaction({ calls, buttonText, buttonClassName, disabled }: GameTransactionProps) {
  const amount = calls[0]?.args?.[0];
  return <div>
    <Button className={buttonClassName} disabled={disabled}>{buttonText}</Button>
    <output hidden aria-label={`${buttonText} call amount`}>{typeof amount === 'bigint' ? amount.toString() : calls.length ? 'non-amount' : 'none'}</output>
  </div>;
}
