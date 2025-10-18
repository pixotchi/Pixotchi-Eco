import { useState, useEffect, useCallback, useEffectEvent } from 'react';
import { useAccount } from 'wagmi';
import { INVITE_CONFIG, getLocalStorageKeys } from '@/lib/invite-utils';

export function useInviteValidation() {
  const { address, isConnected } = useAccount();
  const [userValidated, setUserValidated] = useState(false);
  const [checkingValidation, setCheckingValidation] = useState(false);

  useEffect(() => {
    const keys = getLocalStorageKeys();

    const checkInviteValidation = async () => {
      if (!INVITE_CONFIG.SYSTEM_ENABLED || !address) {
        setUserValidated(true);
        setCheckingValidation(false);
        return;
      }

      setCheckingValidation(true);
      
      try {
        const response = await fetch('/api/invite/check-validation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });

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
        const localValidation = localStorage.getItem(keys.INVITE_VALIDATED);
        const storedAddress = localStorage.getItem(keys.USER_ADDRESS);
        
        const hasValidLocalCache = localValidation === 'true' && 
                                  storedAddress?.toLowerCase() === address.toLowerCase();
        
        setUserValidated(hasValidLocalCache);
        
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
        localStorage.removeItem(keys.INVITE_VALIDATED);
        localStorage.removeItem(keys.USER_ADDRESS);
        localStorage.removeItem(keys.VALIDATED_CODE);
        setUserValidated(false);
        setCheckingValidation(false);
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [isConnected, address]);

  const handleInviteValidated = useEffectEvent((code: string) => {
    setUserValidated(true);
    const keys = getLocalStorageKeys();
    localStorage.setItem(keys.INVITE_VALIDATED, 'true');
    localStorage.setItem(keys.VALIDATED_CODE, code);
  });

  return { userValidated, checkingValidation, handleInviteValidated, setUserValidated };
}
