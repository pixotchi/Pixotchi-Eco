'use client';

import { Button } from '@/components/ui/button';
import { handleExternalAnchorClick } from "@/lib/open-external";
import { CardContent, CardHeader, CardTitle, TabCard } from '@/components/ui/card';
import ErrorBoundary from '@/components/ui/error-boundary';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { CLIENT_ENV } from '@/lib/env-config';
import { useFrameContext } from '@/lib/frame-context';
import {
  getAllPixotchiTokenInfo,
  INITIAL_SEED_SUPPLY,
  PERCENTAGE_BASIS_POINTS,
  type PixotchiTokenInfoId,
  type PixotchiTokenInfoSection,
} from '@/lib/pixotchi-token-info';
import type { MarketWindow, SeedMarketData } from '@/lib/seed-market';
import { SEED_ADDRESS } from '@/lib/swap/constants';
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { sdk } from '@farcaster/miniapp-sdk';
import { Copy } from 'lucide-react';
import Image from 'next/image';
import { useEffect,useState,type ReactNode } from 'react';
import { toast } from 'react-hot-toast';
import { erc20Abi } from 'viem';
import { useAccount,useReadContract } from 'wagmi';
import TradingViewWidget from './TradingViewWidget';
import PixotchiSwapPanel from './pixotchi-swap-panel';

type SwapView = 'swap' | 'chart' | 'info';
type InfoToken = PixotchiTokenInfoId;

type TokenInfoSectionView = Omit<PixotchiTokenInfoSection, 'body' | 'bullets' | 'title'> & {
  title: ReactNode;
  body: ReactNode;
  bullets?: ReactNode[];
};

const TOKEN_INFO_OPTIONS = getAllPixotchiTokenInfo();
const DEFAULT_TOKEN_INFO = TOKEN_INFO_OPTIONS[0]!;

function SwapLockedState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center rounded-[var(--radius-panel)] border border-[hsl(var(--warning)/0.36)] bg-[hsl(var(--warning)/0.14)] p-6 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[hsl(var(--warning)/0.36)] bg-background/70 text-2xl text-[hsl(var(--warning-strong))]">
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

function getTokenInfoSections(
  activeToken: InfoToken,
  currentBurnedSupplyLabel: string,
  rewardsData: SeedMarketData | null
): TokenInfoSectionView[] {
  const tokenInfo = TOKEN_INFO_OPTIONS.find((token) => token.id === activeToken) ?? DEFAULT_TOKEN_INFO;

  return tokenInfo.sections.map((section) => {
    const title = section.key === 'seed-burn'
      ? (
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span>{section.title}</span>
          <span className="text-xs font-medium text-muted-foreground">
            (Current burnt supply: {currentBurnedSupplyLabel})
          </span>
        </span>
      )
      : section.key === 'seed-rewards' && rewardsData
        ? `$${rewardsData.rewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Rewards Distributed Today`
        : section.title;
    const body = section.key === 'seed-rewards' && rewardsData
      ? (
        <>
          {section.body}
          {` Based on $${rewardsData.volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })} volume in the last 24h.`}
        </>
      )
      : section.body;
    const bullets = section.bullets?.map((bullet) => (
      bullet.label
        ? <><span className="font-semibold text-foreground">{bullet.label}:</span> {bullet.body}</>
        : bullet.body
    ));

    return {
      ...section,
      body,
      bullets,
      title,
    };
  });
}

