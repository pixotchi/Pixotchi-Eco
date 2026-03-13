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
        console.error('Invite validation check failed, failing closed:', error);

        const cachedValidated = localStorage.getItem(keys.INVITE_VALIDATED) === 'true';
        const cachedAddress = localStorage.getItem(keys.USER_ADDRESS);
        const matchesCurrentAddress = Boolean(address) && cachedAddress === address.toLowerCase();

        if (cachedValidated && matchesCurrentAddress) {
          setUserValidated(true);
        } else {
          localStorage.removeItem(keys.INVITE_VALIDATED);
          localStorage.removeItem(keys.USER_ADDRESS);
          localStorage.removeItem(keys.VALIDATED_CODE);
          setUserValidated(false);
        }
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
