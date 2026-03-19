export interface MiniAppRequestContextInput {
  miniAppCookie?: string | null;
  miniAppHeader?: string | null;
  sessionMethod?: string | null;
}

export function isMiniAppRequestContext(input?: MiniAppRequestContextInput): boolean {
  return (
    input?.sessionMethod === "farcaster-miniapp" ||
    input?.miniAppCookie === "1" ||
    input?.miniAppHeader === "1"
  );
}
