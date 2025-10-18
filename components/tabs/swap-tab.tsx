'use client';

import { useCallback } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { sdk } from '@farcaster/miniapp-sdk';
import { useFrameContext } from '@/lib/frame-context';
import { Swap, SwapAmountInput, SwapButton, SwapMessage, SwapToast, SwapToggleButton } from '@coinbase/onchainkit/swap';
import type { Token } from '@coinbase/onchainkit/token';
import { PIXOTCHI_TOKEN_ADDRESS, WETH_ADDRESS, USDC_ADDRESS } from '@/lib/contracts';

export default function SwapTab() {
  const { address } = useAccount();
  const fc = useFrameContext();
  const isMiniApp = Boolean(fc?.isInMiniApp);

  const ETH: Token = {
    address: "0x4200000000000000000000000000000000000006",
    chainId: 8453,
    decimals: 18,
    name: "ETH",
    symbol: "ETH",
    image: "https://wallet-api-production.s3.amazonaws.com/uploads/tokens/eth_288.png",
  };

  const SEED: Token = {
    address: PIXOTCHI_TOKEN_ADDRESS,
    chainId: 8453,
    decimals: 18,
    name: "SEED",
    symbol: "SEED",
    image: "/PixotchiKit/COIN.svg",
  };

  const USDC: Token = {
    address: USDC_ADDRESS,
    chainId: 8453,
    decimals: 6,
    name: "USDC",
    symbol: "USDC",
    image: "https://dynamic-assets.coinbase.com/3c15df5e2ac7d4abbe9499ed9335041f00c620f28e8de2f93474a9f432058742cdf4674bd43f309e69778a26969372310135be97eb183d91c492154176d455b8/asset_icons/9d67b728b6c8f457717154b3a35f9ddc702eae7e76c4684ee39302c4d7fd0bb8.png",
  };

  const SWAPPABLE: Token[] = [ETH, SEED, USDC];

  const handleSuccess = useCallback(() => {
    try { window.dispatchEvent(new Event('balances:refresh')); } catch {}
    toast.success('Swap successful!');
  }, []);

  const handleError = useCallback((error: any) => {
    try { toast.error(String(error?.message || error || 'Swap failed')); } catch {}
  }, []);

  if (!address) {
    return (
      <div className="text-center text-muted-foreground py-8">Connect your wallet to swap.</div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Swap</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div data-ock-theme="pixotchi">
          <Swap
            isSponsored={false}
            experimental={{ useAggregator: true }}
            config={{ maxSlippage: 5.5 }}
            onSuccess={handleSuccess}
            onError={handleError}
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
              <h4 className="font-semibold">100% In-Game Burn</h4>
              <p className="text-muted-foreground text-xs">
                Currently, 100% of the SEED tokens spent within the game on items or upgrades are permanently burned.
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
                <li><span className="font-semibold">1% to Liquidity Pool:</span> Automatically added to the SEED/ETH liquidity pool to ensure stability.</li>
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
        </CardContent>
      </Card>
    </div>
  );
} 


