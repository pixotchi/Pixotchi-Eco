export const LOCAL_TEST_AUTH_SURFACE = "test" as const;

export function isLocalTestAuthAllowed(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

