'use client';

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { sdk } from '@farcaster/miniapp-sdk';
import { useFrameContext } from '@/lib/frame-context';
import { Swap, SwapAmountInput, SwapButton, SwapMessage, SwapToast, SwapToggleButton } from '@coinbase/onchainkit/swap';
import { useTabVisibility } from "@/lib/tab-visibility-context";
import type { Token } from '@coinbase/onchainkit/token';
import type { LifecycleStatus } from '@coinbase/onchainkit/swap';
import { PIXOTCHI_TOKEN_ADDRESS, USDC_ADDRESS, JESSE_TOKEN_ADDRESS, CREATOR_TOKEN_ADDRESS } from '@/lib/contracts';
import TradingViewWidget from './TradingViewWidget';
import type { TransactionReceipt } from 'viem';

export default function SwapTab() {
  const { address } = useAccount();
  const fc = useFrameContext();
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const [swapView, setSwapView] = useState<'swap' | 'chart'>('swap');
  const [fromTokenSymbol, setFromTokenSymbol] = useState<string>('ETH');
  const [toTokenSymbol, setToTokenSymbol] = useState<string>('SEED');
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('swap');

  // Rewards distributed today (2% of 24h volume)
  const [rewardsData, setRewardsData] = useState<{ volume24h: number; rewards: number } | null>(null);

  // Track OnchainKit's internal token state to detect when toggle happens
  const lastKnownStateRef = useRef<{ from: string; to: string }>({ from: 'ETH', to: 'SEED' });

  const { ETH, SEED, USDC, JESSE, PIXOTCHI } = useMemo(() => {
    const eth: Token = {
      address: "", // Empty string for native ETH (per OnchainKit guidelines)
      chainId: 8453,
      decimals: 18,
      name: "ETH",
      symbol: "ETH",
      image: "https://wallet-api-production.s3.amazonaws.com/uploads/tokens/eth_288.png",
    };

    const seed: Token = {
      address: PIXOTCHI_TOKEN_ADDRESS,
      chainId: 8453,
      decimals: 18,
      name: "SEED",
      symbol: "SEED",
      image: "/PixotchiKit/COIN.svg",
    };

    const usdc: Token = {
      address: USDC_ADDRESS,
      chainId: 8453,
      decimals: 6,
      name: "USDC",
      symbol: "USDC",
      image: "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
    };

    const jesse: Token = {
      address: JESSE_TOKEN_ADDRESS,
      chainId: 8453,
      decimals: 18,
      name: "JESSE",
      symbol: "$JESSE",
      image: "/icons/jessetoken.png",
    };

    const pixotchi: Token = {
      address: CREATOR_TOKEN_ADDRESS,
      chainId: 8453,
      decimals: 18,
      name: "PIXOTCHI",
      symbol: "PIXOTCHI",
      image: "/icons/cc.png",
    };

    return {
      ETH: eth,
      SEED: seed,
      USDC: usdc,
      JESSE: jesse,
      PIXOTCHI: pixotchi,
    };
  }, []);

  // SEED or JESSE or PIXOTCHI must always be part of the swap
  // If "to" is SEED or JESSE or PIXOTCHI, "from" can be ETH, USDC, SEED, JESSE, or PIXOTCHI (but not same as "to")
  // If "to" is ETH or USDC, "from" must be SEED or JESSE or PIXOTCHI
  const fromSwappable = useMemo(() => {
    if (toTokenSymbol === 'SEED') {
      return [ETH, USDC, JESSE, PIXOTCHI];
    } else if (toTokenSymbol === '$JESSE' || toTokenSymbol === 'JESSE') {
      return [ETH, USDC, SEED, PIXOTCHI];
    } else if (toTokenSymbol === 'PIXOTCHI') {
      return [ETH, USDC, SEED, JESSE];
    } else {
      // "to" is ETH or USDC, so "from" must be SEED or JESSE or PIXOTCHI
      return [SEED, JESSE, PIXOTCHI];
    }
  }, [toTokenSymbol, ETH, USDC, SEED, JESSE, PIXOTCHI]);

  // If "from" is SEED or JESSE or PIXOTCHI, "to" can be ETH, USDC, SEED, JESSE, or PIXOTCHI (but not same as "from")
  // If "from" is ETH or USDC, "to" must be SEED or JESSE or PIXOTCHI
  const toSwappable = useMemo(() => {
    if (fromTokenSymbol === 'SEED') {
      return [ETH, USDC, JESSE, PIXOTCHI];
    } else if (fromTokenSymbol === '$JESSE' || fromTokenSymbol === 'JESSE') {
      return [ETH, USDC, SEED, PIXOTCHI];
    } else if (fromTokenSymbol === 'PIXOTCHI') {
      return [ETH, USDC, SEED, JESSE];
    } else {
      // "from" is ETH or USDC, so "to" must be SEED or JESSE or PIXOTCHI
      return [SEED, JESSE, PIXOTCHI];
    }
  }, [fromTokenSymbol, ETH, USDC, SEED, JESSE, PIXOTCHI]);

  const handleSuccess = useCallback((receipt: TransactionReceipt) => {
    try { window.dispatchEvent(new Event('balances:refresh')); } catch { }
    toast.success('Swap successful!');

    if (!address) return;
    const hash = receipt?.transactionHash ?? null;

    if (!hash) {
      console.warn('[SwapTab] Swap completed without transaction hash; skipping mission update');
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        address,
        taskId: 's4_make_swap',
        proof: { txHash: hash },
      };
      fetch('/api/gamification/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch((err) => console.warn('[SwapTab] Gamification tracking failed (non-critical):', err));
    } catch (error) {
      console.warn('[SwapTab] Failed to dispatch gamification mission:', error);
    }
  }, [address]);

  const handleError = useCallback((error: any) => {
    try {
      const errorMessage = error?.message || error?.error || String(error) || 'Swap failed';
      toast.error(errorMessage);
      console.error('[SwapTab] Swap error:', error);
    } catch (e) {
      console.error('[SwapTab] Error handling failed:', e);
      toast.error('An unexpected error occurred');
    }
  }, []);

  const handleStatus = useCallback((status: LifecycleStatus) => {
    // Detect when OnchainKit's internal tokens have changed (via toggle or manual selection)
    // and sync our state to match
    if (status.statusName === 'amountChange') {
      const statusData = status.statusData as any;
      if (statusData?.tokenFrom?.symbol && statusData?.tokenTo?.symbol) {
        const onchainFromSymbol = statusData.tokenFrom.symbol;
        const onchainToSymbol = statusData.tokenTo.symbol;

        // Check if OnchainKit's state is different from our last known state
        if (
          onchainFromSymbol !== lastKnownStateRef.current.from ||
          onchainToSymbol !== lastKnownStateRef.current.to
        ) {
          // Token pair changed - update our state to match OnchainKit
          lastKnownStateRef.current = { from: onchainFromSymbol, to: onchainToSymbol };
          setFromTokenSymbol(onchainFromSymbol);
          setToTokenSymbol(onchainToSymbol);
        }
      }
    }
  }, []);

  // Refresh global balances when swap tab is visible (in case user swapped elsewhere/added funds)
  useEffect(() => {
    if (isVisible) {
      console.log('🔄 [SwapTab] Tab visible, triggering balance refresh...');
      window.dispatchEvent(new Event('balances:refresh'));
    }
  }, [isVisible]);

  // Fetch rewards data (24h volume from DexScreener)
  useEffect(() => {
    const fetchRewardsData = async () => {
      try {
        const res = await fetch('/api/seed-volume');
        if (res.ok) {
          const data = await res.json();
          setRewardsData({ volume24h: data.volume24h, rewards: data.rewards });
        }
      } catch (error) {
        console.error('Failed to fetch rewards data:', error);
      }
    };
    fetchRewardsData();
  }, []);

  if (!address) {
    return (
      <div className="text-center text-muted-foreground py-8">Connect your wallet to swap.</div>
    );
  }

  return (
    <div className="space-y-4">
      <Card
        className={swapView === 'chart' ? 'flex flex-col aspect-square' : ''}
        padding={swapView === 'chart' ? 'none' : 'md'}
      >
        <CardHeader className={swapView === 'chart' ? 'pb-3 px-4 pt-4 flex-shrink-0' : ''}>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>{swapView === 'chart' ? 'Chart' : 'Swap'}</CardTitle>
            <ToggleGroup
              value={swapView}
              onValueChange={(v) => setSwapView(v as 'swap' | 'chart')}
              options={[
                { value: 'swap', label: 'Swap' },
                { value: 'chart', label: 'Chart' },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent className={swapView === 'chart' ? 'flex-1 p-4 overflow-hidden' : 'space-y-4'}>
          {swapView === 'swap' ? (
            <div data-ock-theme="pixotchi">
              <Swap
                isSponsored={false}
                experimental={{ useAggregator: true }}
                config={{ maxSlippage: 5.5 }}
                onSuccess={handleSuccess}
                onError={handleError}
                onStatus={handleStatus}
              >
                {/* SEED or JESSE or PIXOTCHI must always be part of the swap - only show valid token pairs */}
                <SwapAmountInput
                  label="Sell"
                  token={
                    fromTokenSymbol === 'ETH' ? ETH
                      : fromTokenSymbol === 'USDC' ? USDC
                        : fromTokenSymbol === '$JESSE' || fromTokenSymbol === 'JESSE' ? JESSE
                          : fromTokenSymbol === 'PIXOTCHI' ? PIXOTCHI
                            : SEED
                  }
                  swappableTokens={fromSwappable}
                  type="from"
                />
                <SwapToggleButton />
                <SwapAmountInput
                  label="Buy"
                  token={
                    toTokenSymbol === 'ETH' ? ETH
                      : toTokenSymbol === 'USDC' ? USDC
                        : toTokenSymbol === '$JESSE' || toTokenSymbol === 'JESSE' ? JESSE
                          : toTokenSymbol === 'PIXOTCHI' ? PIXOTCHI
                            : SEED
                  }
                  swappableTokens={toSwappable}
                  type="to"
                />
                <SwapButton />
                <SwapMessage />
                <SwapToast />
              </Swap>
            </div>
          ) : (
            <TradingViewWidget />
          )}
        </CardContent>
      </Card>

      {/* Tokenomics Section */}
      <Card>
        <CardHeader>
          <CardTitle>Tokenomics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-start space-x-3">
            <Image src="/icons/fire.svg" alt="Burn" width={20} height={20} className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold">70% In-Game Burn</h4>
              <p className="text-muted-foreground text-xs">
                Currently, 70% of the SEED tokens spent within the game on items or upgrades are permanently burned. 30% are added to the Quests rewards pool.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Image src="/icons/tax.svg" alt="Tax" width={20} height={20} className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold">5% Buy/Sell Tax</h4>
              <p className="text-muted-foreground text-xs">
                A 5% tax is applied to all SEED token swaps to sustain the ecosystem, instantly distributed as follows:
              </p>
              <ul className="mt-2 space-y-1 text-xs list-disc pl-5">
                <li><span className="font-semibold">2% to Player Rewards:</span> Distributed as ETH to players based on ranking.</li>
                <li><span className="font-semibold">2% to Project Treasury:</span> Funds ongoing development and operational costs.</li>
                <li><span className="font-semibold">1% to Liquidity Pool:</span> Automatically added to the SEED/ETH liquidity pool to ensure higher stablity.</li>
              </ul>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Image src="/icons/ethlogo.svg" alt="Rewards" width={20} height={20} className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold">
                {rewardsData ? (
                  `$${rewardsData.rewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Rewards Distributed Today`
                ) : (
                  'Rewards Distributed Today'
                )}
              </h4>
              <p className="text-muted-foreground text-xs">
                2% of SEED trading volume is distributed daily to plants as ETH based on their points. Higher points = larger rewards.
                {rewardsData && ` Based on $${rewardsData.volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })} 24h volume.`}
              </p>
            </div>
          </div>

          {isMiniApp && (
            <div className="pt-2">
              <Button
                className="w-full"
                onClick={async () => {
                  try {
                    await sdk.actions.viewToken({ token: `eip155:8453/erc20:${PIXOTCHI_TOKEN_ADDRESS}` });
                  } catch (err) {
                    toast.error('View Token is only available in supported Farcaster clients.');
                  }
                }}
                aria-label="View SEED token on Base"
              >
                View Token
              </Button>
            </div>
          )}

          {/* Disclaimer Section */}
          <div className="pt-4 mt-4 border-t border-border/30">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold block mb-2">Disclaimer:</span>
              SEED was launched independently via BaseSwap with 100% of the supply (20M) in circulation with no pre-mint or team allocation. Acquiring $SEED tokens does not represent an investment contract or financial advice. Token value may fluctuate significantly. Please consult your local laws regarding token ownership in your jurisdiction.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


