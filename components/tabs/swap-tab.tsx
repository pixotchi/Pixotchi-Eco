'use client';

import { useEffect, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { erc20Abi } from 'viem';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ToggleGroup } from '@/components/ui/toggle-group';
import ErrorBoundary from '@/components/ui/error-boundary';
import { sdk } from '@farcaster/miniapp-sdk';
import { CLIENT_ENV } from '@/lib/env-config';
import { useFrameContext } from '@/lib/frame-context';
import { useTabVisibility } from "@/lib/tab-visibility-context";
import TradingViewWidget from './TradingViewWidget';
import PixotchiSwapPanel from './pixotchi-swap-panel';
import { SEED_ADDRESS } from '@/lib/swap/constants';

const INITIAL_SEED_SUPPLY = BigInt(20_000_000) * BigInt(10) ** BigInt(18);
const PERCENTAGE_BASIS_POINTS = BigInt(10_000);

function SwapLockedState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-amber-500/30 bg-background/70 text-2xl">
          !
        </div>
        <p className="text-lg font-semibold text-foreground">Swaps temporarily unavailable</p>
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}

export default function SwapTab() {
  const { address } = useAccount();
  const fc = useFrameContext();
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const isSwapModuleDisabled = CLIENT_ENV.SWAP_MODULE_DISABLED;
  const swapDisabledMessage = CLIENT_ENV.SWAP_MODULE_DISABLED_MESSAGE;
  const [swapView, setSwapView] = useState<'swap' | 'chart'>('swap');
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('swap');
  const isChartView = swapView === 'chart';
  const { data: seedTotalSupply } = useReadContract({
    address: SEED_ADDRESS,
    abi: erc20Abi,
    functionName: 'totalSupply',
    query: {
      enabled: isVisible,
      staleTime: 60_000,
      refetchInterval: isVisible ? 60_000 : false,
    },
  });

  // Rewards distributed today (2% of 24h volume)
  const [rewardsData, setRewardsData] = useState<{ volume24h: number; rewards: number } | null>(null);
  const currentBurnedSupplyLabel =
    typeof seedTotalSupply === 'bigint' && seedTotalSupply <= INITIAL_SEED_SUPPLY
      ? `${(Number(((INITIAL_SEED_SUPPLY - seedTotalSupply) * PERCENTAGE_BASIS_POINTS) / INITIAL_SEED_SUPPLY) / 100).toFixed(2)}%`
      : '...';

  // Refresh global balances when swap tab is visible (in case user swapped elsewhere/added funds)
  useEffect(() => {
    if (isVisible) {
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

  if (!address && !isSwapModuleDisabled) {
    return (
      <div className="text-center text-muted-foreground py-8">Connect your wallet to swap.</div>
    );
  }

  return (
    <div className="space-y-4 xl:grid xl:grid-cols-[minmax(360px,480px)_minmax(520px,1fr)] xl:items-stretch xl:gap-5 xl:space-y-0">
      <Card
        className={`${isChartView ? 'flex flex-col aspect-square' : ''} xl:hidden`}
        padding={isChartView ? 'none' : 'md'}
      >
        <CardHeader className={isChartView ? 'pb-3 px-4 pt-4 flex-shrink-0' : ''}>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>{isChartView ? 'Chart' : 'Swap'}</CardTitle>
            <ToggleGroup
              value={swapView}
              onValueChange={(v) => setSwapView(v as 'swap' | 'chart')}
              options={[
                { value: 'swap', label: 'Swap' },
                { value: 'chart', label: 'Chart' },
              ]}
              getButtonClassName={(value) =>
                isSwapModuleDisabled && value === 'swap' ? 'opacity-60' : ''
              }
            />
          </div>
        </CardHeader>
        <CardContent className={isChartView ? 'flex-1 p-4 overflow-hidden' : 'space-y-4'}>
          {swapView === 'swap' ? (
            isSwapModuleDisabled ? (
              <SwapLockedState message={swapDisabledMessage} />
            ) : (
              <ErrorBoundary variant="inline" showErrorDetails>
                <PixotchiSwapPanel />
              </ErrorBoundary>
            )
          ) : (
            <TradingViewWidget />
          )}
        </CardContent>
      </Card>

      <Card className="hidden xl:block xl:h-full">
        <CardHeader>
          <CardTitle>Swap</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSwapModuleDisabled ? (
            <SwapLockedState message={swapDisabledMessage} />
          ) : (
            <ErrorBoundary variant="inline" showErrorDetails>
              <PixotchiSwapPanel />
            </ErrorBoundary>
          )}
        </CardContent>
      </Card>

      <Card className="hidden xl:flex xl:h-full xl:min-h-[360px] xl:flex-col" padding="none">
        <CardHeader className="px-4 pt-4 pb-3">
          <CardTitle>Chart</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-4">
          <TradingViewWidget />
        </CardContent>
      </Card>

      {/* Tokenomics Section */}
      <Card className="xl:col-span-2 xl:h-fit">
        <CardHeader>
          <CardTitle>Tokenomics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm xl:hidden">
          <div className="flex items-start space-x-3">
            <Image src="/icons/fire.svg" alt="Burn" width={20} height={20} className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-semibold">
                <span>70% In-Game Burn</span>
                <span className="text-xs font-medium text-muted-foreground">
                  (Current burnt supply: {currentBurnedSupplyLabel})
                </span>
              </h4>
              <p className="text-muted-foreground text-xs">
                Currently, 70% of the SEED tokens spent within the game on items or upgrades are permanently burned. 30% are added to the rewards pool.
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
                {rewardsData && ` Based on $${rewardsData.volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })} volume in the last 24h.`}
              </p>
            </div>
          </div>

          {isMiniApp && (
            <div className="pt-2">
              <Button
                className="w-full"
                onClick={async () => {
                  try {
                    await sdk.actions.viewToken({ token: `eip155:8453/erc20:${SEED_ADDRESS}` });
                  } catch {
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

        <CardContent className="hidden text-sm xl:grid xl:grid-cols-3 xl:items-stretch xl:gap-4">
          <div className="space-y-4 rounded-lg border border-border/60 bg-background/35 p-3">
            <div className="flex items-start space-x-3">
              <Image src="/icons/fire.svg" alt="Burn" width={20} height={20} className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-semibold">
                  <span>70% In-Game Burn</span>
                  <span className="text-xs font-medium text-muted-foreground">
                    (Current burnt supply: {currentBurnedSupplyLabel})
                  </span>
                </h4>
                <p className="text-muted-foreground text-xs">
                  Currently, 70% of the SEED tokens spent within the game on items or upgrades are permanently burned. 30% are added to the rewards pool.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3 border-t border-border/50 pt-4">
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
                  {rewardsData && ` Based on $${rewardsData.volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })} volume in the last 24h.`}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-start space-x-3 rounded-lg border border-border/60 bg-background/35 p-3">
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

          {/* Disclaimer Section */}
          <div className="rounded-lg border border-border/60 bg-background/35 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold block mb-2">Disclaimer:</span>
              SEED was launched independently via BaseSwap with 100% of the supply (20M) in circulation with no pre-mint or team allocation. Acquiring $SEED tokens does not represent an investment contract or financial advice. Token value may fluctuate significantly. Please consult your local laws regarding token ownership in your jurisdiction.
            </p>
          </div>

          {isMiniApp && (
            <div className="pt-2 xl:col-span-3">
              <Button
                className="w-full"
                onClick={async () => {
                  try {
                    await sdk.actions.viewToken({ token: `eip155:8453/erc20:${SEED_ADDRESS}` });
                  } catch {
                    toast.error('View Token is only available in supported Farcaster clients.');
                  }
                }}
                aria-label="View SEED token on Base"
              >
                View Token
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
