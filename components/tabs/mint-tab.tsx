'use client';

import { usePrimaryName } from '@/components/hooks/usePrimaryName';
import { MintShareModal } from '@/components/mint-share-modal';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { useIsSolanaWallet,useSolanaWallet,useTwinAddress } from '@/components/solana';
import SolanaBridgeButton from '@/components/transactions/solana-bridge-button';
import ApprovalActionTransaction from '@/components/transactions/approval-action-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import { getPlantMintCall } from '@/components/transactions/mint-transaction';
import SwapLandMintBundle from '@/components/transactions/swap-land-mint-bundle';
import SwapMintBundle from '@/components/transactions/swap-mint-bundle';
import {
DropdownMenu,
DropdownMenuContent,
DropdownMenuItem,
DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProgressBar } from '@/components/ui/progress-bar';
import { InlineBalanceNotice } from '@/components/ui/premium';
import { VerifyClaim } from '@/components/verify-claim';
import { useFarmView } from '@/lib/farm-view-context';
import { useBalances } from '@/lib/balance-context';
import { PLANT_STRAINS_BY_ID } from '@/lib/constants';
import { checkLandMintApproval,checkTokenApproval,getEthQuoteForSeedAmount,getFormattedTokenBalance,getLandBalance,getLandMintPrice,getLandMintStatus,getLandSupply,getStrainInfo,getTokenBalanceForToken,getTokenSymbol,JESSE_TOKEN_ADDRESS,LAND_CONTRACT_ADDRESS,PIXOTCHI_NFT_ADDRESS,PIXOTCHI_TOKEN_ADDRESS } from '@/lib/contracts';
import { CLIENT_ENV } from '@/lib/env-config';
import { getMiniAppQuickAuthHeaders } from '@/lib/farcaster-miniapp-auth-client';
import { useEthModeSafe } from '@/lib/eth-mode-context';
import { useFrameContext } from '@/lib/frame-context';
import { usePaymaster } from '@/lib/paymaster-context';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { Strain } from '@/lib/types';
import { formatNumber,formatTokenAmount,getFriendlyErrorMessage, formatAddress } from "@/lib/utils";
import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAccount,useBalance } from 'wagmi';
import { getLandMintCall } from '../transactions/land-mint-transaction';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle, TabCard } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
// Removed BalanceCard from tabs; status bar now shows balances globally

const SOLANA_MINT_DEBUG = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_SOLANA_MINT_DEBUG === 'true';

const PLANT_MINT_DESCRIPTION = 'Choose a strain and mint your Plant onchain. Each strain has its own starting lifetime, and PTS define your share of ETH rewards.';
const LAND_MINT_DESCRIPTION = 'Mint a Land to produce PTS and TOD passively by staking SEED instead of spending it, helping grow your Plant and ETH rewards over the long term.';
const SUCCESS_TRANSACTION_BUTTON_CLASS = 'w-full bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground hover:brightness-[1.03] shadow-[var(--shadow-control)]';
const SOLANA_SPECIAL_BUTTON_CLASS = 'w-full bg-[image:var(--gradient-solana)] text-white hover:brightness-105 disabled:opacity-55';
const MINT_DETAIL_TILE_CLASS = 'chromatic-white-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-2 shadow-[var(--shadow-hairline)]';

type PaymentTokenSnapshot = {
  allowance: bigint;
  balance: bigint;
  identity: string | null;
  symbol: string;
};

// Placeholder for plant images, assuming you might have them
const PLANT_STATIC_IMAGES = [
  '/icons/plant1.svg',
  '/icons/plant2.svg',
  '/icons/plant3WithFrame.svg',
  '/icons/plant4WithFrame.svg',
  '/icons/plant5.png'
];

// Lossless animated WebP (re-encoded from the old GIFs: 1.1MB -> 426KB total).
const PLANT_GROWTH_IMAGES = [
  '/icons/plantGrowth.webp',
  '/icons/plantGrowth2.webp',
  '/icons/plantGrowth4.webp',
  '/icons/plantGrowth5.webp',
  '/icons/plantGrowth6.webp'
];

const getPlantGrowthImage = (strainId: number | undefined) => {
  if (!strainId) return PLANT_GROWTH_IMAGES[0];
  return PLANT_GROWTH_IMAGES[strainId - 1] || PLANT_STATIC_IMAGES[strainId - 1] || PLANT_GROWTH_IMAGES[0];
};

/**
 * Thumbnail variant for the 24-28px list rows.
 *
 * The animated GIFs total 1.1 MB (95-393 KB each) and must be served with
 * `unoptimized` — Next refuses to resize animated images, so a 24px dropdown row
 * was downloading the full-resolution animation. The static per-strain art already
 * exists and is 7-19 KB for strains 1-4.
 *
 * Strain 5's static is a 218 KB PNG, so it keeps the GIF: swapping would not save
 * anything meaningful and would lose the animation.
 */
const getPlantThumbImage = (strainId: number | undefined) => {
  if (!strainId) return PLANT_STATIC_IMAGES[0];
  const staticImage = PLANT_STATIC_IMAGES[strainId - 1];
  if (staticImage && staticImage.endsWith('.svg')) return staticImage;
  return getPlantGrowthImage(strainId);
};

