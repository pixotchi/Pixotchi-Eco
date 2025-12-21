'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertCircle, BadgeCheck } from 'lucide-react';
import { useSignMessage } from 'wagmi';
import { SiweMessage, generateNonce } from 'siwe';
import { useFrameContext } from '@/lib/frame-context';
import { openExternalUrl } from '@/lib/open-external';

// Base Verify requires specific configuration
const BASE_VERIFY_CONFIG = {
  // Feature toggle - set NEXT_PUBLIC_VERIFY_CLAIM_ENABLED=true to enable
  enabled: process.env.NEXT_PUBLIC_VERIFY_CLAIM_ENABLED === 'true',
  // Must match the domain registered with Base Verify
  appUrl: process.env.NEXT_PUBLIC_URL || 'https://mini.pixotchi.tech',
  // Base Verify Mini App URL for redirects
  miniAppUrl: 'https://verify.base.dev',
  // Base mainnet chain ID - required by Base Verify
  chainId: 8453,
};

interface VerifyClaimProps {
  onClaimSuccess: () => void;
  strainId?: number; // Optional: Force specific strain or default to Zest(4)
}

export function VerifyClaim({ onClaimSuccess, strainId = 4 }: VerifyClaimProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const frameContext = useFrameContext();
  
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'verifying' | 'claiming' | 'success' | 'unverified'>('idle');
  const [error, setError] = useState<string | null>(null);
  
  // Claim status from Redis (source of truth)
  const [alreadyClaimed, setAlreadyClaimed] = useState<boolean | null>(null); // null = loading
  const [statusLoading, setStatusLoading] = useState(true);
  
  // Verification state
  const [verificationToken, setVerificationToken] = useState<string | null>(null);

  // Check claim status from Redis on mount and when address changes
  useEffect(() => {
    async function checkClaimStatus() {
      if (!address) {
        setStatusLoading(false);
        setAlreadyClaimed(null);
        return;
      }

      try {
        setStatusLoading(true);
        const response = await fetch(`/api/verify/status?address=${address}`);
        const data = await response.json();
        
        if (!data.enabled) {
          // Feature disabled server-side
          setAlreadyClaimed(true); // Treat as claimed to hide the card
        } else {
          setAlreadyClaimed(data.claimed);
        }
      } catch (err) {
        console.error('[VERIFY] Failed to check claim status:', err);
        setAlreadyClaimed(false); // Default to showing card on error
      } finally {
        setStatusLoading(false);
      }
    }

    checkClaimStatus();
  }, [address]);

  const handleVerify = async () => {
    if (!address) {
      toast.error('Please connect your wallet');
      return;
    }

    setLoading(true);
    setError(null);
    setStep('verifying');

    try {
      // 1. Create SIWE message with required traits
      // Following Base Verify documentation exactly
      const appUrl = BASE_VERIFY_CONFIG.appUrl;
      const domain = new URL(appUrl).hostname;
      const statement = 'Verify ownership of your X account to claim a free plant.';
      
      // Build resources array per Base Verify spec
      const resources = [
        'urn:verify:provider:x',
        // 'urn:verify:provider:x:verified:eq:true', // Disabled to allow any linked X account
        'urn:verify:action:claim_free_plant' // Important for unique token generation
      ];
      
      const message = new SiweMessage({
        domain,
        address,
        statement,
        uri: appUrl,
        version: '1',
        chainId: BASE_VERIFY_CONFIG.chainId, // Must be Base mainnet (8453)
        nonce: generateNonce(),
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // 6 hours
        resources,
      });

      const messageText = message.prepareMessage();
      console.log('[VERIFY] SIWE message:', { domain, uri: appUrl, chainId: BASE_VERIFY_CONFIG.chainId });
      
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
        // Not verified -> Redirect to Base Verify Mini App
        setStep('unverified');
        setError(null);
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
        
        // Handle different success statuses
        if (data.status === 'complete') {
          toast.success('Free plant claimed and transferred successfully!');
        } else if (data.status === 'partial') {
          // Partial success - mint worked but transfer may have failed
          toast.success(data.message || 'Plant minted! Check your wallet shortly.');
        }
        
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

  // Check if we're in Mini App mode
  const isInMiniApp = frameContext?.isInMiniApp ?? false;

  // Don't render if:
  // 1. Feature is disabled via env
  // 2. Not in Mini App mode (only show in Mini App)
  // 3. Still loading claim status
  // 4. User has already claimed (Redis is source of truth)
  if (!BASE_VERIFY_CONFIG.enabled) {
    return null;
  }

  if (!isInMiniApp) {
    return null;
  }

  if (statusLoading) {
    // Optionally show a loading skeleton, or just return null
    return null;
  }

  if (alreadyClaimed) {
    return null;
  }

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


  if (step === 'unverified') {
    return (
      <Card className="relative overflow-hidden font-sans">
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: 'url(/icons/bgclaim.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
        <div className="relative z-10 text-white">
          <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <div className="bg-white rounded-full p-0.5 flex items-center justify-center">
              <Image src="/icons/verified.svg" alt="Verified" width={24} height={24} />
            </div>
            Verification Required
          </CardTitle>
            <CardDescription className="text-white/90">
              You need to verify your X account first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-sans font-medium"
              onClick={() => openExternalUrl('https://verify.base.dev')}
            >
              Open Base Verify
            </Button>
            <Button
              variant="ghost"
              className="w-full text-sm text-white/80 hover:text-white hover:bg-white/10 font-sans"
              onClick={() => {
                setStep('idle');
                handleVerify();
              }}
            >
              I've Verified, Check Again
            </Button>
          </CardContent>
        </div>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden">
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: 'url(/icons/bgclaim.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div className="relative z-10 font-sans text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <div className="bg-white rounded-full p-0.5 flex items-center justify-center">
              <Image src="/icons/verified.svg" alt="Verified" width={24} height={24} /> 
            </div>
          </CardTitle>
          <CardDescription className="text-white/90">
            Verify your X account on Base Verify to mint a free plant!
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded p-3 text-sm text-white/90 font-sans flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-300" />
              <span>{error}</span>
            </div>
          )}

          <Button 
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-sans font-medium" 
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
          <p className="text-xs text-white/80 text-center font-sans">
            Powered by Base Verify. No gas required.
          </p>
        </CardContent>
      </div>
    </Card>
  );
}
