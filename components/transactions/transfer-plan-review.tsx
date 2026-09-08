import { getTransferReview, type TransferReviewPlan } from '@/lib/transfer-assets-review';

function AssetIds({ plantIds, landIds }: { plantIds: number[]; landIds: string[] }) {
  return <div className="space-y-1 text-sm break-words">
    {plantIds.length > 0 && <p>Plants ({plantIds.length}): {plantIds.map(id => `#${id}`).join(', ')}</p>}
    {landIds.length > 0 && <p>Lands ({landIds.length}): {landIds.map(id => `#${id}`).join(', ')}</p>}
  </div>;
}

export function TransferPlanReview({ plan }: { plan: TransferReviewPlan }) {
  const review = getTransferReview(plan);
  return <section aria-label="Transfer review" className="space-y-3">
    <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
      <p className="text-xs text-muted-foreground">Recipient</p>
      <p className="break-all font-mono">{plan.targetAddress}</p>
      <p className="text-xs text-muted-foreground">Network: {plan.chainId === 8453 ? 'Base' : `Chain ${plan.chainId}`}</p>
    </div>
    <div className="space-y-1">
      <p className="text-sm font-semibold">This transaction</p>
      <AssetIds {...review.current} />
    </div>
    {plan.steps.length > 1 && <details className="text-sm">
      <summary className="cursor-pointer py-2">Remaining assets: {review.remaining.plantIds.length + review.remaining.landIds.length}</summary>
      <AssetIds {...review.remaining} />
    </details>}
    {review.completed.plantIds.length + review.completed.landIds.length > 0 && <div className="space-y-1">
      <p className="text-sm font-semibold">Already transferred</p>
      <AssetIds {...review.completed} />
    </div>}
    {review.failed.plantIds.length + review.failed.landIds.length > 0 && <div className="space-y-1">
      <p className="text-sm font-semibold">Failed transfers</p>
      <AssetIds {...review.failed} />
    </div>}
  </section>;
}
