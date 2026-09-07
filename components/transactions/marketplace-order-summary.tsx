import { formatUnits } from 'viem';
import { ResourceValue } from '@/components/ui/resource-value';
import { formatMarketplacePriceRatio, getMarketplacePriceRatio } from '@/lib/marketplace-price';
import type { MarketplaceOrder } from '@/lib/marketplace-order';

/** Exact give/receive amounts accompany every Take action, including tiny orders. */
export function MarketplaceOrderSummary({ order }: { order: MarketplaceOrder }) {
  const receiveToken = order.sellToken === 1 ? 'LEAF' : 'SEED';
  const giveToken = order.sellToken === 1 ? 'SEED' : 'LEAF';
  const ratio = getMarketplacePriceRatio(order);
  const rate = ratio ? formatMarketplacePriceRatio(ratio) : null;
  return <div className="min-w-0 space-y-1 break-all text-xs leading-relaxed">
    <p className="font-medium">Buy {receiveToken} · #{order.id.toString()}</p>
    <p>You give <ResourceValue unit={giveToken} className="font-bold tabular-nums">{formatUnits(order.amountAsk, 18)} {giveToken}</ResourceValue></p>
    <p>You receive <ResourceValue unit={receiveToken} className="font-bold tabular-nums">{formatUnits(order.amount, 18)} {receiveToken}</ResourceValue></p>
    <p className="text-muted-foreground">Rate: {rate === '0' ? '<0.000000000000000001' : rate ?? 'Unavailable'} LEAF per SEED</p>
    {!order.isActive && <p className="text-muted-foreground">Inactive</p>}
  </div>;
}
