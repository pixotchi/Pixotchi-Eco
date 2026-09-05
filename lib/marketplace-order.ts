import { isAddress, type Address } from 'viem';

export type MarketplaceOrder = {
  id: bigint;
  seller: Address;
  sellToken: 0 | 1;
  amount: bigint;
  amountAsk: bigint;
  isActive: boolean;
};

function unsigned(value: unknown): bigint {
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^\d+$/.test(value))) throw new Error('Invalid marketplace integer');
  const parsed = BigInt(value);
  if (parsed < BigInt(0)) throw new Error('Negative marketplace amount');
  return parsed;
}

/** Reject a malformed response rather than silently turning it into a tradable order. */
export function parseMarketplaceOrder(value: unknown): MarketplaceOrder {
  if (!value || typeof value !== 'object') throw new Error('Invalid marketplace order');
  const order = value as Record<string, unknown>;
  if (typeof order.seller !== 'string' || !isAddress(order.seller) || typeof order.isActive !== 'boolean') throw new Error('Invalid marketplace seller or status');
  if (order.sellToken !== 0 && order.sellToken !== 1 && order.sellToken !== BigInt(0) && order.sellToken !== BigInt(1)) throw new Error('Unsupported marketplace token');
  const amount = unsigned(order.amount);
  const amountAsk = unsigned(order.amountAsk);
  if (order.isActive && (amount === BigInt(0) || amountAsk === BigInt(0))) throw new Error('Active marketplace order has no trade amount');
  return { id: unsigned(order.id), seller: order.seller, isActive: order.isActive, sellToken: Number(order.sellToken) as 0 | 1, amount, amountAsk };
}
