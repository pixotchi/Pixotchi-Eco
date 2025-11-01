// Centralized sessionStorage manager to prevent race conditions
// Provides thread-safe access to sessionStorage with proper error handling

type AuthSurface = 'privy' | 'coinbase' | null;

class SessionStorageManager {
  private static instance: SessionStorageManager;
  private readonly KEY_AUTH_SURFACE = 'pixotchi:authSurface';
  private readonly KEY_AUTOLOGIN = 'pixotchi:autologin';
  private lock: Promise<void> = Promise.resolve();

  private constructor() {}

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
      if (stored === 'privy' || stored === 'coinbase') {
        return stored as AuthSurface;
      }
      return null;
    } catch (error) {
      console.warn('Failed to read auth surface from sessionStorage:', error);
      return null;
    }
  }

  // Thread-safe setter for auth surface
  async setAuthSurface(surface: 'privy' | 'coinbase'): Promise<void> {
    // Chain operations to prevent race conditions
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;
      
      try {
        sessionStorage.setItem(this.KEY_AUTH_SURFACE, surface);
      } catch (error) {
        console.error('Failed to set auth surface in sessionStorage:', error);
        throw error;
      }
    });
    
    return this.lock;
  }

  // Thread-safe getter for autologin flag
  getAutologin(): 'privy' | 'coinbase' | null {
    if (typeof window === 'undefined') return null;
    
    try {
      const stored = sessionStorage.getItem(this.KEY_AUTOLOGIN);
      if (stored === 'privy' || stored === 'coinbase') {
        return stored;
      }
      return null;
    } catch (error) {
      console.warn('Failed to read autologin from sessionStorage:', error);
      return null;
    }
  }

  // Thread-safe setter for autologin flag
  async setAutologin(surface: 'privy' | 'coinbase'): Promise<void> {
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

  // Batch set both auth surface and autologin atomically
  async setAuthSurfaceAndAutologin(surface: 'privy' | 'coinbase'): Promise<void> {
    this.lock = this.lock.then(async () => {
      if (typeof window === 'undefined') return;
      
      try {
        sessionStorage.setItem(this.KEY_AUTH_SURFACE, surface);
        sessionStorage.setItem(this.KEY_AUTOLOGIN, surface);
      } catch (error) {
        console.error('Failed to set auth surface and autologin:', error);
        throw error;
      }
    });
    
    return this.lock;
  }
}

// Export singleton instance
export const sessionStorageManager = SessionStorageManager.getInstance();

