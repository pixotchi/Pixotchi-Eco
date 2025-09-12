"use client";

import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

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
  const { address } = useAccount();
  const [code, setCode] = useState(initialCode);
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

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
          await markCodeAsUsed(code, address);
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

  const markCodeAsUsed = async (inviteCode: string, userAddress: string) => {
    try {
      await fetch('/api/invite/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: inviteCode, 
          address: userAddress 
        }),
      });
    } catch (error) {
      console.error('Error marking code as used:', error);
      // Don't show error to user as validation already succeeded
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
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="relative">
            <Input
              placeholder="Enter code"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
              className="text-center text-lg font-pixel tracking-wider pr-12 placeholder:text-center"
              maxLength={8}
              disabled={isValidating}
            />
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              {getStatusIcon()}
            </div>
          </div>

          {errorMessage && (
            <p className="text-sm text-red-600 text-center">{errorMessage}</p>
          )}

          <p className="text-xs text-muted-foreground text-center">
            You can get code by asking our current farmers!
          </p>

          <Button 
            onClick={handleValidate}
            disabled={!code || code.length !== 8 || isValidating}
            className="w-full"
          >
            {isValidating ? 'Validating...' : 'Validate Code'}
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