import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { INVITE_CONFIG, getLocalStorageKeys } from '@/lib/invite-utils';

export function useInviteValidation() {
  const { address, isConnected } = useAccount();
  const [userValidated, setUserValidated] = useState(false);
  const [checkingValidation, setCheckingValidation] = useState(false);

  useEffect(() => {
    const checkInviteValidation = async () => {
      if (!INVITE_CONFIG.SYSTEM_ENABLED || !address) {
        setUserValidated(true);
        setCheckingValidation(false);
        return;
      }

      setCheckingValidation(true);
      
      const keys = getLocalStorageKeys();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch('/api/invite/check-validation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();
        
        setUserValidated(data.validated);
        
        if (data.validated) {
          localStorage.setItem(keys.INVITE_VALIDATED, 'true');
          localStorage.setItem(keys.USER_ADDRESS, address.toLowerCase());
        } else {
          localStorage.removeItem(keys.INVITE_VALIDATED);
          localStorage.removeItem(keys.USER_ADDRESS);
          localStorage.removeItem(keys.VALIDATED_CODE);
        }
        
      } catch (error) {
        console.error('Invite validation check failed, failing open:', error);
        
        // FAIL OPEN: Allow access if validation server is down or times out
        // We still check local storage first to respect previous valid state if any,
        // but if this is a new user and server is down, we let them in.
        
        // Strategy:
        // 1. If previously validated in local storage, trust it.
        // 2. If NOT previously validated, STILL allow entry (fail open) to prevent blocking legitimate users during outages.
        // This essentially disables the gate during network errors.
        
        setUserValidated(true);
        
      } finally {
        setCheckingValidation(false);
      }
    };

    const timeoutId = setTimeout(() => {
      if (isConnected && address && INVITE_CONFIG.SYSTEM_ENABLED) {
        checkInviteValidation();
      } else if (!INVITE_CONFIG.SYSTEM_ENABLED) {
        setUserValidated(true);
        setCheckingValidation(false);
      } else if (!isConnected) {
        const keys = getLocalStorageKeys();
        localStorage.removeItem(keys.INVITE_VALIDATED);
        localStorage.removeItem(keys.USER_ADDRESS);
        localStorage.removeItem(keys.VALIDATED_CODE);
        setUserValidated(false);
        setCheckingValidation(false);
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [isConnected, address]);

  const handleInviteValidated = (code: string) => {
    setUserValidated(true);
    const keys = getLocalStorageKeys();
    localStorage.setItem(keys.INVITE_VALIDATED, 'true');
    localStorage.setItem(keys.VALIDATED_CODE, code);
    if (address) {
      localStorage.setItem(keys.USER_ADDRESS, address.toLowerCase());
    }
  };

  return { userValidated, checkingValidation, handleInviteValidated, setUserValidated };
}
