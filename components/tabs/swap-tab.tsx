'use client';

import { useCallback, useMemo } from 'react';
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
import type { Token } from '@coinbase/onchainkit/token';
import type { LifecycleStatus } from '@coinbase/onchainkit/swap';
import { PIXOTCHI_TOKEN_ADDRESS, USDC_ADDRESS } from '@/lib/contracts';
import TradingViewWidget from './TradingViewWidget';
import type { TransactionReceipt } from 'viem';

export default function SwapTab() {
  const { address } = useAccount();
  const fc = useFrameContext();
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const [swapView, setSwapView] = useState<'swap' | 'chart'>('swap');

  const { ETH, SEED, USDC, SWAPPABLE } = useMemo(() => {
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

    return {
      ETH: eth,
      SEED: seed,
      USDC: usdc,
      SWAPPABLE: [eth, seed, usdc] as Token[],
    };
  }, []);

  const handleSuccess = useCallback((receipt: TransactionReceipt) => {
    try { window.dispatchEvent(new Event('balances:refresh')); } catch {}
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
    console.log('[SwapTab] Swap lifecycle:', status.statusName, status.statusData);
    // Could be extended to show loading states, progress indicators, etc.
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
                {/* Allow token rotation and selection between ETH and SEED */}
                <SwapAmountInput label="Sell" token={ETH} swappableTokens={SWAPPABLE} type="from" />
                <SwapToggleButton />
                <SwapAmountInput label="Buy" token={SEED} swappableTokens={SWAPPABLE} type="to" />
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


