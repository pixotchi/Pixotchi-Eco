'use client';

import { useState, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Gift, Loader2, CheckCircle, PenTool } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { StandardContainer } from '@/components/ui/pixel-container';

interface AirdropStatus {
    eligible: boolean;
    seed: string;
    leaf: string;
    pixotchi: string;
    claimed: boolean;
    txHash?: string;
}

export function AirdropClaimCard() {
    const { address } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const [status, setStatus] = useState<AirdropStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [claiming, setClaiming] = useState(false);
    const [signingStep, setSigningStep] = useState<'idle' | 'signing' | 'claiming'>('idle');

    // Fetch eligibility on mount and when address changes
    useEffect(() => {
        async function fetchStatus() {
            if (!address) {
                setStatus(null);
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const res = await fetch(`/api/airdrop/status?address=${address}`);
                const data = await res.json();
                setStatus(data);
            } catch (err) {
                console.error('[AIRDROP] Failed to fetch status:', err);
                setStatus(null);
            } finally {
                setLoading(false);
            }
        }

        fetchStatus();
    }, [address]);

    const handleClaim = async () => {
        if (!address || !status?.eligible || status.claimed) return;

        setClaiming(true);
        setSigningStep('signing');

        try {
            // Step 1: Get the message to sign from the API
            const messageRes = await fetch(`/api/airdrop/claim?address=${address}`);
            const messageData = await messageRes.json();

            if (!messageRes.ok) {
                throw new Error(messageData.error || 'Failed to get claim message');
            }

            const { message, timestamp } = messageData;

            // Step 2: Request user to sign the message
            let signature: string;
            try {
                signature = await signMessageAsync({ message });
            } catch (signError: any) {
                // User rejected the signature
                if (signError?.name === 'UserRejectedRequestError' || signError?.code === 4001) {
                    toast.error('Signature rejected. Please sign to claim your airdrop.');
                    return;
                }
                throw signError;
            }

            setSigningStep('claiming');

            // Step 3: Submit claim with signature
            const res = await fetch('/api/airdrop/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userAddress: address,
                    signature,
                    timestamp,
                }),
            });

            const data = await res.json();

            if (res.ok && data.success) {
                toast.success('Airdrop claimed successfully!');
                setStatus(prev => prev ? { ...prev, claimed: true, txHash: data.txHash } : null);
            } else {
                toast.error(data.error || 'Claim failed');
            }
        } catch (err: any) {
            console.error('[AIRDROP] Claim error:', err);
            toast.error(err?.message || 'Failed to claim airdrop');
        } finally {
            setClaiming(false);
            setSigningStep('idle');
        }
    };

    // Don't render if loading, no address, not eligible, or already claimed
    if (loading || !address || !status?.eligible) {
        return null;
    }

    // Format token amounts for display
    const formatAmount = (amount: string) => {
        const num = parseFloat(amount);
        if (num === 0) return null;
        if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
        return num.toFixed(2);
    };

    const seedDisplay = formatAmount(status.seed);
    const leafDisplay = formatAmount(status.leaf);
    const pixotchiDisplay = formatAmount(status.pixotchi);

    const tokens: Array<{ name: string; amount: string | null }> = [
        { name: 'SEED', amount: seedDisplay },
        { name: 'LEAF', amount: leafDisplay },
        { name: 'PIXOTCHI', amount: pixotchiDisplay },
    ].filter(t => t.amount !== null);

    if (tokens.length === 0 && status.claimed) {
        return null;
    }

    const getButtonContent = () => {
        if (signingStep === 'signing') {
            return (
                <>
                    <PenTool className="w-4 h-4 mr-2 animate-pulse" />
                    Sign to Claim...
                </>
            );
        }
        if (signingStep === 'claiming') {
            return (
                <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Claiming...
                </>
            );
        }
        return (
            <>
                <Gift className="w-4 h-4 mr-2" />
                Claim Airdrop
            </>
        );
    };

    return (
        <div className="space-y-3 mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
                Airdrop
            </h3>
            <StandardContainer className="p-4 rounded-md border bg-card">
                {status.claimed ? (
                    // Already claimed state
                    <div className="flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-green-600 dark:text-green-400">
                                Airdrop Claimed
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Tokens have been sent to your wallet.
                            </p>
                        </div>
                    </div>
                ) : (
                    // Unclaimed state
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <Gift className="w-5 h-5 text-primary flex-shrink-0" />
                            <div className="flex-1">
                                <p className="text-sm font-medium">Claimable Tokens</p>
                                <div className="flex flex-wrap gap-2 mt-1">
                                    {tokens.map(t => (
                                        <span
                                            key={t.name}
                                            className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium"
                                        >
                                            {t.amount} {t.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <Button
                            onClick={handleClaim}
                            disabled={claiming}
                            className="w-full"
                            size="sm"
                        >
                            {getButtonContent()}
                        </Button>
                    </div>
                )}
            </StandardContainer>
        </div>
    );
}

