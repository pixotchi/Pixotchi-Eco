import type { BridgeActionType } from './solana-bridge-service';

function normalizeIdentityValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return '';
  return String(value);
}

export function nextSolanaQuoteGeneration(current: number): number {
  return current + 1;
}

export function isCurrentSolanaQuoteGeneration(
  responseGeneration: number,
  currentGeneration: number,
): boolean {
  return responseGeneration === currentGeneration;
}

/** Exact identity of the price inputs consumed by each paid bridge action. */
export function getSolanaQuoteKey(
  actionType: BridgeActionType,
  params: Record<string, unknown> = {},
): string | null {
  switch (actionType) {
    case 'mint':
      return `mint:strain=${normalizeIdentityValue(params.strain)}`;
    case 'shopItem':
      return `shopItem:item=${normalizeIdentityValue(params.itemId)}`;
    case 'gardenItem':
      return `gardenItem:item=${normalizeIdentityValue(params.itemId)}`;
    case 'setName':
      return 'setName';
    default:
      return null;
  }
}

/** Stable identity used for pending-action persistence and duplicate guards. */
export function getSolanaActionKey(
  actionType: BridgeActionType,
  params: Record<string, unknown> = {},
): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(normalizeIdentityValue(value))}`);

  return entries.length > 0 ? `${actionType}:${entries.join('&')}` : actionType;
}

export function getEffectiveSolanaAction(
  requestedAction: BridgeActionType,
  needsImplicitSetup: boolean,
): { effectiveAction: BridgeActionType; implicitSetup: boolean } {
  const implicitSetup = needsImplicitSetup && requestedAction !== 'setup';
  return {
    effectiveAction: implicitSetup ? 'setup' : requestedAction,
    implicitSetup,
  };
}

export function getSolanaActionButtonLabel({
  connected,
  needsImplicitSetup,
  pending,
  quoteLoading,
  quoteReady,
  requestedLabel,
  defaultLabel,
}: {
  connected: boolean;
  needsImplicitSetup: boolean;
  pending: boolean;
  quoteLoading: boolean;
  quoteReady: boolean;
  requestedLabel?: string;
  defaultLabel: string;
}): string {
  if (!connected) return 'Connect Solana Wallet';
  if (pending) return 'Check Base status';
  if (needsImplicitSetup) return 'Setup Bridge Access';
  if (quoteLoading) return 'Loading price...';
  if (!quoteReady) return 'Price unavailable';
  return requestedLabel || defaultLabel;
}