export default function MintTab() {
  const { address: evmAddress, chainId } = useAccount();
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const { seedBalance: seedBalanceRaw } = useBalances();
  const frameContext = useFrameContext();
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('mint');
  // See the 30s freshness guard on the visibility refetch effect below.
  const lastVisibleFetchRef = useRef(0);

  // ETH Mode for smart wallet users
  const { isEthMode } = useEthModeSafe();
  const [ethQuote, setEthQuote] = useState<{ ethAmount: bigint; ethAmountWithBuffer: bigint } | null>(null);
  const [ethQuoteLoading, setEthQuoteLoading] = useState(false);
  const [landEthQuote, setLandEthQuote] = useState<{ ethAmount: bigint; ethAmountWithBuffer: bigint } | null>(null);
  const [landEthQuoteLoading, setLandEthQuoteLoading] = useState(false);

  // ETH balance for ETH mode insufficent balance check
  const { data: ethBalanceData } = useBalance({
    address: evmAddress,
  });
  const ethBalance = ethBalanceData?.value ?? BigInt(0);

  // Solana wallet support
  const isSolana = useIsSolanaWallet();
  const twinAddress = useTwinAddress();

  // Use Twin address for Solana users, EVM address otherwise
  const address = evmAddress || (isSolana && twinAddress ? twinAddress as `0x${string}` : undefined);
  const mintFetchKey = address
    ? `${address.toLowerCase()}:${chainId ?? 'no-chain'}:${isSolana ? 'solana' : 'evm'}`
    : null;
  const landMintIdentity = address && chainId && !isSolana ? mintFetchKey : null;
  const isConnected = !!evmAddress || isSolana;
  const farcasterUser =
    typeof frameContext?.context === 'object'
      ? (frameContext.context as UntypedValue)?.user
      : undefined;

  // Resolve basename/ENS for share functionality
  const { name: primaryName } = usePrimaryName(address ?? undefined);

  const [, setTokenBalance] = useState<number>(0);
  const [strains, setStrains] = useState<Strain[]>([]);
  const [selectedStrain, setSelectedStrain] = useState<Strain | null>(null);
  const [paymentTokenSnapshot, setPaymentTokenSnapshot] = useState<PaymentTokenSnapshot>(() => ({
    allowance: BigInt(0),
    balance: BigInt(0),
    identity: null,
    symbol: 'SEED',
  }));
  const [paymentTokenRefreshGeneration, setPaymentTokenRefreshGeneration] = useState(0);
  const paymentTokenRequestGenerationRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const selectedPaymentToken = selectedStrain?.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
  const paymentTokenIdentity = address && selectedStrain
    ? `${address.toLowerCase()}:${selectedStrain.id}:${selectedPaymentToken.toLowerCase()}`
    : null;
  const paymentTokenSnapshotCurrent = paymentTokenSnapshot.identity === paymentTokenIdentity;
  const paymentTokenAllowance = paymentTokenSnapshotCurrent
    ? paymentTokenSnapshot.allowance
    : BigInt(0);
  const paymentTokenBalance = paymentTokenSnapshotCurrent
    ? paymentTokenSnapshot.balance
    : BigInt(0);
  const paymentTokenSymbol = paymentTokenSnapshotCurrent
    ? paymentTokenSnapshot.symbol
    : selectedPaymentToken.toLowerCase() === JESSE_TOKEN_ADDRESS.toLowerCase()
      ? '$JESSE'
      : 'SEED';
  // Read-only here: SharedFarmMintMobileToggle in app/(game)/page.tsx is the sole
  // writer now that the unreachable duplicate toggle in this file is gone. Do not
  // re-declare a local useWebQueryState — in the Mini App the two cannot sync.
  const { mintType } = useFarmView();
  const [, setLandBalance] = useState(0);
  const [landSupplyState, setLandSupply] = useState<{ totalSupply: number; maxSupply: number; } | null>(null);
  const [landMintStatusState, setLandMintStatus] = useState<{ canMint: boolean; reason: string; } | null>(null);
  const [landMintAllowanceState, setLandMintAllowance] = useState<bigint>(BigInt(0));
  const [landMintPriceState, setLandMintPrice] = useState<bigint>(BigInt(0));
  const [landMintDataIdentity, setLandMintDataIdentity] = useState<string | null>(null);
  const landMintDataCurrent = landMintIdentity !== null && landMintDataIdentity === landMintIdentity;
  const landSupply = landMintDataCurrent ? landSupplyState : null;
  const landMintStatus = landMintDataCurrent ? landMintStatusState : null;
  const landMintAllowance = landMintDataCurrent ? landMintAllowanceState : BigInt(0);
  const landMintPrice = landMintDataCurrent ? landMintPriceState : BigInt(0);
  const mintFetchGenerationRef = useRef(0);
  const currentMintFetchKeyRef = useRef<string | null>(mintFetchKey);
  const plantMintDataLoadedKeyRef = useRef<string | null>(null);
  const landMintDataLoadedKeyRef = useRef<string | null>(null);

  const [forcedFetchCount, setForcedFetchCount] = useState(0);
  const [shareData, setShareData] = useState<{
    address: string;
    basename?: string;
    strainName: string;
    strainId: number;
    mintedAt: string;
    txHash?: string;
  } | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);

  const incrementForcedFetch = () => {
    setForcedFetchCount(prev => prev + 1);
  };

  const openMintShareModal = useCallback((strainId: number, strainName: string, txHash?: string) => {
    if (!address) return;

    setShareData({
      address,
      basename: primaryName || undefined,
      strainName,
      strainId,
      mintedAt: new Date().toISOString(),
      txHash,
    });
    setShowShareModal(true);
  }, [address, primaryName]);

  const notifyMintSuccess = useCallback(async (strainName: string) => {
    if (CLIENT_ENV.NOTIFICATION_PROVIDER !== 'neynar') return;

    const fid = Number(farcasterUser?.fid);
    if (!Number.isSafeInteger(fid) || fid <= 0) return;

    try {
      const authHeaders = await getMiniAppQuickAuthHeaders({ expectedAddress: evmAddress ?? address });
      const response = await fetch('/api/notifications/mint-success', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ fid, strainName }),
      });

      if (!response.ok && process.env.NODE_ENV !== 'production') {
        const data = await response.json().catch(() => ({}));
        console.warn('[MintTab] Mint notification skipped:', data);
      }
    } catch (error) {
      console.warn('[MintTab] Mint notification failed:', error);
    }
  }, [address, evmAddress, farcasterUser?.fid]);

  // Helper function to get token logo path
  const getTokenLogo = (tokenAddress: `0x${string}` | undefined): string => {
    if (!tokenAddress) return '/PixotchiKit/COIN.svg';
    if (tokenAddress.toLowerCase() === JESSE_TOKEN_ADDRESS.toLowerCase()) {
      return '/icons/jessetoken.png';
    }
    return '/PixotchiKit/COIN.svg'; // Default to SEED logo
  };

  // Helper function to format token symbol (add $ prefix for JESSE)
  const formatTokenSymbol = (symbol: string, tokenAddress: `0x${string}` | undefined): string => {
    if (!tokenAddress) return symbol;
    if (tokenAddress.toLowerCase() === JESSE_TOKEN_ADDRESS.toLowerCase()) {
      return '$JESSE';
    }
    return symbol;
  };

  // Helper: check if strain uses SEED as payment token (ETH mode only works for SEED)
  const isSeedPaymentStrain = (strain: Strain | null): boolean => {
    if (!strain) return true; // Default assumption
    const paymentToken = strain.paymentToken;
    // If no payment token specified, it's SEED. If it's SEED address, it's SEED.
    if (!paymentToken) return true;
    return paymentToken.toLowerCase() === PIXOTCHI_TOKEN_ADDRESS.toLowerCase();
  };

  useLayoutEffect(() => {
    if (currentMintFetchKeyRef.current === mintFetchKey) return;
    currentMintFetchKeyRef.current = mintFetchKey;
    mintFetchGenerationRef.current += 1;
    setTokenBalance(0);
    setLandBalance(0);
    setLandSupply(null);
    setLandMintStatus(null);
    setLandMintAllowance(BigInt(0));
    setLandMintPrice(BigInt(0));
    setLandMintDataIdentity(null);
    setLoading(Boolean(address));
  }, [address, mintFetchKey]);

  const fetchData = useCallback(async () => {
    if (!address || !mintFetchKey) return;

    const fetchKey = mintFetchKey;
    const requestGeneration = ++mintFetchGenerationRef.current;
    const isCurrentRequest = () =>
      currentMintFetchKeyRef.current === fetchKey
      && mintFetchGenerationRef.current === requestGeneration;

    try {
      // Both EVM controllers remain mounted at every viewport width. Load both
      // datasets under one stable key so resizing cannot re-enter the full-page
      // loading branch and unmount an in-flight transaction.
      const shouldFetchPlantData = true;
      const shouldFetchLandData = !isSolana && Boolean(chainId);

      // Only show full page loader on the first fetch for the relevant wallet/network/layout.
      if (
        (shouldFetchPlantData && plantMintDataLoadedKeyRef.current !== fetchKey) ||
        (shouldFetchLandData && landMintDataLoadedKeyRef.current !== fetchKey)
      ) {
        if (isCurrentRequest()) setLoading(true);
      }

      if (shouldFetchPlantData) {
        const [balance, strainsData] = await Promise.allSettled([
          getFormattedTokenBalance(address),
          getStrainInfo(),
        ]);

        if (!isCurrentRequest()) return;
        if (balance.status === 'fulfilled') setTokenBalance(balance.value);
        if (strainsData.status === 'fulfilled') {
          const availableStrains = strainsData.value.filter(s => s.maxSupply - s.totalMinted > 0);
          setStrains(strainsData.value);
          // Initialize once without overwriting a strain the user already picked.
          if (availableStrains.length > 0) {
            setSelectedStrain(prev => prev ?? availableStrains[0]);
          }
        }
        plantMintDataLoadedKeyRef.current = fetchKey;
      }

      if (shouldFetchLandData) {
        const [lands, supply, status, landAllowance, price] = await Promise.all([
          getLandBalance(address),
          getLandSupply(),
          getLandMintStatus(address),
          checkLandMintApproval(address),
          getLandMintPrice()
        ]);
        if (!isCurrentRequest()) return;
        setLandBalance(lands);
        setLandSupply(supply);
        setLandMintStatus(status);
        setLandMintAllowance(landAllowance);
        setLandMintPrice(price);
        setLandMintDataIdentity(fetchKey);
        landMintDataLoadedKeyRef.current = fetchKey;
      }

    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error('Unexpected error in fetchData:', error);
      toast.error(getFriendlyErrorMessage(error));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [address, chainId, isSolana, mintFetchKey]);

  // Fetch payment token info when selected strain changes
  useEffect(() => {
    const requestGeneration = ++paymentTokenRequestGenerationRef.current;
    // Identity mismatch already gates the current render; clearing the stored
    // snapshot also keeps subsequent renders fail-closed while reads settle.
    setPaymentTokenSnapshot({
      allowance: BigInt(0),
      balance: BigInt(0),
      identity: null,
      symbol: selectedPaymentToken.toLowerCase() === JESSE_TOKEN_ADDRESS.toLowerCase()
        ? '$JESSE'
        : 'SEED',
    });
    if (!address || !paymentTokenIdentity) return;

    const fetchPaymentTokenInfo = async () => {
      const [symbol, rawBalance, allowance] = await Promise.allSettled([
        getTokenSymbol(selectedPaymentToken),
        getTokenBalanceForToken(address, selectedPaymentToken),
        checkTokenApproval(address, selectedPaymentToken),
      ]);
      if (paymentTokenRequestGenerationRef.current !== requestGeneration) return;

      if (rawBalance.status === 'rejected' || allowance.status === 'rejected') {
        console.error('Error fetching payment token balance or allowance:', {
          allowance: allowance.status === 'rejected' ? allowance.reason : undefined,
          balance: rawBalance.status === 'rejected' ? rawBalance.reason : undefined,
        });
      }

      setPaymentTokenSnapshot({
        allowance: allowance.status === 'fulfilled' ? allowance.value : BigInt(0),
        balance: rawBalance.status === 'fulfilled' ? rawBalance.value : BigInt(0),
        identity: paymentTokenIdentity,
        symbol: symbol.status === 'fulfilled'
          ? formatTokenSymbol(symbol.value, selectedPaymentToken)
          : selectedPaymentToken.toLowerCase() === JESSE_TOKEN_ADDRESS.toLowerCase()
            ? '$JESSE'
            : 'SEED',
      });
    };

    void fetchPaymentTokenInfo();
    return () => {
      if (paymentTokenRequestGenerationRef.current === requestGeneration) {
        paymentTokenRequestGenerationRef.current += 1;
      }
    };
  }, [address, paymentTokenIdentity, paymentTokenRefreshGeneration, selectedPaymentToken]);

  const refreshPaymentTokenSnapshot = useCallback(() => {
    setPaymentTokenRefreshGeneration((generation) => generation + 1);
  }, []);

  // Fetch ETH quote when strain changes and ETH mode is active
  useEffect(() => {
    // Only fetch ETH quotes for smart wallet users with ETH mode enabled, on plant tab
    // AND only for strains that use SEED as payment token (ETH mode doesn't support JESSE, etc.)
    if (!isSmartWallet || !isEthMode || !selectedStrain || isSolana || !isSeedPaymentStrain(selectedStrain)) {
      setEthQuote(null);
      return;
    }

    let cancelled = false;

    const fetchEthQuote = async () => {
      setEthQuoteLoading(true);
      try {
        // Get mint price in SEED (payment price or default mint price)
        const seedPrice = selectedStrain.paymentPrice ?? selectedStrain.mintPriceRaw;
        if (seedPrice <= BigInt(0)) {
          setEthQuote(null);
          return;
        }

        const quote = await getEthQuoteForSeedAmount(seedPrice);

        if (!cancelled) {
          if (quote.error || quote.ethAmountWithBuffer <= BigInt(0)) {
            setEthQuote(null);
          } else {
            setEthQuote({
              ethAmount: quote.ethAmount,
              ethAmountWithBuffer: quote.ethAmountWithBuffer,
            });
          }
        }
      } catch (err) {
        console.error('[MintTab] ETH quote fetch failed:', err);
        if (!cancelled) {
          setEthQuote(null);
        }
      } finally {
        if (!cancelled) {
          setEthQuoteLoading(false);
        }
      }
    };

    // Debounce the quote fetch
    const timeoutId = setTimeout(fetchEthQuote, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [isSmartWallet, isEthMode, selectedStrain, isSolana]);

  // Fetch ETH quote for land minting when on land tab + ETH mode active
  useEffect(() => {
    // Only fetch ETH quotes for smart wallet users with ETH mode enabled, on land tab
    if (!isSmartWallet || !isEthMode || isSolana || landMintPrice <= BigInt(0)) {
      setLandEthQuote(null);
      return;
    }

    let cancelled = false;

    const fetchLandEthQuote = async () => {
      setLandEthQuoteLoading(true);
      try {
        const quote = await getEthQuoteForSeedAmount(landMintPrice);

        if (!cancelled) {
          if (quote.error || quote.ethAmountWithBuffer <= BigInt(0)) {
            setLandEthQuote(null);
          } else {
            setLandEthQuote({
              ethAmount: quote.ethAmount,
              ethAmountWithBuffer: quote.ethAmountWithBuffer,
            });
          }
        }
      } catch (err) {
        console.error('[MintTab] Land ETH quote fetch failed:', err);
        if (!cancelled) {
          setLandEthQuote(null);
        }
      } finally {
        if (!cancelled) {
          setLandEthQuoteLoading(false);
        }
      }
    };

    // Debounce the quote fetch
    const timeoutId = setTimeout(fetchLandEthQuote, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [isSmartWallet, isEthMode, isSolana, landMintPrice]);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }

    fetchData();
  }, [address, forcedFetchCount, fetchData]);

  // Refresh when tab becomes visible
  useEffect(() => {
    if (isVisible && Date.now() - lastVisibleFetchRef.current > 30_000) {
      lastVisibleFetchRef.current = Date.now();
      fetchData();
    }
  }, [isVisible, fetchData]);

  // Solana bridge minting. Submission, Solana confirmation, relay polling,
  // Base execution, and one-time setup are owned by the shared bridge button.
  const solanaWalletHook = useSolanaWallet();
  const needsSetup = isSolana && !solanaWalletHook.isTwinSetup;
  const [solQuote, setSolQuote] = useState<{ wsolAmount: bigint } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [solanaActionPending, setSolanaActionPending] = useState(false);

  const handleSolanaQuote = useCallback((
    quote: { wsolAmount: bigint; error?: string } | null,
  ) => {
    if (!quote) {
      setSolQuote(null);
      setQuoteError(null);
      return;
    }
    if (quote.error || quote.wsolAmount <= BigInt(0)) {
      setSolQuote(null);
      setQuoteError(quote.error || 'Quote returned an invalid SOL amount');
      return;
    }
    setSolQuote({ wsolAmount: quote.wsolAmount });
    setQuoteError(null);
  }, []);

  const renderPlantMinting = () => {
    // Solana uses the same lifecycle controller as every other bridge action.
    if (isSolana) {
      return (
        <>
          <TabCard>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <Image
                  src={getPlantThumbImage(selectedStrain?.id)}
                  alt={selectedStrain?.name || 'Selected plant'}
                  width={72}
                  height={72}
                  className="h-16 w-16 shrink-0 object-contain"
                  unoptimized
                />
                <div className="min-w-0">
                  <CardTitle>Mint a Plant</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{PLANT_MINT_DESCRIPTION}</p>
                </div>
              </div>
              <p className="text-xs text-violet-700 dark:text-violet-200">Connected via Solana Bridge</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium">Choose a strain</label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    disabled={solanaActionPending}
                  >
                    {selectedStrain ? (
                      <div className="flex items-center space-x-2">
                        <Image src={getPlantThumbImage(selectedStrain.id)} alt={selectedStrain.name} width={24} height={24} unoptimized />
                        <span>{selectedStrain.name}</span>
                      </div>
                    ) : (
                      'Select a Strain'
                    )}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                  {strains.map(strain => {
                    const isSoldOut = strain.maxSupply - strain.totalMinted <= 0;
                    const isBaseOnly = ['FLORA', 'TYJ'].includes(strain.name?.toUpperCase?.() || '');
                    return (
                      <DropdownMenuItem
                        key={strain.id}
                        onSelect={() => (!isSoldOut && !isBaseOnly && !solanaActionPending) && setSelectedStrain(strain)}
                        disabled={isSoldOut || isBaseOnly || solanaActionPending}
                        className={isSoldOut || isBaseOnly ? 'text-muted-foreground' : ''}
                      >
                        <div className="flex w-full items-center justify-between">
                          <div className={`flex items-center space-x-2 ${isSoldOut || isBaseOnly ? 'line-through' : ''}`}>
                            <Image src={getPlantThumbImage(strain.id)} alt={strain.name} width={24} height={24} unoptimized />
                            <span>{strain.name}</span>
                          </div>
                          {isSoldOut && <Badge variant="danger">Sold out</Badge>}
                          {isBaseOnly && !isSoldOut && <Badge variant="chain">Base</Badge>}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              {selectedStrain && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className={MINT_DETAIL_TILE_CLASS}>
                    <div className="text-muted-foreground">Price</div>
                    <div className="mt-1 flex items-center gap-1 text-sm font-semibold">
                      <Image
                        src={getTokenLogo(selectedStrain.paymentToken)}
                        alt={paymentTokenSymbol}
                        width={16}
                        height={16}
                      />
                      <span>
                        {selectedStrain.paymentPrice
                          ? formatTokenAmount(selectedStrain.paymentPrice)
                          : formatNumber(selectedStrain.mintPrice)} {paymentTokenSymbol}
                      </span>
                    </div>
                  </div>
                  <div className={MINT_DETAIL_TILE_CLASS}>
                    <div className="text-muted-foreground">Available</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums">
                      {formatNumber(selectedStrain.maxSupply - selectedStrain.totalMinted)} / {formatNumber(selectedStrain.maxSupply)}
                    </div>
                  </div>
                  <div className={`${MINT_DETAIL_TILE_CLASS} col-span-2`}>
                    <div className="text-muted-foreground">Estimated SOL cost</div>
                    {solQuote ? (
                      <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-violet-700 dark:text-violet-200">
                        <Image src="/icons/solana.svg" alt="SOL" width={16} height={16} />
                        <span>~{(Number(solQuote.wsolAmount) / 1e9).toFixed(4)} SOL</span>
                      </div>
                    ) : quoteError ? (
                      <div className="mt-1 text-xs text-destructive">Error: {quoteError}</div>
                    ) : (
                      <div className="mt-1 text-sm text-muted-foreground">Loading...</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </TabCard>

          <Card className="border-violet-500/30 bg-violet-500/5">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-3">
                <Image src="/icons/solana.svg" alt="Solana" width={28} height={28} />
                <div>
                  <h3 className="text-lg font-semibold text-violet-700 dark:text-violet-200">Mint via Solana Bridge</h3>
                  <p className="text-xs text-muted-foreground">
                    Success is reported after the action executes on Base
                  </p>
                </div>
              </div>

              <div className="rounded bg-muted/30 p-2 text-xs text-muted-foreground">
                {SOLANA_MINT_DEBUG && (
                  <>
                    <div>Solana Address: {solanaWalletHook.solanaAddress?.slice(0, 8)}...{solanaWalletHook.solanaAddress?.slice(-4) || 'Not found'}</div>
                    <div>Twin Address: {twinAddress?.slice(0, 8)}...{twinAddress?.slice(-4) || 'Not found'}</div>
                    <div>Twin Deployed: {solanaWalletHook.twinInfo?.isDeployed ? 'Yes' : 'No'}</div>
                  </>
                )}
                <div className="font-medium text-foreground">
                  {solanaActionPending
                    ? 'Bridge action pending'
                    : needsSetup
                      ? 'Bridge setup required'
                      : 'Bridge ready'}
                </div>
                <div>
                  {solanaActionPending
                    ? 'Your submitted action is locked against duplicates. Check its Base status below.'
                    : needsSetup
                      ? 'Set up bridge access once, then submit the mint in a second step.'
                      : 'Solana confirmation and Base execution are verified before mint success.'}
                </div>
                {(needsSetup || SOLANA_MINT_DEBUG) && !solanaActionPending && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    onClick={() => void solanaWalletHook.refresh()}
                    className="mt-1 min-h-11 px-2 text-xs text-[hsl(var(--info))] underline hover:opacity-80"
                  >
                    Refresh status
                  </Button>
                )}
              </div>

              {selectedStrain ? (
                <SolanaBridgeButton
                  actionType="mint"
                  strain={selectedStrain.id}
                  buttonText={solQuote
                    ? `Mint ${selectedStrain.name} for ~${(Number(solQuote.wsolAmount) / 1e9).toFixed(4)} SOL`
                    : undefined}
                  buttonClassName={SOLANA_SPECIAL_BUTTON_CLASS}
                  onQuote={handleSolanaQuote}
                  onPendingChange={setSolanaActionPending}
                  onSuccess={(signature) => {
                    incrementForcedFetch();
                    openMintShareModal(selectedStrain.id, selectedStrain.name, signature);
                    void notifyMintSuccess(selectedStrain.name);
                  }}
                />
              ) : (
                <DisabledTransaction
                  buttonText="Select a Strain First"
                  buttonClassName={SOLANA_SPECIAL_BUTTON_CLASS}
                />
              )}

              <p className="text-center text-xs text-muted-foreground">
                Twin Address: {twinAddress ? formatAddress(twinAddress) : 'Loading...'}
              </p>
            </CardContent>
          </Card>
        </>
      );
    }

    return null;
  };

  const renderDesktopPlantMinting = () => {
    const selectedImage = getPlantGrowthImage(selectedStrain?.id);
    const availableCount = selectedStrain ? selectedStrain.maxSupply - selectedStrain.totalMinted : 0;
    const mintedPercent = selectedStrain?.maxSupply
      ? Math.min(100, Math.max(0, (selectedStrain.totalMinted / selectedStrain.maxSupply) * 100))
      : 0;
    const requiredPayment = selectedStrain
      ? (selectedStrain.paymentPrice ?? selectedStrain.mintPriceRaw)
      : BigInt(0);
    const needsPlantApproval = paymentTokenAllowance < requiredPayment;
    const hasInsufficientPlantBalance = selectedStrain
      ? selectedStrain.paymentPrice !== undefined
        ? paymentTokenBalance < selectedStrain.paymentPrice
        : seedBalanceRaw < selectedStrain.mintPriceRaw
      : false;
    const showEthPlantMint = isSmartWallet && isEthMode && selectedStrain && ethQuote && !ethQuoteLoading && isSeedPaymentStrain(selectedStrain);
    const showEthPlantLoading = isSmartWallet && isEthMode && selectedStrain && ethQuoteLoading;
    const paymentToken = selectedStrain?.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
    const plantBalanceLabel = selectedStrain?.paymentPrice
      ? formatTokenAmount(paymentTokenBalance)
      : formatTokenAmount(seedBalanceRaw);
    const plantRequiredLabel = selectedStrain?.paymentPrice
      ? formatTokenAmount(selectedStrain.paymentPrice)
      : formatNumber(selectedStrain?.mintPrice || 0);

    return (
      <TabCard padding="sm" className="tablet:min-h-[520px]">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Mint a Plant</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{PLANT_MINT_DESCRIPTION}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 tablet:grid-cols-[minmax(220px,0.86fr)_minmax(0,1fr)] xl:grid-cols-[minmax(230px,0.86fr)_minmax(330px,1fr)]">
          <div className="chromatic-white-surface flex min-h-[220px] flex-col justify-between rounded-[var(--radius-panel)] border border-border/60 bg-card/85 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)] tablet:min-h-[372px] tablet:p-4">
            <div className="flex flex-1 items-center justify-center">
              <div className="relative flex h-36 w-36 items-center justify-center rounded-[var(--radius-control)] border border-border/60 bg-card/70 tablet:h-48 tablet:w-48 2xl:h-56 2xl:w-56">
                <Image
                  src={selectedImage}
                  alt={selectedStrain?.name || 'Selected plant'}
                  width={168}
                  height={168}
                  className="object-contain"
                  unoptimized
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold">{selectedStrain?.name || 'Select a strain'}</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedStrain ? 'Selected strain' : 'Pick one of the available strains.'}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/85 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold">Strain</h3>
                <span className="text-xs text-muted-foreground">{strains.length} options</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {strains.map(strain => {
                  const isSoldOut = strain.maxSupply - strain.totalMinted <= 0;
                  const isBaseOnly = isSolana && ['FLORA', 'TYJ'].includes(strain.name?.toUpperCase?.() || '');
                  const isSelected = selectedStrain?.id === strain.id;

                  return (
                    <button
                      key={strain.id}
                      type="button"
                      onClick={() => (!isSoldOut && !isBaseOnly) && setSelectedStrain(strain)}
                      disabled={isSoldOut || isBaseOnly}
                      className={`flex min-h-[58px] items-center justify-between rounded-[var(--radius-panel)] border px-3 py-2 text-left transition-colors ${isSelected
                        ? 'border-primary/35 bg-primary/10 bg-[image:var(--gradient-selection)] shadow-[var(--shadow-hairline)]'
                        : 'border-border/60 bg-card/80 hover:bg-[hsl(var(--nav-hover-bg))]'
                        } ${isSoldOut || isBaseOnly ? 'opacity-50' : ''}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Image src={getPlantThumbImage(strain.id)} alt={strain.name} width={28} height={28} unoptimized />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{strain.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {formatNumber(strain.maxSupply - strain.totalMinted)} left
                          </span>
                        </span>
                      </span>
                      {isSoldOut && <Badge variant="danger" className="min-h-0 py-0.5">Sold</Badge>}
                      {isBaseOnly && !isSoldOut && <Badge variant="chain" className="min-h-0 py-0.5">Base</Badge>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className={MINT_DETAIL_TILE_CLASS}>
                  <div className="text-muted-foreground">Price</div>
                  <div className="mt-1 flex items-center gap-1 text-sm font-semibold">
                      {selectedStrain && isSmartWallet && isEthMode && ethQuote && isSeedPaymentStrain(selectedStrain) ? (
                        <>
                          <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                          {ethQuoteLoading ? '...' : (Number(ethQuote.ethAmountWithBuffer) / 1e18).toFixed(6)} ETH
                        </>
                      ) : selectedStrain && isSmartWallet && isEthMode && ethQuoteLoading && isSeedPaymentStrain(selectedStrain) ? (
                        <>
                          <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                          Loading...
                        </>
                      ) : selectedStrain ? (
                        <>
                          <Image src={getTokenLogo(selectedStrain.paymentToken)} alt={paymentTokenSymbol} width={16} height={16} />
                          {plantRequiredLabel} {paymentTokenSymbol}
                        </>
                      ) : (
                        '-'
                      )}
                  </div>
                </div>
                <div className={MINT_DETAIL_TILE_CLASS}>
                  <div className="text-muted-foreground">Available</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums">
                    {selectedStrain ? `${formatNumber(availableCount)} / ${formatNumber(selectedStrain.maxSupply)}` : '-'}
                  </div>
                </div>
              </div>

              {selectedStrain && (
                <div className="mt-4 space-y-2">
                  <ProgressBar label={`${selectedStrain.name} mint progress`} value={mintedPercent} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatNumber(selectedStrain.totalMinted)} minted</span>
                    <span>{formatNumber(selectedStrain.maxSupply)} max</span>
                  </div>
                </div>
              )}
            </div>

            <div className="chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold">Confirm Mint</h3>
                <SponsoredBadge show={Boolean(isSmartWallet && (showEthPlantMint || needsPlantApproval || isSponsored))} />
              </div>

              {showEthPlantMint && (
                <div className="space-y-2">
                  <SwapMintBundle
                    strain={selectedStrain.id}
                    ethAmount={ethQuote.ethAmountWithBuffer}
                    minSeedOut={selectedStrain.paymentPrice ?? selectedStrain.mintPriceRaw}
                    onSuccess={(tx) => {
                      toast.success('Plant minted successfully with ETH!');
                      incrementForcedFetch();
                      openMintShareModal(selectedStrain.id, selectedStrain.name, tx?.transactionHash);
                    }}
                    onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                    buttonText={ethBalance < ethQuote.ethAmountWithBuffer ? "Insufficient ETH Balance" : "Mint with ETH"}
                    buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                    disabled={ethBalance < ethQuote.ethAmountWithBuffer}
                  />
                  {ethBalance < ethQuote.ethAmountWithBuffer && (
                    <InlineBalanceNotice>
                      Not enough ETH. Balance: {(Number(ethBalance) / 1e18).toFixed(6)} • Required: {(Number(ethQuote.ethAmountWithBuffer) / 1e18).toFixed(6)}
                    </InlineBalanceNotice>
                  )}
                </div>
              )}

              {showEthPlantLoading && (
                <Button disabled className="w-full">Fetching ETH quote...</Button>
              )}

              {!showEthPlantMint && !showEthPlantLoading && selectedStrain && hasInsufficientPlantBalance && (
                <div className="space-y-2">
                  <DisabledTransaction
                    buttonText="Insufficient Balance"
                    buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                  />
                  <InlineBalanceNotice>
                    Not enough {paymentTokenSymbol}. Balance: {plantBalanceLabel} • Required: {plantRequiredLabel}
                  </InlineBalanceNotice>
                </div>
              )}

              {!showEthPlantMint && !showEthPlantLoading && selectedStrain && !hasInsufficientPlantBalance && (
                <div className="space-y-2">
                  <ApprovalActionTransaction
                    intentKey={`mint:plant:${selectedStrain.id}`}
                    actionCalls={[getPlantMintCall(selectedStrain.id)]}
                    approvalSpender={PIXOTCHI_NFT_ADDRESS}
                    approvalTokenAddress={paymentToken}
                    needsApproval={needsPlantApproval}
                    onApprovalSuccess={() => {
                      toast.success('Token approval successful!');
                      refreshPaymentTokenSnapshot();
                      incrementForcedFetch();
                    }}
                    onSuccess={(tx) => {
                      toast.success(needsPlantApproval && isSmartWallet ? 'Approved and minted successfully!' : 'Plant minted successfully!');
                      refreshPaymentTokenSnapshot();
                      incrementForcedFetch();
                      openMintShareModal(selectedStrain.id, selectedStrain.name, tx?.transactionHash);
                      void notifyMintSuccess(selectedStrain.name);
                    }}
                    onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                    batchButtonText="Approve + Mint"
                    approvalButtonText={`Approve ${paymentTokenSymbol}`}
                    actionButtonText="Mint Plant"
                    buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                    resetKey={`plant-${selectedStrain.id}-${paymentToken}`}
                  />
                </div>
              )}

              {!selectedStrain && (
                <DisabledTransaction
                  buttonText="Select a Strain First"
                  buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                />
              )}
            </div>
          </div>
        </CardContent>
      </TabCard>
    );
  };

  const renderDesktopLandMinting = () => {
    const landAvailable = landSupply ? landSupply.maxSupply - landSupply.totalSupply : 0;
    const landMintedPercent = landSupply?.maxSupply
      ? Math.min(100, Math.max(0, (landSupply.totalSupply / landSupply.maxSupply) * 100))
      : 0;
    const needsLandApproval = landMintAllowance < landMintPrice;
    const hasInsufficientLandBalance = seedBalanceRaw < landMintPrice;
    const showEthLandMint = Boolean(isSmartWallet && isEthMode && landEthQuote && !landEthQuoteLoading && landMintStatus?.canMint);
    const showEthLandLoading = Boolean(isSmartWallet && isEthMode && landEthQuoteLoading && landMintStatus?.canMint);

    return (
      <TabCard padding="sm">
        <CardHeader className="pb-3">
          <CardTitle>Mint Land</CardTitle>
          <p className="text-sm text-muted-foreground">{LAND_MINT_DESCRIPTION}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-3">
            <div className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs">
              <div className={`${MINT_DETAIL_TILE_CLASS} flex items-center justify-center`}>
                <Image
                  src="/icons/village-start.png"
                  alt="Land"
                  width={66}
                  height={66}
                  className="object-contain"
                />
              </div>
              <div className={MINT_DETAIL_TILE_CLASS}>
                <div className="text-muted-foreground">Price</div>
                <div className="mt-1 flex items-center gap-1 text-sm font-semibold">
                    {isSmartWallet && isEthMode && landEthQuote ? (
                      <>
                        <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                        {landEthQuoteLoading ? '...' : (Number(landEthQuote.ethAmountWithBuffer) / 1e18).toFixed(6)} ETH
                      </>
                    ) : isSmartWallet && isEthMode && landEthQuoteLoading ? (
                      <>
                        <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                        Loading...
                      </>
                    ) : (
                      <>
                        <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                        {formatTokenAmount(landMintPrice)} SEED
                      </>
                    )}
                </div>
              </div>
              <div className={MINT_DETAIL_TILE_CLASS}>
                <div className="text-muted-foreground">Available</div>
                <div className="mt-1 text-sm font-semibold tabular-nums">
                  {landSupply ? `${formatNumber(landAvailable)} / ${formatNumber(landSupply.maxSupply)}` : '-'}
                </div>
              </div>
            </div>

            {landSupply && (
              <div className="space-y-2">
                <ProgressBar label="Land mint progress" value={landMintedPercent} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatNumber(landSupply.totalSupply)} minted</span>
                  <span>{formatNumber(landSupply.maxSupply)} max</span>
                </div>
              </div>
            )}
          </div>

          <div className="chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Confirm Mint</h3>
              <SponsoredBadge show={Boolean(isSmartWallet && (showEthLandMint || needsLandApproval || isSponsored))} />
            </div>

            {showEthLandMint && landEthQuote && (
              <div className="space-y-2">
                <SwapLandMintBundle
                  ethAmount={landEthQuote.ethAmountWithBuffer}
                  minSeedOut={landMintPrice}
                  onSuccess={() => {
                    toast.success('Land minted successfully with ETH!');
                    incrementForcedFetch();
                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText={ethBalance < landEthQuote.ethAmountWithBuffer ? "Insufficient ETH Balance" : "Mint Land"}
                  buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                  disabled={ethBalance < landEthQuote.ethAmountWithBuffer}
                />
                {ethBalance < landEthQuote.ethAmountWithBuffer && (
                  <InlineBalanceNotice>
                    Not enough ETH. Balance: {(Number(ethBalance) / 1e18).toFixed(6)} • Required: {(Number(landEthQuote.ethAmountWithBuffer) / 1e18).toFixed(6)}
                  </InlineBalanceNotice>
                )}
              </div>
            )}

            {showEthLandLoading && (
              <Button disabled className="w-full">Fetching ETH quote...</Button>
            )}

            {!showEthLandMint && !showEthLandLoading && (
              <div className="space-y-3">
                {landMintStatus && !landMintStatus.canMint ? (
                  <DisabledTransaction
                    buttonText={landMintStatus.reason}
                    buttonClassName="w-full"
                  />
                ) : hasInsufficientLandBalance ? (
                  <>
                    <DisabledTransaction
                      buttonText="Insufficient Balance"
                      buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                    />
                    <InlineBalanceNotice>
                      Not enough SEED. Balance: {formatTokenAmount(seedBalanceRaw)} • Required: {formatTokenAmount(landMintPrice)}
                    </InlineBalanceNotice>
                  </>
                ) : (
                  <ApprovalActionTransaction
                    intentKey="mint:land"
                    actionCalls={[getLandMintCall()]}
                    approvalSpender={LAND_CONTRACT_ADDRESS}
                    needsApproval={needsLandApproval}
                    onApprovalSuccess={() => {
                      toast.success('Token approval successful!');
                      incrementForcedFetch();
                    }}
                    onSuccess={() => {
                      toast.success(needsLandApproval && isSmartWallet ? 'Approved and minted land successfully!' : 'Land minted successfully!');
                      incrementForcedFetch();
                    }}
                    onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                    batchButtonText="Approve + Mint Land"
                    approvalButtonText="Approve SEED for Land"
                    actionButtonText="Mint Land"
                    buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                    disabled={!landMintStatus?.canMint}
                    resetKey={`land-${landMintPrice.toString()}`}
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </TabCard>
    );
  };


  const renderContent = () => {
    if (!isConnected) {
      return (
        <TabCard className="text-center p-6">
          <h3 className="text-lg font-semibold mb-2">Connect Wallet</h3>
          <p className="text-muted-foreground mb-4">Please connect your wallet to mint plants.</p>
        </TabCard>
      );
    }

    if (loading) {
      // Shaped like the resolved mint card (~520px), not a 200px centered
      // loader — the mismatch shifted the whole page on every load.
      return (
        <TabCard padding="sm" className="tablet:min-h-[520px]" aria-busy="true" aria-live="polite">
          <CardContent className="space-y-4 p-4">
            <span className="sr-only">Loading mint data...</span>
            <div className="flex items-center gap-3">
              <Skeleton className="h-16 w-16 shrink-0 rounded-[var(--radius-control)]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-full max-w-[18rem]" />
              </div>
            </div>
            <Skeleton className="h-12 w-full" />
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
            <Skeleton className="h-11 w-full" />
          </CardContent>
        </TabCard>
      )
    }

    if (isSolana) {
      return (
        <div className="space-y-4">
          {renderPlantMinting()}
          <MintShareModal
            open={showShareModal}
            onOpenChange={setShowShareModal}
            data={shareData}
          />
        </div>
      );
    }

    // Both EVM transaction controllers stay mounted across the 54rem breakpoint.
    // CSS changes their visibility/placement, so approval and pending submission
    // state cannot reset into a second clickable controller during a resize.
    return (
      <div className="space-y-4 tablet:space-y-3">
        <div className="grid grid-cols-1 items-start gap-3 min-[54rem]:grid-cols-[minmax(0,1.48fr)_minmax(300px,0.9fr)] xl:grid-cols-[minmax(0,1.58fr)_minmax(340px,0.86fr)] 2xl:grid-cols-[minmax(0,1.65fr)_minmax(380px,0.8fr)]">
          <section className={mintType === 'plant' ? 'block' : 'hidden min-[54rem]:block'}>
            {renderDesktopPlantMinting()}
          </section>

          <aside className={mintType === 'land' ? 'block min-w-0' : 'hidden min-w-0 min-[54rem]:block'}>
            {renderDesktopLandMinting()}
          </aside>

          <section className={mintType === 'plant'
            ? 'block min-[54rem]:col-start-2'
            : 'hidden min-[54rem]:col-start-2 min-[54rem]:block'}>
            <VerifyClaim
              strainId={4}
              onClaimSuccess={({ strainId, mintTxHash }) => {
                incrementForcedFetch();
                const claimStrain = PLANT_STRAINS_BY_ID[strainId];
                openMintShareModal(strainId, claimStrain?.name || 'Plant', mintTxHash);
              }}
            />
          </section>
        </div>

        <MintShareModal
          open={showShareModal}
          onOpenChange={setShowShareModal}
          data={shareData}
        />
      </div>
    );
  };

  return <div className="tablet:mx-auto tablet:max-w-7xl 2xl:max-w-[1360px]">{renderContent()}</div>;
} 
