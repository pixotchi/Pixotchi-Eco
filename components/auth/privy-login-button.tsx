"use client";

import { usePrivy, useLogin } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useRef, useCallback } from "react";

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
  const [isLoading, setIsLoading] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  // Clear any existing timeouts when Privy becomes ready
  useEffect(() => {
    if (isPrivyReady && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [isPrivyReady]);
  
  // Handle login with proper error handling and cleanup
  const handleLogin = useCallback(async () => {
    if (!mountedRef.current) return;
    
    // Don't allow multiple simultaneous login attempts
    if (isLoading) return;
    
    setIsLoading(true);
    
    try {
      await login();
    } catch (error) {
      console.warn("Privy login attempt failed:", error);
      
      if (!mountedRef.current) return;
      
      // Only retry if we're still mounted and it's a recoverable error
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      
      retryTimeoutRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        
        try {
          await login();
        } catch (retryError) {
          console.error("Privy login retry failed:", retryError);
        } finally {
          if (mountedRef.current) {
            setIsLoading(false);
          }
        }
      }, 1000); // Increased retry delay for better UX
      
      return; // Don't set loading to false immediately on first failure
    }
    
    if (mountedRef.current) {
      setIsLoading(false);
    }
  }, [login, isLoading]);

  // Determine if button should be disabled
  const isButtonDisabled = disabled || (!isPrivyReady && !isLoading) || isLoading;

  return (
    <Button
      className={className}
      variant="default"
      disabled={isButtonDisabled}
      onClick={handleLogin}
      aria-busy={isLoading}
      aria-live="polite"
    >
      {isLoading ? "Connecting..." : isPrivyReady ? "Continue with Privy" : "Loading Privy..."}
    </Button>
  );
}
