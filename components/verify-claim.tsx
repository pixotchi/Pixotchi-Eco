'use client';

import { useState, useEffect } from 'react';
import { useOwnerOperationScope } from '@/hooks/useOwnerOperationScope';
import type { OwnerOperationScope } from '@/lib/owner-operation-scope';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { ClaimRecoveryCard } from '@/components/claim-recovery-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useSignMessage } from 'wagmi';
import { SiweMessage, generateNonce } from 'siwe';
import { openExternalUrl } from '@/lib/open-external';
import {
  VERIFY_CLAIM_LEAF_BONUS_LABEL,
  VERIFY_CLAIM_SEED_BONUS_LABEL,
} from '@/lib/verify-claim-config';

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
  onClaimSuccess: (claim: { strainId: number; mintTxHash?: string }) => void;
  strainId?: number; // Optional: Force specific strain or default to Zest(4)
  appearance?: 'default' | 'compact';
}

type ClaimState = 'unclaimed' | 'retryable' | 'processing' | 'complete' | 'manual_review' | 'unavailable';

type ClaimRecoveryDetails = {
  reservationId?: string;
  stage?: string;
  txHash?: string;
};

function parseClaimState(value: unknown): ClaimState | null {
  return value === 'unclaimed'
    || value === 'retryable'
    || value === 'processing'
    || value === 'complete'
    || value === 'manual_review'
    ? value
    : null;
}

export function VerifyClaim({ onClaimSuccess, strainId = 4, appearance = 'default' }: VerifyClaimProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  if (!BASE_VERIFY_CONFIG.enabled) return null;
  return <VerifyClaimContent key={address?.toLowerCase() ?? 'disconnected'} address={address} signMessageAsync={signMessageAsync} onClaimSuccess={onClaimSuccess} strainId={strainId} appearance={appearance} />;
}

