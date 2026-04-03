export type AuthSurface = "privy" | "base" | "privysolana";
export type LegacyAuthSurface = AuthSurface | "coinbase" | null;

export type SecureSessionState = "unneeded" | "booting" | "ready" | "error";
export type AuthConnectionState = "disconnected" | "connecting" | "connected";

export type AuthControllerState = {
  surface: AuthSurface | null;
  surfaceInitialized: boolean;
  expectedPrivyAddress: string | null;
  baseAuthenticatedAddress: string | null;
  baseAuthStatus: "idle" | "checking" | "authenticating";
  isMiniConnectRetrying: boolean;
  secureSessionState: SecureSessionState;
  errorState: string | null;
  connectionState: AuthConnectionState;
};

export const DEFAULT_AUTH_SURFACE: AuthSurface = "privy";

export function normalizeAuthSurface(value: string | null | undefined): AuthSurface | null {
  if (value === "privy" || value === "base" || value === "privysolana") {
    return value;
  }

  return null;
}

export function resolveStoredAuthSurface(surface: LegacyAuthSurface): AuthSurface | null {
  if (surface === "coinbase") {
    return "base";
  }

  return normalizeAuthSurface(surface);
}

export function resolvePreferredAuthSurface(input: {
  search?: string | URLSearchParams;
  storedSurface?: LegacyAuthSurface;
  fallback?: AuthSurface;
}): AuthSurface {
  const fallback = input.fallback ?? DEFAULT_AUTH_SURFACE;
  const params =
    typeof input.search === "string"
      ? new URLSearchParams(input.search)
      : input.search ?? new URLSearchParams();

  const fromUrl = normalizeAuthSurface(params.get("surface"));
  if (fromUrl) {
    return fromUrl;
  }

  return resolveStoredAuthSurface(input.storedSurface ?? null) ?? fallback;
}

