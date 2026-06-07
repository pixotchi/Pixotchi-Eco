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
            } catch (signError: UntypedValue) {
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
        } catch (err: UntypedValue) {
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

    const panelClassName =
        "overflow-hidden rounded-[var(--radius-panel)] border border-[hsl(var(--border-strong)/0.34)] bg-card/95 bg-[image:var(--gradient-surface-strong)] p-0 shadow-[var(--shadow-raised)]";
    const contentClassName =
        "relative p-3 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-20 before:bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.16),transparent_64%)]";
    const featureCardClassName =
        "relative flex items-center gap-3 rounded-[var(--radius-panel)] border border-primary/20 bg-primary/10 bg-[image:var(--gradient-selection)] p-3 shadow-[var(--shadow-hairline)]";
    const airdropGiftIconClassName =
        "h-9 w-9 shrink-0 text-primary drop-shadow-[0_6px_14px_hsl(var(--primary)/0.28)]";
    const claimedIconClassName =
        "h-8 w-8 shrink-0 text-value drop-shadow-[0_6px_14px_hsl(var(--success)/0.24)]";
    const baseActionClassName =
        "w-full border-[#0000ff]/70 !bg-[#0000ff] !bg-[image:linear-gradient(180deg,#2455ff_0%,#0000ff_58%,#0000cc_100%)] text-xs !text-white shadow-[0_8px_18px_-12px_rgba(0,0,255,0.9)] hover:!brightness-[1.06] hover:!text-white focus-visible:ring-[#0000ff]/45";

    // Don't render if loading or no address
    if (loading || !address || !status) {
        return null;
    }

    // Not eligible state
    if (!status.eligible) {
        return (
            <div className="space-y-3">
                <div className="flex items-center">
                    <h3 className="text-sm font-semibold text-foreground">
                        Airdrop
                    </h3>
                </div>
                <div className={featureCardClassName}>
                    <Gift className={airdropGiftIconClassName} />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">No Allocation</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            You are not eligible for any airdrop right now. Keep playing and staying active to qualify for future rewards!
                        </p>
                    </div>
                </div>
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
        <div className="space-y-3">
            <div className="flex items-center">
                <h3 className="text-sm font-semibold text-foreground">
                    Airdrop
                </h3>
            </div>
            <StandardContainer padding="none" className={panelClassName}>
                <div className={contentClassName}>
                    {status.claimed ? (
                        // Already claimed state
                        <div className={featureCardClassName}>
                            <CheckCircle className={claimedIconClassName} />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-value">
                                    Airdrop Claimed
                                </p>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    Thanks for playing and helping Pixotchi grow.
                                </p>
                            </div>
                        </div>
                    ) : (
                        // Unclaimed state
                        <div className="relative space-y-3">
                            <div className={featureCardClassName}>
                                <Gift className={airdropGiftIconClassName} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold">Claimable Tokens</p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {tokens.map(t => {
                                            let iconPath = '';
                                            if (t.name === 'SEED') iconPath = '/PixotchiKit/COIN.svg';
                                            else if (t.name === 'LEAF') iconPath = '/icons/leaf.png';
                                            else if (t.name === 'PIXOTCHI') iconPath = '/icons/cc.png';

                                            return (
                                                <span
                                                    key={t.name}
                                                    className="flex min-h-7 items-center gap-1.5 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary shadow-[var(--shadow-hairline)]"
                                                >
                                                    {iconPath && (
                                                        <Image
                                                            src={iconPath}
                                                            alt={t.name}
                                                            width={14}
                                                            height={14}
                                                            className="h-3.5 w-3.5 object-contain"
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
                                className={baseActionClassName}
                                size="sm"
                            >
                                {getButtonContent()}
                            </Button>
                        </div>
                    )}
                </div>
            </StandardContainer>
        </div>
    );
}