/** Mounted separately per wallet so UI/recovery state cannot outlive its owner. */
export function VerifyClaimContent({ onClaimSuccess, strainId = 4, appearance = 'default', address, signMessageAsync, request = fetch }: VerifyClaimProps & {
  address?: `0x${string}`;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
  request?: typeof fetch;
}) {
  const operationScope = useOwnerOperationScope(address?.toLowerCase() ?? null);
  const compact = appearance === 'compact';

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'verifying' | 'claiming' | 'success' | 'unverified'>('idle');
  const [error, setError] = useState<string | null>(null);
  
  // Claim status from Redis (source of truth)
  const [claimState, setClaimState] = useState<ClaimState | null>(null);
  const [claimRecovery, setClaimRecovery] = useState<ClaimRecoveryDetails | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Bonus availability from status endpoint
  const [bonuses, setBonuses] = useState<{ leaf: boolean; seed: boolean }>({ leaf: false, seed: false });

  // Check claim status from Redis on mount and when address changes
  useEffect(() => {
    const operation = operationScope.capture();
    const controller = new AbortController();
    async function checkClaimStatus() {
      if (!address) {
        setStatusLoading(false);
        setClaimState('unclaimed');
        setClaimRecovery(null);
        return;
      }

      try {
        setStatusLoading(true);
        setStatusError(null);
        const response = await request(`/api/verify/status?address=${address}`, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Verify status request failed (${response.status})`);
        }
        const data = await response.json();
        if (!operation.isCurrent() || controller.signal.aborted) return;
        setLastCheckedAt(Date.now());

        // Hide only on an EXPLICIT disable: a structured error body without
        // `enabled` used to hide the free-claim CTA for the session.
        if (data.enabled === false) {
          setClaimState('complete'); // Hide the card on an explicit disable.
        } else {
          const nextClaimState = parseClaimState(data.claimState);
          if (!nextClaimState) {
            throw new Error('Verify status returned an invalid claim state');
          }
          setClaimState(nextClaimState);
          setClaimRecovery(data.claimData ? {
            reservationId: data.claimData.reservationId,
            stage: data.claimData.stage,
            txHash: data.claimData.mintTxHash ?? data.claimData.txHash,
          } : null);
          if ((nextClaimState === 'unclaimed' || nextClaimState === 'retryable') && data.bonuses) {
            setBonuses(data.bonuses);
          }
        }
      } catch (err) {
        if (!operation.isCurrent() || controller.signal.aborted) return;
        console.error('[VERIFY] Failed to check claim status:', err);
        // An outage cannot prove there is no post-submission reservation.
        setClaimState(previous => previous === 'processing' || previous === 'manual_review' ? previous : 'unavailable');
        setStatusError('The latest status check failed. Your claim details are saved here; please try again.');
      } finally {
        if (operation.isCurrent() && !controller.signal.aborted) setStatusLoading(false);
      }
    }

    void checkClaimStatus();
    return () => controller.abort();
  }, [address, operationScope, request, statusRefreshKey]);

  const handleVerify = async () => {
    if (!address) {
      toast.error('Please connect your wallet');
      return;
    }

    const operation = operationScope.capture();
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
      
      const signature = await signMessageAsync({ message: messageText });
      if (!operation.isCurrent()) return;

      // 2. Check Verification via Backend
      const response = await request('/api/verify/check', {
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
      if (!operation.isCurrent()) return;

      if (response.ok && data.verified) {
        if (data.alreadyClaimed) {
          const serverClaimState = parseClaimState(data.claimState) ?? 'manual_review';
          setClaimState(serverClaimState);
          setClaimRecovery({
            reservationId: data.reservationId,
            stage: data.recoveryStage,
          });
          setError(serverClaimState === 'complete'
            ? 'This account has already claimed a free plant.'
            : null);
          setStep('idle');
        } else {
          setClaimState(data.retryable === true ? 'retryable' : 'unclaimed');
          setStep('claiming'); // Auto-proceed to claim for smoother UX
          await handleClaim(data.token, operation);
        }
      } else if (response.status === 404) {
        // Not verified -> Redirect to Base Verify Mini App
        setStep('unverified');
        setError(null);
      } else {
        throw new Error(data.error || 'Verification failed');
      }

    } catch (err: UntypedValue) {
      if (!operation.isCurrent()) return;
      console.error('Verify error:', err);
      setError(err.message || 'Failed to verify');
      setStep('idle');
    } finally {
      if (operation.isCurrent()) setLoading(false);
    }
  };

  const handleClaim = async (token: string, operation: ReturnType<OwnerOperationScope['capture']>) => {
    if (!operation.isCurrent()) return;
    setLoading(true);
    setStep('claiming');
    
    try {
      const response = await request('/api/verify/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: operation.owner,
          verificationToken: token,
          provider: 'x',
          strainId: strainId
        })
      });

      const data = await response.json();
      // A submitted claim remains associated with its original wallet on the
      // server. A late response must never celebrate/refresh the new wallet.
      if (!operation.isCurrent()) return;

      if (response.ok && data.success) {
        if (data.status === 'complete') {
          setClaimState('complete');
          setStep('success');
          toast.success(data.message || 'Free plant claimed and transferred successfully!');
          onClaimSuccess({
            strainId,
            mintTxHash: data.mintTxHash ?? data.txHash,
          });
        } else {
          // A partial response represents a durable, non-retryable recovery
          // state, not proof that the whole claim completed.
          setClaimState('manual_review');
          setClaimRecovery({
            reservationId: data.reservationId,
            stage: data.recoveryStage,
          });
          setStep('idle');
          toast.error(data.message || 'Your claim needs reconciliation before it can continue.');
          if (data.mintTxHash) {
            onClaimSuccess({ strainId, mintTxHash: data.mintTxHash });
          }
        }
      } else {
        const serverClaimState = parseClaimState(data.claimState);
        if (serverClaimState) {
          setClaimState(serverClaimState);
        } else if (data.recoveryStage === 'failed_before_submission') {
          setClaimState('retryable');
        } else if (data.recoveryStage) {
          setClaimState(data.recoveryStage === 'reserved' ? 'processing' : 'manual_review');
        }
        setClaimRecovery({
          reservationId: data.reservationId,
          stage: data.recoveryStage,
        });
        throw new Error(data.error || 'Claim failed');
      }
    } catch (err: UntypedValue) {
      if (!operation.isCurrent()) return;
      console.error('Claim error:', err);
      setError(err.message || 'Failed to claim');
      setStep('idle');
    } finally {
      if (operation.isCurrent()) setLoading(false);
    }
  };

  // Build dynamic reward description based on active bonuses
  const rewardDescription = (() => {
    const parts: string[] = ['a free plant'];
    if (bonuses.leaf) parts.push(VERIFY_CLAIM_LEAF_BONUS_LABEL);
    if (bonuses.seed) parts.push(VERIFY_CLAIM_SEED_BONUS_LABEL);
    return parts.join(' + ');
  })();
  // Don't render if:
  // 1. Feature is disabled via env
  // 2. Still loading claim status
  // 3. User has already claimed (Redis is source of truth)
  if (statusLoading && claimState === null) {
    return <Card aria-busy="true" role="status" className="min-h-28 justify-center"><p className="text-sm text-muted-foreground">Checking free-plant eligibility…</p></Card>;
  }

  if (claimState === 'complete' && step !== 'success') {
    return null;
  }

  if (claimState === 'unavailable') {
    return (
      <Card className="border-amber-400/30 bg-amber-950/20 font-sans">
        <CardContent className="space-y-3 py-5 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-amber-300" />
          <p className="text-sm text-foreground">Claim status is temporarily unavailable.</p>
          <Button
            variant="outline"
            fullWidth
            disabled={statusLoading}
            aria-busy={statusLoading}
            onClick={() => setStatusRefreshKey((value) => value + 1)}
          >
            Check Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (claimState === 'processing' || claimState === 'manual_review') {
    const needsReview = claimState === 'manual_review';
    return <ClaimRecoveryCard
      title={needsReview ? 'Claim needs review' : 'Claim is being prepared'}
      description={needsReview ? 'Your claim may already be on the network. Check its status or contact support before trying again.' : 'Your claim is in progress. You can check its status again shortly.'}
      address={address} reference={claimRecovery?.reservationId} txHash={claimRecovery?.txHash}
      updatedAt={lastCheckedAt} checking={statusLoading} error={statusError}
      onCheckStatus={() => setStatusRefreshKey(value => value + 1)}
    />;
  }

  if (step === 'success') {
    return (
      <Card className="border-[hsl(var(--success)/0.32)] bg-[hsl(var(--success)/0.12)]">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center">
          <CheckCircle2 className="w-12 h-12 text-[hsl(var(--success))] mb-2" />
          <h3 className="text-lg font-bold text-[hsl(var(--success-strong))]">Claimed!</h3>
          <p className="text-sm text-muted-foreground">Your free plant has been transferred to your wallet.</p>
        </CardContent>
      </Card>
    );
  }


  if (step === 'unverified') {
    return (
      <Card className={compact ? 'overflow-hidden border-primary/20 bg-primary/5' : 'relative overflow-hidden font-sans'}>
        {!compact && <div
          className="absolute inset-0 z-0 bg-slate-900"
          style={{
            backgroundImage: 'url(/icons/bgclaim.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />}
        <div className={compact ? 'flex flex-col gap-3' : 'relative z-10 text-white'}>
          <CardHeader className={compact ? 'mb-0 min-w-0' : undefined}>
          <CardTitle className={compact ? 'flex items-center gap-2 text-base text-foreground' : 'flex items-center gap-2 text-white'}>
            <div className="bg-white rounded-full p-0.5 flex items-center justify-center">
              <Image src="/icons/verified.svg" alt="Verified" width={24} height={24} />
            </div>
            Verification Required
          </CardTitle>
            <CardDescription className={compact ? 'text-sm text-muted-foreground' : 'text-white/90'}>
              You need to verify your X account first.
            </CardDescription>
          </CardHeader>
          <CardContent className={compact ? 'space-y-2' : 'space-y-3'}>
            <Button
              variant={compact ? 'default' : 'imageCardPrimary'}
              fullWidth
              className="h-auto min-h-11 whitespace-normal font-sans leading-snug"
              onClick={() => openExternalUrl('https://verify.base.dev')}
            >
              Open Base Verify
            </Button>
            <Button
              variant="ghost"
              className={compact ? 'w-full text-xs text-foreground' : 'w-full text-sm text-white/80 hover:text-white hover:bg-white/10 font-sans'}
              onClick={() => {
                setStep('idle');
                handleVerify();
              }}
            >
              I&apos;ve Verified, Check Again
            </Button>
          </CardContent>
        </div>
      </Card>
    );
  }

  return (
    <Card className={compact ? 'overflow-hidden border-primary/20 bg-primary/5' : 'relative overflow-hidden'}>
      {!compact && <div
        className="absolute inset-0 z-0 bg-slate-900"
        style={{
          backgroundImage: 'url(/icons/bgclaim.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />}
      <div className={compact ? 'flex flex-col gap-3' : 'relative z-10 font-sans text-white'}>
        <CardHeader className={compact ? 'mb-0 min-w-0' : undefined}>
          <CardTitle className={compact ? 'flex items-center gap-2 text-base text-foreground' : 'flex items-center gap-2 text-white'}>
            <div className="bg-white rounded-full p-0.5 flex items-center justify-center">
              <Image src="/icons/verified.svg" alt="" aria-hidden="true" width={24} height={24} />
            </div>
            {claimState === 'retryable' ? 'Retry your free plant claim' : 'Claim your free plant'}
          </CardTitle>
          <CardDescription className={compact ? 'text-sm text-muted-foreground' : 'text-white/90'}>
            {claimState === 'retryable'
              ? 'Your earlier attempt stopped before submission. Verify again to retry safely.'
              : <>Verify your X account to claim {rewardDescription}!</>}
          </CardDescription>
        </CardHeader>
        <CardContent className={compact ? 'space-y-2' : 'space-y-4'}>
          {error && (
            <div className={`rounded border border-destructive/30 bg-destructive/15 p-3 text-sm flex gap-2 items-start ${compact ? 'text-foreground' : 'text-white/90 font-sans'}`}>
              <AlertCircle className={`w-4 h-4 mt-0.5 shrink-0 ${compact ? 'text-destructive' : 'text-white'}`} />
              <span>{error}</span>
            </div>
          )}

          <Button 
            variant={compact ? 'default' : 'imageCardPrimary'}
            fullWidth
            className="h-auto min-h-11 whitespace-normal font-sans leading-snug"
            onClick={handleVerify}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {step === 'verifying' ? 'Verifying...' : 'Claiming...'}
              </>
            ) : (
              claimState === 'retryable' ? 'Verify & Retry Claim' : 'Check eligibility & claim'
            )}
          </Button>
          <p className={compact ? 'text-xs text-muted-foreground text-center' : 'text-xs text-white/80 text-center font-sans'}>
            Powered by Base Verify.
          </p>
        </CardContent>
      </div>
    </Card>
  );
}
