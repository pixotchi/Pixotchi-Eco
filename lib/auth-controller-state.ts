import type { AuthControllerState, AuthConnectionState, AuthSurface } from "@/lib/auth-surface";

export type AuthControllerAction =
  | { type: "hydrate-surface"; surface: AuthSurface }
  | { type: "set-surface"; surface: AuthSurface | null }
  | { type: "set-expected-privy-address"; address: string | null }
  | { type: "set-base-authenticated-address"; address: string | null }
  | { type: "set-base-auth-status"; status: AuthControllerState["baseAuthStatus"] }
  | { type: "set-mini-connect-retrying"; value: boolean }
  | { type: "set-secure-session-state"; state: AuthControllerState["secureSessionState"] }
  | { type: "set-error"; message: string | null }
  | { type: "set-connection-state"; state: AuthConnectionState };

export const initialAuthState: AuthControllerState = {
  surface: null,
  surfaceInitialized: false,
  expectedPrivyAddress: null,
  baseAuthenticatedAddress: null,
  baseAuthStatus: "idle",
  isMiniConnectRetrying: false,
  secureSessionState: "unneeded",
  errorState: null,
  connectionState: "disconnected",
};

export function authReducer(
  state: AuthControllerState,
  action: AuthControllerAction,
): AuthControllerState {
  switch (action.type) {
    case "hydrate-surface":
      return {
        ...state,
        surface: action.surface,
        surfaceInitialized: true,
      };
    case "set-surface":
      return {
        ...state,
        surface: action.surface,
      };
    case "set-expected-privy-address":
      return {
        ...state,
        expectedPrivyAddress: action.address,
      };
    case "set-base-authenticated-address":
      return {
        ...state,
        baseAuthenticatedAddress: action.address,
      };
    case "set-base-auth-status":
      return {
        ...state,
        baseAuthStatus: action.status,
      };
    case "set-mini-connect-retrying":
      return {
        ...state,
        isMiniConnectRetrying: action.value,
      };
    case "set-secure-session-state":
      return {
        ...state,
        secureSessionState: action.state,
      };
    case "set-error":
      return {
        ...state,
        errorState: action.message,
      };
    case "set-connection-state":
      return {
        ...state,
        connectionState: action.state,
      };
    default:
      return state;
  }
}
