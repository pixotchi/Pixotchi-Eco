'use client';

import { useState, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Gift, Loader2, CheckCircle, PenTool } from 'lucide-react';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
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

    // Feature flag: Hides the card if env var is not set to 'true'
    const showAirdrop = process.env.NEXT_PUBLIC_SHOW_AIRDROP === 'true';
    if (!showAirdrop) {
        return null;
    }

    // Don't render if loading or no address
    if (loading || !address || !status) {
        return null;
    }

    // Not eligible state
    if (!status.eligible) {
        return (
            <div className="space-y-3 mb-4">
                <h3 className="text-sm font-medium text-muted-foreground">
                    Airdrop
                </h3>
                <StandardContainer className="p-4 rounded-md border bg-card">
                    <div className="flex items-center gap-3">
                        <Gift className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-muted-foreground">No Allocation</p>
                            <p className="text-xs text-muted-foreground">
                                You are not eligible for any airdrop right now. Keep playing and staying active to qualify for future rewards!
                            </p>
                        </div>
                    </div>
                </StandardContainer>
            </div>
        );
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
                        <CheckCircle className="w-5 h-5 text-value flex-shrink-0" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-value">
                                Airdrop Claimed
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Thanks for playing and helping Pixotchi grow🌱
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
                                    {tokens.map(t => {
                                        let iconPath = '';
                                        if (t.name === 'SEED') iconPath = '/PixotchiKit/COIN.svg';
                                        else if (t.name === 'LEAF') iconPath = '/icons/leaf.png';
                                        else if (t.name === 'PIXOTCHI') iconPath = '/icons/cc.png';

                                        return (
                                            <span
                                                key={t.name}
                                                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium border border-primary/20"
                                            >
                                                {iconPath && (
                                                    <Image
                                                        src={iconPath}
                                                        alt={t.name}
                                                        width={14}
                                                        height={14}
                                                        className="w-3.5 h-3.5 object-contain"
                                                    />
                                                )}
                                                {t.amount} {t.name}
                                            </span>
                                        );
                                    })}
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

