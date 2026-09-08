function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function getAuthErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  const error = record(value);
  const candidate = error?.message ?? record(error?.error)?.message;
  return typeof candidate === 'string' && candidate.trim() ? candidate : fallback;
}

export function getAuthErrorCode(value: unknown): number | null {
  const error = record(value);
  const direct = error?.code;
  const nested = record(error?.error)?.code;
  return typeof direct === 'number' && Number.isFinite(direct) ? direct
    : typeof nested === 'number' && Number.isFinite(nested) ? nested : null;
}

/** Only display checked host fields; browser hosts may provide partial or older SDK context. */
export function readMiniAppPresentation(value: unknown) {
  const context = record(value);
  if (!context) return null;
  const location = record(context.location);
  const client = record(context.client);
  const user = record(context.user);
  const text = (input: unknown) => typeof input === 'string' ? input : undefined;
  const fid = user?.fid;
  return {
    location: { type: text(location?.type), referrer: text(location?.referrerDomain) ?? text(location?.referrer) },
    client: { name: text(client?.name), version: text(client?.version), added: typeof client?.added === 'boolean' ? client.added : undefined },
    user: { fid: typeof fid === 'number' && Number.isSafeInteger(fid) && fid > 0 ? fid : undefined },
  };
}

export function readWalletName(value: unknown): string | undefined {
  const wallet = record(value);
  for (const name of [wallet?.name, record(wallet?.standardWallet)?.name, wallet?.walletClientType]) {
    if (typeof name === 'string' && name.trim()) return name;
  }
  return undefined;
}
