'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';

interface VerifyClaimProps {
  onClaimSuccess: () => void;
  strainId?: number; // Optional: Force specific strain or default to Zest(4)
}

export function VerifyClaim({ onClaimSuccess, strainId = 4 }: VerifyClaimProps) {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'verifying' | 'claiming' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  
  // Verification state
  const [verificationToken, setVerificationToken] = useState<string | null>(null);

  const handleVerify = async () => {
    if (!address || !chainId) {
      toast.error('Please connect your wallet');
      return;
    }

    setLoading(true);
    setError(null);
    setStep('verifying');

    try {
      // 1. Create SIWE message with required traits
      // We check for X verification as primary example
      const domain = window.location.host;
      const origin = window.location.origin;
      const statement = 'Verify ownership of your X account to claim a free plant.';
      
      const message = new SiweMessage({
        domain,
        address,
        statement,
        uri: origin,
        version: '1',
        chainId,
        nonce: Math.random().toString(36).substring(2, 15), // Simple nonce
        // MUST match Base Verify expected format exactly
        resources: [
          'urn:verify:provider:x',
          'urn:verify:provider:x:verified:eq:true',
          // 'urn:verify:provider:x:followers:gte:100' // Optional
        ]
      });

      const messageText = message.prepareMessage();
      const signature = await signMessageAsync({ message: messageText });

      // 2. Check Verification via Backend
      const response = await fetch('/api/verify/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          message: messageText,
          address,
          provider: 'x'
        })
      });

      const data = await response.json();

      if (response.ok && data.verified) {
        if (data.alreadyClaimed) {
          setError('This account has already claimed a free plant.');
          setStep('idle');
        } else {
          setVerificationToken(data.token);
          setStep('claiming'); // Auto-proceed to claim? Or let user click?
          // Let's auto-proceed for smoother UX
          await handleClaim(data.token);
        }
      } else if (response.status === 404) {
        // Not verified -> Redirect to Base Verify
        const verifyUrl = `https://verify.base.dev?redirect_uri=${encodeURIComponent(window.location.href)}&providers=x`;
        // We use window.open or link
        setError(null); // Not an error, just need action
        toast((t) => (
          <div className="flex flex-col gap-2">
            <span>You need to verify your X account first.</span>
            <Button size="sm" onClick={() => window.open(verifyUrl, '_blank')}>
              Verify on Base
            </Button>
          </div>
        ), { duration: 5000 });
        setStep('idle');
      } else {
        throw new Error(data.error || 'Verification failed');
      }

    } catch (err: any) {
      console.error('Verify error:', err);
      setError(err.message || 'Failed to verify');
      setStep('idle');
    } finally {
      if (step !== 'claiming') setLoading(false);
    }
  };

  const handleClaim = async (token: string) => {
    setLoading(true);
    setStep('claiming');
    
    try {
      const response = await fetch('/api/verify/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: address,
          verificationToken: token,
          provider: 'x',
          strainId: strainId
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStep('success');
        toast.success('Free plant claimed successfully!');
        onClaimSuccess();
      } else {
        throw new Error(data.error || 'Claim failed');
      }
    } catch (err: any) {
      console.error('Claim error:', err);
      setError(err.message || 'Failed to claim');
      setStep('verifying'); // Go back to verified state so they can retry claim
    } finally {
      setLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <Card className="bg-green-500/10 border-green-500/50">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mb-2" />
          <h3 className="text-lg font-bold text-green-700 dark:text-green-400">Claimed!</h3>
          <p className="text-sm text-muted-foreground">Your free plant is on its way.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🎁 Free Plant for Verified Users
        </CardTitle>
        <CardDescription>
          Verify your X (Twitter) account to mint a free Zest plant!
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded p-3 text-sm text-red-600 dark:text-red-400 flex gap-2 items-start">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button 
          className="w-full bg-blue-500 hover:bg-blue-600 text-white" 
          onClick={handleVerify}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {step === 'verifying' ? 'Verifying...' : 'Claiming...'}
            </>
          ) : (
            'Verify & Claim Free Plant'
          )}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Powered by Base Verify. No gas required.
        </p>
      </CardContent>
    </Card>
  );
}

