"use client";

import { usePrivy, useLogin } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

interface PrivyLoginButtonProps {
  className?: string;
  disabled?: boolean;
}

export default function PrivyLoginButton({ 
  className = "w-full rounded-md text-base font-medium",
  disabled = false 
}: PrivyLoginButtonProps) {
  const { ready: isPrivyReady } = usePrivy();
  const { login } = useLogin();
  const [forceEnabled, setForceEnabled] = useState(false);
  
  // If Privy isn't ready after a timeout, force the button to be enabled
  // This handles cases where the provider state gets stuck
  useEffect(() => {
    if (!isPrivyReady) {
      const timer = setTimeout(() => {
        setForceEnabled(true);
      }, 2000);
      
      return () => clearTimeout(timer);
    } else {
      setForceEnabled(false);
    }
  }, [isPrivyReady]);
  
  // Safely handle login attempt even if Privy reports not ready
  const handleLogin = () => {
    try {
      login();
    } catch (error) {
      console.warn("Privy login attempt failed, trying again after delay");
      // Try again after a small delay if the first attempt failed
      setTimeout(() => {
        try {
          login();
        } catch (e) {
          console.error("Repeated Privy login attempt failed", e);
        }
      }, 500);
    }
  };

  return (
    <Button
      className={className}
      variant="default"
      disabled={disabled && !forceEnabled && !isPrivyReady}
      onClick={handleLogin}
    >
      Continue with Privy
    </Button>
  );
}
