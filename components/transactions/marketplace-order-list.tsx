"use client";

import { Fragment, useState, type ReactNode } from 'react';
import type { MarketplaceOrder } from '@/lib/marketplace-order';
import { Button } from '@/components/ui/button';

/** A bounded first render without making older orders unreachable. */
export function MarketplaceOrderList({ orders, pageSize, children }: {
  orders: readonly MarketplaceOrder[];
  pageSize: number;
  children: (order: MarketplaceOrder) => ReactNode;
}) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const visibleOrders = orders.slice(0, visibleCount);
  return (
    <>
      {visibleOrders.map((order) => <Fragment key={String(order.id)}>{children(order)}</Fragment>)}
      {visibleOrders.length < orders.length && (
        <div className="space-y-2 px-3 py-2 text-center text-xs text-muted-foreground">
          <p>Showing {visibleOrders.length} of {orders.length} orders.</p>
          <Button type="button" variant="outline" size="touchCompact" onClick={() => setVisibleCount((count) => count + pageSize)}>
            Load more orders
          </Button>
        </div>
      )}
    </>
  );
}
