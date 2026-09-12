import { InlineBalanceNotice } from '@/components/ui/premium';
import { Button } from '@/components/ui/button';

/** Payment checks and shortfalls share one compact notice above the action. */
export function MintPaymentNotice({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return <InlineBalanceNotice tone="neutral" className="mt-0 text-sm" data-mint-payment-notice>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 basis-48">{message}</span>
        {onRetry && <Button type="button" variant="link" size="sm" className="px-0"
          onClick={onRetry}>Retry balance check</Button>}
      </div>
    </InlineBalanceNotice>;
}
