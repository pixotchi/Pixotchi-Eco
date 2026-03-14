// Centralized sessionStorage manager to prevent race conditions
// Provides thread-safe access to sessionStorage with proper error handling

type AuthSurface = 'privy' | 'base' | 'coinbase' | 'privysolana' | null;
type PendingBaseChatAuth = {
  address: string;
  message: string;
  signature: `0x${string}`;
};

export const AUTH_SURFACE_CHANGE_EVENT = 'pixotchi:auth-surface-change';

class SessionStorageManager {
  private static instance: SessionStorageManager;
  private readonly KEY_AUTH_SURFACE = 'pixotchi:authSurface';
  private readonly KEY_AUTOLOGIN = 'pixotchi:autologin';
  private readonly KEY_PRIVY_AUTH_ADDRESS = 'pixotchi:privyAuthAddress';
  private readonly KEY_PRIVY_LOGOUT_INTENT_AT = 'pixotchi:privyLogoutIntentAt';
  private readonly KEY_BASE_CHAT_AUTH = 'pixotchi:baseChatAuth';
  private lock: Promise<void> = Promise.resolve();

  private constructor() {}

  private emitAuthSurfaceChange(surface: AuthSurface): void {
    if (typeof window === 'undefined') return;

    try {
      window.dispatchEvent(new CustomEvent(AUTH_SURFACE_CHANGE_EVENT, {
        detail: {
          surface: surface === 'coinbase' ? 'base' : surface,
        },
      }));
    } catch (error) {
      console.warn('Failed to emit auth surface change event:', error);
    }
  }

  static getInstance(): SessionStorageManager {
    if (!SessionStorageManager.instance) {
      SessionStorageManager.instance = new SessionStorageManager();
    }
    return SessionStorageManager.instance;
  }

  // Thread-safe getter for auth surface
  getAuthSurface(): AuthSurface {
    if (typeof window === 'undefined') return null;
    
    try {
      const stored = sessionStorage.getItem(this.KEY_AUTH_SURFACE);
      if (stored === 'privy' || stored === 'base' || stored === 'coinbase' || stored === 'privysolana') {
        return stored as AuthSurface;
      }
      return null;
    } catch (error) {
      console.warn('Failed to read auth surface from sessionStorage:', error);
      return null;
    }
  }

  getEffectiveAuthSurface(): 'privy' | 'base' | 'privysolana' | null {
    const stored = this.getAuthSurface();
    return stored === 'coinbase' ? 'base' : stored;
  }

