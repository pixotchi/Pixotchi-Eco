"use client";

import React, { useEffect, useId, useState } from 'react';
import { useAccount } from 'wagmi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useChat } from '@/components/chat/chat-context';

interface InviteCodeInputProps {
  onValidated: (code: string) => void;
  initialCode?: string;
  autoSubmit?: boolean;
}

export default function InviteCodeInput({ 
  onValidated, 
  initialCode = '', 
  autoSubmit = false 
}: InviteCodeInputProps) {
  const inputId = useId();
  const helperId = useId();
  const errorId = useId();
  const sessionId = useId();
  const { address } = useAccount();
  const { publicChatState, retryPublicChatSession } = useChat();
  const [code, setCode] = useState(initialCode);
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const requiresSecureSession = Boolean(address);
  const sessionUnavailable = requiresSecureSession && publicChatState !== 'ready';
  const sessionStatusText = !requiresSecureSession
    ? 'Secure session will start after wallet connection.'
    : publicChatState === 'booting'
      ? 'Finishing secure session setup…'
      : publicChatState === 'error'
        ? 'Secure session unavailable. Retry secure session setup or reconnect your wallet.'
        : publicChatState === 'ready'
          ? 'Secure session ready.'
          : 'Secure session is not required yet.';
  const statusText = isValidating
    ? 'Validating invite code…'
    : isValid === true
      ? 'Invite code accepted.'
      : isValid === false
        ? 'Invite code rejected.'
        : 'Invite code input ready.';
  const describedBy = [
    helperId,
    errorMessage ? errorId : null,
    requiresSecureSession ? sessionId : null,
  ].filter(Boolean).join(' ');

  // Auto-submit if initial code is provided and autoSubmit is true
  useEffect(() => {
    if (initialCode && autoSubmit) {
      handleValidate();
    }
  }, [initialCode, autoSubmit]);

  const handleCodeChange = (value: string) => {
    const upperCode = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (upperCode.length <= 8) {
      setCode(upperCode);
      setIsValid(null);
      setErrorMessage('');
    }
  };

  const handleValidate = async () => {
    if (!code || code.length !== 8) {
      setErrorMessage('Please enter a valid 8-character invite code');
      setIsValid(false);
      return;
    }

    if (sessionUnavailable) {
      const message = publicChatState === 'booting'
        ? 'Finishing secure session setup… Please try again in a moment.'
        : publicChatState === 'error'
          ? 'Your secure session is not ready. Retry secure session setup or reconnect and try again.'
          : 'Your secure session is not ready yet.';
      setErrorMessage(message);
      setIsValid(false);
      toast.error(message);
      return;
    }

    setIsValidating(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/invite/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (data.valid) {
        setIsValid(true);
        toast.success('Valid invite code!');
        
        // Mark code as used if wallet is connected
        if (address) {
          const useResult = await markCodeAsUsed(code, address);
          if (!useResult.success) {
            setIsValid(false);
            setErrorMessage(useResult.error || 'Failed to activate invite code. Please try again.');
            toast.error(useResult.error || 'Failed to activate invite code. Please try again.');
            return;
          }
        }
        
        onValidated(code);
      } else {
        setIsValid(false);
        setErrorMessage(data.error || 'Invalid invite code');
        toast.error(data.error || 'Invalid invite code');
      }
    } catch (error) {
      console.error('Error validating invite code:', error);
      setIsValid(false);
      setErrorMessage('Failed to validate code. Please try again.');
      toast.error('Failed to validate code. Please try again.');
    } finally {
      setIsValidating(false);
    }
  };

  const markCodeAsUsed = async (inviteCode: string, userAddress: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch('/api/invite/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: inviteCode, 
          address: userAddress 
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        return {
          success: false,
          error: typeof data?.error === 'string' ? data.error : 'Failed to activate invite code.',
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Error marking code as used:', error);
      return {
        success: false,
        error: 'Failed to activate invite code. Please try again.',
      };
    }
  };

  const getStatusIcon = () => {
    if (isValidating) {
      return <Loader2 className="w-5 h-5 animate-spin text-blue-500" />;
    }
    if (isValid === true) {
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
    if (isValid === false) {
      return <XCircle className="w-5 h-5 text-red-500" />;
    }
    return null;
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-4">
          <div className="relative">
            <label htmlFor={inputId} className="sr-only">
              Invite code
            </label>
            <Input
              id={inputId}
              name="inviteCode"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              placeholder="Enter code"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
              className="text-center text-lg font-pixel tracking-wider pr-12 placeholder:text-center"
              style={{ fontFamily: "var(--font-pixel, sans-serif)" }}
              maxLength={8}
              disabled={isValidating}
              aria-describedby={describedBy}
              aria-invalid={Boolean(errorMessage)}
              aria-busy={isValidating}
            />
            <div
              className="absolute right-3 top-1/2 transform -translate-y-1/2"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {getStatusIcon()}
              <span className="sr-only">{statusText}</span>
            </div>
          </div>

          {errorMessage && (
            <p id={errorId} className="text-sm text-red-600 text-center" role="alert">
              {errorMessage}
            </p>
          )}

          {requiresSecureSession && (
            <p id={sessionId} className="text-xs text-muted-foreground text-center" aria-live="polite">
              {sessionStatusText}
            </p>
          )}

          {requiresSecureSession && publicChatState === 'error' && (
            <Button type="button" variant="outline" onClick={retryPublicChatSession} className="w-full">
              Retry Secure Session
            </Button>
          )}

          <p id={helperId} className="text-xs text-muted-foreground text-center">
            You can get code by asking our current farmers!
          </p>

          <Button 
            onClick={handleValidate}
            disabled={!code || code.length !== 8 || isValidating || sessionUnavailable}
            className="w-full"
          >
            {isValidating ? 'Validating…' : 'Validate Code'}
          </Button>

          {!address && (
            <p className="text-xs text-orange-600 text-center">
              Connect your wallet to automatically mark the code as used
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
} 