function TokenInfoPanel({
  activeToken,
  currentBurnedSupplyLabel,
  isMiniApp,
  rewardsData,
  setActiveToken,
}: {
  activeToken: InfoToken;
  currentBurnedSupplyLabel: string;
  isMiniApp: boolean;
  rewardsData: SeedMarketData | null;
  setActiveToken: (token: InfoToken) => void;
}) {
  const activeTokenInfo =
    TOKEN_INFO_OPTIONS.find((token) => token.id === activeToken) ?? DEFAULT_TOKEN_INFO;
  const sections = getTokenInfoSections(activeToken, currentBurnedSupplyLabel, rewardsData);

  const copyContractAddress = async () => {
    try {
      await navigator.clipboard.writeText(activeTokenInfo.contractAddress);
      toast.success(`${activeTokenInfo.symbol} contract copied`);
    } catch {
      toast.error('Could not copy the contract address');
    }
  };

  return (
    <div className="space-y-4 text-sm min-[54rem]:grid min-[54rem]:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)] min-[54rem]:items-start min-[54rem]:gap-5 min-[54rem]:space-y-0">
      <div className="space-y-3">
        <div
          className="grid grid-cols-3 gap-2 min-[54rem]:grid-cols-1"
          role="radiogroup"
          aria-label="Token information"
        >
          {TOKEN_INFO_OPTIONS.map((token) => {
            const isSelected = activeToken === token.id;
            return (
              <button
                key={token.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={token.symbol}
                title={token.symbol}
                onClick={() => setActiveToken(token.id)}
                className={`surface-control flex min-w-0 items-center justify-center gap-1 rounded-[var(--radius-nav)] border px-1.5 py-2 text-[10px] font-semibold transition-[background-color,border-color,color,box-shadow] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background min-[390px]:gap-1.5 min-[390px]:px-2 min-[390px]:text-xs min-[54rem]:justify-start min-[54rem]:px-3 ${
                  isSelected ? 'surface-control-selected' : 'text-foreground/80'
                }`}
              >
                <Image
                  src={token.iconSrc}
                  alt=""
                  width={20}
                  height={20}
                  className="h-5 w-5 shrink-0 rounded-full"
                  aria-hidden="true"
                />
                <span className="min-w-0 leading-none">{token.symbol}</span>
              </button>
            );
          })}
        </div>

        <div className="chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
          <div className="flex items-start gap-3">
            <Image
              src={activeTokenInfo.iconSrc}
              alt={activeTokenInfo.iconAlt}
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-full object-contain"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight text-foreground">
                {activeTokenInfo.symbol}
              </p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                {activeTokenInfo.name}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {activeTokenInfo.summary}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={copyContractAddress}
            className="mt-3 flex w-full items-center justify-between gap-2 border-t border-border/35 pt-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            aria-label={`Copy ${activeTokenInfo.symbol} contract address`}
            title={`Copy ${activeTokenInfo.symbol} contract address`}
          >
            <span className="min-w-0 truncate font-mono">
              {activeTokenInfo.contractAddress}
            </span>
            <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </button>
        </div>

        {isMiniApp && (
          <Button
            className="w-full"
            onClick={async () => {
              try {
                await sdk.actions.viewToken({ token: `eip155:8453/erc20:${activeTokenInfo.contractAddress}` });
              } catch {
                toast.error('View Token is only available in supported Farcaster clients.');
              }
            }}
            aria-label={`View ${activeTokenInfo.symbol} token on Base`}
          >
            View {activeTokenInfo.symbol}
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-3">
          {sections.map((section, index) => (
            <div
              key={`${activeToken}-${index}`}
              className="flex items-start gap-3 border-t border-border/35 pt-3 first:border-t-0 first:pt-0"
            >
              <Image
                src={section.iconSrc}
                alt={section.iconAlt}
                width={20}
                height={20}
                className="mt-0.5 h-5 w-5 shrink-0 rounded-sm"
              />
              <div className="min-w-0">
                <h4 className="font-semibold leading-snug">{section.title}</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {section.body}
                </p>
                {section.bullets && (
                  <ul className="mt-2 space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground [list-style:disc]">
                    {section.bullets.map((bullet, bulletIndex) => (
                      <li key={bulletIndex}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>

        {activeTokenInfo.note && (
          <div className="border-t border-border/30 pt-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="mb-2 block font-semibold text-foreground">Note:</span>
              {activeTokenInfo.note}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '...';
  const abs = Math.abs(value);
  if (abs > 0 && abs < 1) {
    return new Intl.NumberFormat('en-US', {
      currency: 'USD',
      maximumFractionDigits: 6,
      minimumFractionDigits: 2,
      style: 'currency',
    }).format(value);
  }

  return new Intl.NumberFormat('en-US', {
    compactDisplay: 'short',
    currency: 'USD',
    maximumFractionDigits: abs >= 1000 ? 1 : 2,
    notation: abs >= 10_000 ? 'compact' : 'standard',
    style: 'currency',
  }).format(value);
}

function formatSeedPriceUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '...';
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: value > 0 && Math.abs(value) < 0.01 ? 5 : 4,
    minimumFractionDigits: value > 0 && Math.abs(value) < 0.01 ? 4 : 2,
    style: 'currency',
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '...';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(Math.abs(value) < 1 ? 2 : 1)}%`;
}

function totalTxns(txns: SeedMarketData['txns'][MarketWindow]): number | null {
  if (!txns) return null;
  return (txns.buys ?? 0) + (txns.sells ?? 0);
}

function DexScreenerBrandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 48 48" aria-hidden="true">
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M12.951 10.765c-4.384 7.074.244 15.697-5.366 25.358l4.657-3.436 3.196 5.208 3.23-3.12L24 43.492l5.332-8.715 3.23 3.12 3.196-5.21 4.657 3.437c-5.61-9.66-.982-18.284-5.366-25.358" />
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="m19.89 23.502-3.424 2.037c4.622.794 6.467 7.03 7.534 12.389 1.067-5.36 2.912-11.595 7.534-12.389l-3.423-2.037c.436-3.3-1.91-6.552-4.111-6.552s-4.547 3.253-4.11 6.552" />
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M26.522 17.69c4.604-2.337 9.597-6.354 11.318-12.439-1.07 1.375-2.66 2.767-4.518 3.283a15 15 0 0 0-.685-.66C29.536 5.057 27.25 4.508 24 4.508s-5.536.55-8.637 3.364q-.36.329-.685.661c-1.858-.516-3.449-1.908-4.518-3.283 1.72 6.085 6.714 10.102 11.318 12.44" />
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M16.049 14.43c-1.098.875-1.352 2.643-.558 3.899.928 1.47 3.689 2.26 5.117.995m11.343-4.894c1.098.875 1.352 2.643.558 3.899-.928 1.47-3.689 2.26-5.117.995" />
    </svg>
  );
}

function TradingViewBrandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.8654 8.2789c0 1.3541-1.0978 2.4519-2.452 2.4519-1.354 0-2.4519-1.0978-2.4519-2.452 0-1.354 1.0978-2.4518 2.452-2.4518 1.3541 0 2.4519 1.0977 2.4519 2.4519zM9.75 6H0v4.9038h4.8462v7.2692H9.75Zm8.5962 0H24l-5.1058 12.173h-5.6538z" />
    </svg>
  );
}

function ChartAttribution() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-border/45 pt-2 text-[10px] font-medium text-muted-foreground">
      <span>Powered by</span>
      <a
        href="https://dexscreener.com/base/0xaa6a81a7df94dab346e2d677225cad47220540c5"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => handleExternalAnchorClick(event, "https://dexscreener.com/base/0xaa6a81a7df94dab346e2d677225cad47220540c5")}
        className="inline-flex items-center gap-1.5 transition-colors hover:text-primary"
      >
        <DexScreenerBrandIcon className="h-4 w-4" />
        <span>DEX Screener</span>
      </a>
      <a
        href="https://www.tradingview.com/symbols/SEEDWETH_AA6A81.USD/?exchange=BASESWAP"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => handleExternalAnchorClick(event, "https://www.tradingview.com/symbols/SEEDWETH_AA6A81.USD/?exchange=BASESWAP")}
        className="inline-flex items-center gap-1.5 transition-colors hover:text-primary"
      >
        <TradingViewBrandIcon className="h-4 w-4" />
        <span>TradingView</span>
      </a>
    </div>
  );
}

function SeedMarketStats({ marketData }: { marketData: SeedMarketData | null }) {
  const pairUrl =
    marketData?.pairUrl ?? 'https://dexscreener.com/base/0xaa6a81a7df94dab346e2d677225cad47220540c5';
  const h24Txns = totalTxns(marketData?.txns.h24);
  const h24Change = marketData?.priceChange.h24;
  const h24ChangeTone =
    typeof h24Change === 'number' && h24Change > 0
      ? 'text-[hsl(var(--success-strong))]'
      : typeof h24Change === 'number' && h24Change < 0
        ? 'text-destructive'
        : 'text-muted-foreground';
  const marketRows = [
    { label: '24h volume', value: formatUsd(marketData?.volume.h24), detail: `${h24Txns === null ? '...' : h24Txns.toLocaleString()} txns` },
    { label: 'Liquidity', value: formatUsd(marketData?.liquidityUsd), detail: 'Pool depth' },
    { label: 'Market cap', value: formatUsd(marketData?.marketCap ?? marketData?.fdv), detail: marketData?.marketCap != null ? 'Circulating' : 'FDV' },
  ];

  return (
    <div className="rounded-[var(--radius-panel)] border border-border/60 bg-card/95 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold leading-tight text-foreground">SEED market pulse</h4>
          <p className="mt-0.5 text-[11px] font-medium leading-tight text-muted-foreground">Live BaseSwap quote data</p>
        </div>
        <a
          href={pairUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => handleExternalAnchorClick(event, pairUrl)}
          className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-[hsl(var(--nav-hover-bg))]"
        >
          View pair
        </a>
      </div>

      <div className="chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] shadow-[var(--shadow-hairline)]">
        <div className="flex items-start justify-between gap-3 border-b border-border/45 px-3 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
              SEED / USD
            </p>
            <p className="mt-1 break-words text-2xl font-bold leading-none tabular-nums text-foreground">
              {formatSeedPriceUsd(marketData?.priceUsd ? Number(marketData.priceUsd) : null)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
              24h
            </p>
            <p className={`mt-1 text-sm font-bold leading-none tabular-nums ${h24ChangeTone}`}>
              {formatPercent(h24Change)}
            </p>
          </div>
        </div>

        <div className="divide-y divide-[hsl(var(--divider)/0.5)] px-3 py-1">
          {marketRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                  {row.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                  {row.detail}
                </p>
              </div>
              <p className="max-w-[58%] shrink-0 text-right text-sm font-semibold leading-tight tabular-nums text-foreground">
                {row.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {([
          ['1H', marketData?.priceChange.h1, totalTxns(marketData?.txns.h1)],
          ['6H', marketData?.priceChange.h6, totalTxns(marketData?.txns.h6)],
          ['24H', marketData?.priceChange.h24, h24Txns],
        ] as const).map(([label, change, txns]) => (
          <div
            key={label}
            className="chromatic-white-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] px-2 py-1.5 text-center shadow-[var(--shadow-hairline)]"
          >
            <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
            <p className={`mt-0.5 text-xs font-semibold tabular-nums ${
              typeof change === 'number' && change > 0
                ? 'text-[hsl(var(--success-strong))]'
                : typeof change === 'number' && change < 0
                  ? 'text-destructive'
                  : 'text-foreground'
            }`}>
              {formatPercent(change)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {txns === null ? '...' : `${txns} txns`}
            </p>
          </div>
        ))}
      </div>
      {marketData?.stale ? (
        <p className="mt-2 text-xs text-[hsl(var(--warning-strong))]">
          Showing cached market data while DexScreener is unavailable.
        </p>
      ) : null}
    </div>
  );
}

function SeedChartPanel({
  marketData,
  showStats = true,
}: {
  marketData: SeedMarketData | null;
  showStats?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className={showStats
        ? 'h-[360px] min-h-[360px] flex-none overflow-hidden sm:h-[420px] sm:min-h-[420px]'
        : 'min-h-0 flex-1 overflow-hidden'
      }>
        <TradingViewWidget />
      </div>
      {showStats ? <SeedMarketStats marketData={marketData} /> : null}
      <ChartAttribution />
    </div>
  );
}

export default function SwapTab() {
  const { address } = useAccount();
  const fc = useFrameContext();
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const isSwapModuleDisabled = CLIENT_ENV.SWAP_MODULE_DISABLED;
  const swapDisabledMessage = CLIENT_ENV.SWAP_MODULE_DISABLED_MESSAGE;
  const [swapView, setSwapView] = useState<SwapView>('swap');
  const [activeInfoToken, setActiveInfoToken] = useState<InfoToken>('seed');
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('swap');
  const isChartView = swapView === 'chart';
  const isInfoView = swapView === 'info';
  /*
   * Render one layout, not both.
   *
   * The four TabCards below all mounted and CSS hid three of them. At 390px that meant
   * a second PixotchiSwapPanel (with its own wagmi balance observers) plus a
   * TradingView iframe — a third-party embed, ~1.6s to load — that nobody could see.
   * 165 of 212 nodes in this tab had a zero-size box.
   *
   * The min-[54rem] classes on the cards are deliberately kept: for the frame between
   * a resize crossing 54rem and the matchMedia change event landing, they stop both
   * layouts painting at once.
   *
   * Lazy initialiser rather than useState(false): tab modules are dynamic(..., {ssr:false}),
   * so there is no hydration mismatch to avoid, and starting false would mount a whole
   * swap panel on every desktop first paint just to tear it down a frame later.
   */
  const [isDesktopSwapLayout, setIsDesktopSwapLayout] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(min-width: 54rem)').matches),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(min-width: 54rem)');
    setIsDesktopSwapLayout(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => setIsDesktopSwapLayout(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
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

  // Rewards distributed today (2% of 24h volume) plus live pair stats.
  const [seedMarketData, setSeedMarketData] = useState<SeedMarketData | null>(null);
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

  // Fetch SEED market data (24h volume from DexScreener)
  useEffect(() => {
    const fetchRewardsData = async () => {
      try {
        const res = await fetch('/api/seed-volume');
        if (res.ok) {
          const data = await res.json() as SeedMarketData;
          setSeedMarketData(data);
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
    <div className="space-y-4 min-[54rem]:grid min-[54rem]:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] min-[54rem]:items-stretch min-[54rem]:gap-5 min-[54rem]:space-y-0 xl:grid-cols-[minmax(360px,480px)_minmax(520px,1fr)]">
      {!isDesktopSwapLayout && (
      <TabCard
        className={`${isChartView ? 'flex flex-col' : ''} pb-4 min-[54rem]:hidden`}
        padding={isChartView ? 'none' : 'md'}
      >
        <CardHeader className={isChartView ? 'pb-3 px-4 pt-4 flex-shrink-0' : ''}>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>{isChartView ? 'Chart' : isInfoView ? 'Info' : 'Swap'}</CardTitle>
            <ToggleGroup
              ariaLabel="Swap panel view"
              value={swapView}
              onValueChange={(v) => setSwapView(v as SwapView)}
              options={[
                { value: 'swap', label: 'Swap' },
                { value: 'chart', label: 'Chart' },
                { value: 'info', label: 'Info' },
              ]}
              getButtonClassName={(value) =>
                isSwapModuleDisabled && value === 'swap' ? 'opacity-60' : ''
              }
            />
          </div>
        </CardHeader>
        <CardContent className={isChartView ? 'flex flex-col p-4' : 'space-y-4'}>
          {swapView === 'swap' ? (
            isSwapModuleDisabled ? (
              <SwapLockedState message={swapDisabledMessage} />
            ) : (
              <ErrorBoundary variant="inline" showErrorDetails>
                <PixotchiSwapPanel />
              </ErrorBoundary>
            )
          ) : swapView === 'chart' ? (
            <SeedChartPanel marketData={seedMarketData} />
          ) : (
            <TokenInfoPanel
              activeToken={activeInfoToken}
              currentBurnedSupplyLabel={currentBurnedSupplyLabel}
              isMiniApp={isMiniApp}
              rewardsData={seedMarketData}
              setActiveToken={setActiveInfoToken}
            />
          )}
        </CardContent>
      </TabCard>
      )}

      {isDesktopSwapLayout && (
      <>
      <TabCard className="hidden min-[54rem]:flex min-[54rem]:h-full min-[54rem]:flex-col">
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
          <SeedMarketStats marketData={seedMarketData} />
        </CardContent>
      </TabCard>

      <TabCard className="hidden min-[54rem]:flex min-[54rem]:h-full min-[54rem]:min-h-0 min-[54rem]:flex-col" padding="none">
        <CardHeader className="px-4 pt-4 pb-3">
          <CardTitle>Chart</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-4">
          <SeedChartPanel marketData={seedMarketData} showStats={false} />
        </CardContent>
      </TabCard>

      {/* Token Info Section */}
      <TabCard className="hidden min-[54rem]:block min-[54rem]:col-span-2 min-[54rem]:h-fit">
        <CardHeader>
          <CardTitle>Token Info</CardTitle>
        </CardHeader>
        <CardContent>
          <TokenInfoPanel
            activeToken={activeInfoToken}
            currentBurnedSupplyLabel={currentBurnedSupplyLabel}
            isMiniApp={isMiniApp}
            rewardsData={seedMarketData}
            setActiveToken={setActiveInfoToken}
          />
        </CardContent>
      </TabCard>
      </>
      )}
    </div>
  );
}
