import type { LastSwapTransaction } from '@/lib/swap/review';

export function SwapExecutionNotice({ message, currentHash, lastTransaction, id }: {
  message: string | null;
  currentHash?: string;
  lastTransaction: LastSwapTransaction | null;
  id?: string;
}) {
  const hash = currentHash && /^0x[0-9a-fA-F]{64}$/.test(currentHash) ? currentHash : lastTransaction?.hash;
  const meaningfulMessage = message?.trim();
  const visibleMessage = meaningfulMessage && !/^0x[0-9a-fA-F]{64}$/.test(meaningfulMessage) ? meaningfulMessage : null;
  if (!visibleMessage && !hash) return <div id={id} />;
  return <div id={id} className="mt-3 space-y-1 text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="ockSwapMessage_Message" role="status" aria-live="polite">
    {visibleMessage && <p>{visibleMessage}</p>}
    {hash && <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 text-xs font-medium text-foreground underline underline-offset-4">
      {currentHash ? 'View transaction' : `Last ${lastTransaction?.action === 'approval' ? 'approval' : 'swap'} confirmed — view transaction`}
    </a>}
  </div>;
}