  // Thread-safe setter for auth surface
  async setAuthSurface(surface: 'privy' | 'base' | 'coinbase' | 'privysolana'): Promise<void> {
    // Chain operations to prevent race conditions
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;
      
      try {
        sessionStorage.setItem(this.KEY_AUTH_SURFACE, surface);
        this.emitAuthSurfaceChange(surface);
      } catch (error) {
        console.error('Failed to set auth surface in sessionStorage:', error);
        throw error;
      }
    });
    
    return this.lock;
  }

  // Thread-safe getter for autologin flag
  getAutologin(): 'privy' | 'base' | 'coinbase' | 'privysolana' | null {
    if (typeof window === 'undefined') return null;
    
    try {
      const stored = sessionStorage.getItem(this.KEY_AUTOLOGIN);
      if (stored === 'privy' || stored === 'base' || stored === 'coinbase' || stored === 'privysolana') {
        return stored as 'privy' | 'base' | 'coinbase' | 'privysolana';
      }
      return null;
    } catch (error) {
      console.warn('Failed to read autologin from sessionStorage:', error);
      return null;
    }
  }

  // Thread-safe setter for autologin flag
  async setAutologin(surface: 'privy' | 'base' | 'coinbase' | 'privysolana'): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;
      
      try {
        sessionStorage.setItem(this.KEY_AUTOLOGIN, surface);
      } catch (error) {
        console.error('Failed to set autologin in sessionStorage:', error);
        throw error;
      }
    });
    
    return this.lock;
  }

  // Thread-safe remover for autologin flag
  async removeAutologin(): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;
      
      try {
        sessionStorage.removeItem(this.KEY_AUTOLOGIN);
      } catch (error) {
        console.warn('Failed to remove autologin from sessionStorage:', error);
      }
    });
    
    return this.lock;
  }

  getPrivyAuthenticatedAddress(): string | null {
    if (typeof window === 'undefined') return null;

    try {
      const stored = sessionStorage.getItem(this.KEY_PRIVY_AUTH_ADDRESS);
      return stored ? stored.toLowerCase() : null;
    } catch (error) {
      console.warn('Failed to read Privy authenticated address from sessionStorage:', error);
      return null;
    }
  }

  async setPrivyAuthenticatedAddress(address: string): Promise<void> {
    const normalized = address.toLowerCase();

    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;

      try {
        sessionStorage.setItem(this.KEY_PRIVY_AUTH_ADDRESS, normalized);
      } catch (error) {
        console.error('Failed to set Privy authenticated address in sessionStorage:', error);
        throw error;
      }
    });

    return this.lock;
  }

  async removePrivyAuthenticatedAddress(): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;

      try {
        sessionStorage.removeItem(this.KEY_PRIVY_AUTH_ADDRESS);
      } catch (error) {
        console.warn('Failed to remove Privy authenticated address from sessionStorage:', error);
      }
    });

    return this.lock;
  }

  hasRecentPrivyLogoutIntent(maxAgeMs: number = 10_000): boolean {
    if (typeof window === 'undefined') return false;

    try {
      const stored = sessionStorage.getItem(this.KEY_PRIVY_LOGOUT_INTENT_AT);
      if (!stored) return false;

      const timestamp = Number(stored);
      if (!Number.isFinite(timestamp)) {
        sessionStorage.removeItem(this.KEY_PRIVY_LOGOUT_INTENT_AT);
        return false;
      }

      const isRecent = Date.now() - timestamp <= maxAgeMs;
      if (!isRecent) {
        sessionStorage.removeItem(this.KEY_PRIVY_LOGOUT_INTENT_AT);
      }

      return isRecent;
    } catch (error) {
      console.warn('Failed to read Privy logout intent from sessionStorage:', error);
      return false;
    }
  }

  async markPrivyLogoutIntent(): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;

      try {
        sessionStorage.setItem(this.KEY_PRIVY_LOGOUT_INTENT_AT, String(Date.now()));
      } catch (error) {
        console.warn('Failed to mark Privy logout intent in sessionStorage:', error);
      }
    });

    return this.lock;
  }

  async clearPrivyLogoutIntent(): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;

      try {
        sessionStorage.removeItem(this.KEY_PRIVY_LOGOUT_INTENT_AT);
      } catch (error) {
        console.warn('Failed to clear Privy logout intent from sessionStorage:', error);
      }
    });

    return this.lock;
  }

  getPendingBaseChatAuth(): PendingBaseChatAuth | null {
    if (typeof window === 'undefined') return null;

    try {
      const stored = sessionStorage.getItem(this.KEY_BASE_CHAT_AUTH);
      if (!stored) return null;

      const parsed = JSON.parse(stored) as Partial<PendingBaseChatAuth>;
      if (
        typeof parsed?.address !== 'string' ||
        typeof parsed?.message !== 'string' ||
        typeof parsed?.signature !== 'string'
      ) {
        return null;
      }

      return {
        address: parsed.address.toLowerCase(),
        message: parsed.message,
        signature: parsed.signature as `0x${string}`,
      };
    } catch (error) {
      console.warn('Failed to read pending Base chat auth from sessionStorage:', error);
      return null;
    }
  }

  async setPendingBaseChatAuth(payload: PendingBaseChatAuth): Promise<void> {
    const normalized: PendingBaseChatAuth = {
      ...payload,
      address: payload.address.toLowerCase(),
    };

    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;

      try {
        sessionStorage.setItem(this.KEY_BASE_CHAT_AUTH, JSON.stringify(normalized));
      } catch (error) {
        console.error('Failed to set pending Base chat auth in sessionStorage:', error);
        throw error;
      }
    });

    return this.lock;
  }

  async clearPendingBaseChatAuth(): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;

      try {
        sessionStorage.removeItem(this.KEY_BASE_CHAT_AUTH);
      } catch (error) {
        console.warn('Failed to clear pending Base chat auth from sessionStorage:', error);
      }
    });

    return this.lock;
  }

  // Batch set both auth surface and autologin atomically
  async setAuthSurfaceAndAutologin(surface: 'privy' | 'base' | 'coinbase' | 'privysolana'): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;
      
      try {
        sessionStorage.setItem(this.KEY_AUTH_SURFACE, surface);
        sessionStorage.setItem(this.KEY_AUTOLOGIN, surface);
        this.emitAuthSurfaceChange(surface);
      } catch (error) {
        console.error('Failed to set auth surface and autologin:', error);
        throw error;
      }
    });

    return this.lock;
  }

  async clearAuthState(): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;

      try {
        sessionStorage.removeItem(this.KEY_AUTH_SURFACE);
        sessionStorage.removeItem(this.KEY_AUTOLOGIN);
        sessionStorage.removeItem(this.KEY_PRIVY_AUTH_ADDRESS);
        sessionStorage.removeItem(this.KEY_BASE_CHAT_AUTH);
        this.emitAuthSurfaceChange(null);
      } catch (error) {
        console.warn('Failed to clear auth state from sessionStorage:', error);
      }
    });

    return this.lock;
  }
}

// Export singleton instance
export const sessionStorageManager = SessionStorageManager.getInstance();
