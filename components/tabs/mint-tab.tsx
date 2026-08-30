'use client';

import { usePrimaryName } from '@/components/hooks/usePrimaryName';
import { handleExternalAnchorClick } from "@/lib/open-external";
import { MintShareModal } from '@/components/mint-share-modal';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { SolanaNotSupported,useIsSolanaWallet,useSolanaWallet,useTwinAddress } from '@/components/solana';
import { useSolanaBridge } from '@/hooks/useSolanaBridge';
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
import { usePrivy } from '@privy-io/react-auth';
import { useSignAndSendTransaction,useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { ChevronDown,Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAccount,useBalance } from 'wagmi';
import { getLandMintCall } from '../transactions/land-mint-transaction';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle, TabCard } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { BaseExpandedLoadingPageLoader } from '../ui/loading';
// Removed BalanceCard from tabs; status bar now shows balances globally

const SOLANA_DEBUG = process.env.NEXT_PUBLIC_SOLANA_DEBUG === 'true';
const SOLANA_MINT_DEBUG = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_SOLANA_MINT_DEBUG === 'true';
const solLog = (...args: UntypedValue[]) => { if (SOLANA_DEBUG) console.log(...args); };
const solWarn = (...args: UntypedValue[]) => { if (SOLANA_DEBUG) console.warn(...args); };
const solError = (...args: UntypedValue[]) => { if (SOLANA_DEBUG) console.error(...args); };

const PLANT_MINT_DESCRIPTION = 'Choose a strain and mint your Plant onchain. Each strain has its own starting lifetime, and PTS define your share of ETH rewards.';
const LAND_MINT_DESCRIPTION = 'Mint a Land to produce PTS and TOD passively by staking SEED instead of spending it, helping grow your Plant and ETH rewards over the long term.';
const SUCCESS_TRANSACTION_BUTTON_CLASS = 'w-full bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground hover:brightness-[1.03] shadow-[var(--shadow-control)]';
const SOLANA_SPECIAL_BUTTON_CLASS = 'w-full bg-[image:var(--gradient-solana)] text-white hover:brightness-105 disabled:opacity-55';
const MINT_DETAIL_TILE_CLASS = 'chromatic-white-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-2 shadow-[var(--shadow-hairline)]';

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
  // Lazy initialiser, not `false`: starting false made every desktop first paint
  // render the mobile layout for one frame and fire an extra data fetch keyed on the
  // wrong layout before the media query resolved.
  const [useCombinedMintLayout, setUseCombinedMintLayout] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(min-width: 54rem)').matches),
  );

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
  const [paymentTokenAllowance, setPaymentTokenAllowance] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(true);
  const [paymentTokenSymbol, setPaymentTokenSymbol] = useState<string>('SEED');
  const [paymentTokenBalance, setPaymentTokenBalance] = useState<bigint>(BigInt(0));
  // Read-only here: SharedFarmMintMobileToggle in app/(game)/page.tsx is the sole
  // writer now that the unreachable duplicate toggle in this file is gone. Do not
  // re-declare a local useWebQueryState — in the Mini App the two cannot sync.
  const { mintType } = useFarmView();
  const [, setLandBalance] = useState(0);
  const [landSupply, setLandSupply] = useState<{ totalSupply: number; maxSupply: number; } | null>(null);
  const [landMintStatus, setLandMintStatus] = useState<{ canMint: boolean; reason: string; } | null>(null);
  const [landMintAllowance, setLandMintAllowance] = useState<bigint>(BigInt(0));
  const [landMintPrice, setLandMintPrice] = useState<bigint>(BigInt(0));
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

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(min-width: 54rem)');
    const updateLayout = () => setUseCombinedMintLayout(mediaQuery.matches);

    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

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

  const fetchData = useCallback(async () => {
    if (!address) return;

    try {
      const shouldFetchPlantData = mintType === 'plant' || useCombinedMintLayout;
      const shouldFetchLandData = !isSolana && (mintType === 'land' || useCombinedMintLayout);
      const fetchKey = `${address}:${chainId ?? 'no-chain'}:${isSolana ? 'solana' : 'evm'}:${useCombinedMintLayout ? 'combined' : mintType}`;

      // Only show full page loader on the first fetch for the relevant wallet/network/layout.
      if (
        (shouldFetchPlantData && plantMintDataLoadedKeyRef.current !== fetchKey) ||
        (shouldFetchLandData && landMintDataLoadedKeyRef.current !== fetchKey)
      ) {
        setLoading(true);
      }

      if (shouldFetchPlantData) {
        const [balance, strainsData] = await Promise.allSettled([
          getFormattedTokenBalance(address),
          getStrainInfo(),
        ]);

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
        if (!chainId || !address) return; // Guard against undefined chainId or address
        const [lands, supply, status, landAllowance, price] = await Promise.all([
          getLandBalance(address),
          getLandSupply(),
          getLandMintStatus(address),
          checkLandMintApproval(address),
          getLandMintPrice()
        ]);
        setLandBalance(lands);
        setLandSupply(supply);
        setLandMintStatus(status);
        setLandMintAllowance(landAllowance);
        setLandMintPrice(price);
        landMintDataLoadedKeyRef.current = fetchKey;
      }

    } catch (error) {
      console.error('Unexpected error in fetchData:', error);
      toast.error(getFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [address, mintType, chainId, isSolana, useCombinedMintLayout]); // Removed selectedStrain, strains, landSupply, etc to prevent loops

  // Fetch payment token info when selected strain changes
  useEffect(() => {
    const shouldFetchPlantPaymentInfo = mintType === 'plant' || useCombinedMintLayout;
    if (!address || !selectedStrain || !shouldFetchPlantPaymentInfo) return;

    // Immediately format symbol based on payment token address
    const paymentToken = selectedStrain.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
    if (paymentToken.toLowerCase() === JESSE_TOKEN_ADDRESS.toLowerCase()) {
      setPaymentTokenSymbol('$JESSE');
    } else {
      // Will be updated with actual symbol from contract below
      setPaymentTokenSymbol('SEED');
    }

    const fetchPaymentTokenInfo = async () => {
      try {
        // Determine payment token (use paymentToken if available, otherwise default to SEED)
        const paymentToken = selectedStrain.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
        // Fetch token symbol and balance in parallel
        const [symbol, rawBalance] = await Promise.allSettled([
          getTokenSymbol(paymentToken),
          getTokenBalanceForToken(address, paymentToken),
        ]);

        // Always format symbol based on payment token address first
        // This ensures "$JESSE" is shown for JESSE token regardless of contract symbol case
        if (symbol.status === 'fulfilled') {
          const finalSymbol = formatTokenSymbol(symbol.value, paymentToken);
          setPaymentTokenSymbol(finalSymbol);
        } else {
          // If symbol fetch fails, still format based on token address
          const fallbackSymbol = paymentToken.toLowerCase() === JESSE_TOKEN_ADDRESS.toLowerCase()
            ? '$JESSE'
            : 'SEED';
          setPaymentTokenSymbol(fallbackSymbol);
        }

        if (rawBalance.status === 'fulfilled') {
          setPaymentTokenBalance(rawBalance.value);
        }

        // Check approval for the payment token
        const allowance = await checkTokenApproval(address, paymentToken);
        setPaymentTokenAllowance(allowance);
      } catch (error) {
        console.error('Error fetching payment token info:', error);
        // Fallback to SEED token on error
        const paymentToken = selectedStrain.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
        const formattedSymbol = formatTokenSymbol('SEED', paymentToken);
        setPaymentTokenSymbol(formattedSymbol);
        const balance = await getFormattedTokenBalance(address);
        setPaymentTokenBalance(BigInt(Math.floor(balance * 1e18)));
        const allowance = await checkTokenApproval(address);
        setPaymentTokenAllowance(allowance);
      }
    };

    fetchPaymentTokenInfo();
  }, [selectedStrain, address, mintType, useCombinedMintLayout]);

  // Fetch ETH quote when strain changes and ETH mode is active
  useEffect(() => {
    // Only fetch ETH quotes for smart wallet users with ETH mode enabled, on plant tab
    // AND only for strains that use SEED as payment token (ETH mode doesn't support JESSE, etc.)
    const shouldFetchPlantQuote = mintType === 'plant' || useCombinedMintLayout;
    if (!isSmartWallet || !isEthMode || !selectedStrain || !shouldFetchPlantQuote || isSolana || !isSeedPaymentStrain(selectedStrain)) {
      setEthQuote(null);
      return;
    }

    let cancelled = false;

    const fetchEthQuote = async () => {
      setEthQuoteLoading(true);
      try {
        // Get mint price in SEED (payment price or default mint price)
        const seedPrice = selectedStrain.paymentPrice ?? BigInt(Math.floor((selectedStrain.mintPrice || 0) * 1e18));
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
  }, [isSmartWallet, isEthMode, selectedStrain, mintType, isSolana, useCombinedMintLayout]);

  // Fetch ETH quote for land minting when on land tab + ETH mode active
  useEffect(() => {
    // Only fetch ETH quotes for smart wallet users with ETH mode enabled, on land tab
    const shouldFetchLandQuote = mintType === 'land' || useCombinedMintLayout;
    if (!isSmartWallet || !isEthMode || !shouldFetchLandQuote || isSolana || landMintPrice <= BigInt(0)) {
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
  }, [isSmartWallet, isEthMode, mintType, isSolana, landMintPrice, useCombinedMintLayout]);

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

  // Solana bridge minting (only used when isSolana is true)
  const bridge = useSolanaBridge();
  const { needsSetup } = bridge;
  const solanaWalletHook = useSolanaWallet();
  // Use Solana-specific hooks from @privy-io/react-auth/solana
  const { ready: solanaWalletsReady, wallets: solanaWallets } = useSolanaWallets();
  const { user, authenticated } = usePrivy();
  const { signAndSendTransaction: privySignAndSendTransaction } = useSignAndSendTransaction();

  // Find Solana wallet from connected wallets
  const solanaWallet = useMemo(() => {
    if (!isSolana) {
      return null;
    }

    if (!solanaWalletsReady) {
      solLog('[SolanaMint] Waiting for Privy Solana wallets to settle');
      return null;
    }

    // Debug: log all Solana wallets
    solLog('[SolanaMint] Looking for Solana wallet:', {
      authenticated,
      solanaWalletsReady,
      solanaWalletsCount: solanaWallets?.length || 0,
      linkedAccountsCount: user?.linkedAccounts?.length || 0,
    });

    // Use the first Solana wallet from the Solana-specific hook
    if (solanaWallets && solanaWallets.length > 0) {
      solLog('[SolanaMint] Available Solana wallets:', solanaWallets.map(w => ({
        address: w.address,
      })));

      // Return the first Solana wallet
      const wallet = solanaWallets[0];
      solLog('[SolanaMint] Using Solana wallet:', wallet.address);
      return wallet;
    }

    // Fallback: Check user's linked accounts for Solana wallet info
    if (user?.linkedAccounts) {
      solLog('[SolanaMint] Checking linked accounts:', user.linkedAccounts.map(a => ({
        type: a.type,
        address: 'address' in a ? a.address : undefined,
        chainType: 'chainType' in a ? (a as UntypedValue).chainType : undefined,
      })));

      for (const account of user.linkedAccounts) {
        if (account.type === 'wallet' && 'chainType' in account && (account as UntypedValue).chainType === 'solana') {
          solLog('[SolanaMint] Found Solana wallet in linked accounts:', (account as UntypedValue).address);
          return account as UntypedValue;
        }
      }
    }

    solLog('[SolanaMint] No Solana wallet found');
    return null;
  }, [authenticated, isSolana, solanaWallets, solanaWalletsReady, user]);

  const [solanaMintLoading, setSolanaMintLoading] = useState(false);
  const [solQuote, setSolQuote] = useState<{ wsolAmount: bigint; seedAmount: bigint } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const [quoteError, setQuoteError] = useState<string | null>(null);
  const { getQuote } = bridge;

  // Fetch SOL quote when strain is selected (for Solana users only)
  useEffect(() => {
    if (!isSolana || !selectedStrain) {
      setSolQuote(null);
      setQuoteError(null);
      return;
    }

    let cancelled = false;

    const fetchQuote = async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        solLog('[SolanaMint] Fetching quote for strain:', selectedStrain.id);
        // Use the bridge hook's getQuote method
        const quote = await getQuote('mint', { strain: selectedStrain.id });
        if (!cancelled && quote) {
          // Debug: log the quote structure
          solLog('[SolanaMint] Quote received:', {
            wsolAmount: quote.wsolAmount,
            wsolAmountType: typeof quote.wsolAmount,
            seedAmount: quote.seedAmount,
            seedAmountType: typeof quote.seedAmount,
            error: quote.error,
            route: quote.route,
          });

          // Ensure we're comparing BigInt values (handle string conversion if needed)
          const wsolAmount = typeof quote.wsolAmount === 'bigint'
            ? quote.wsolAmount
            : BigInt(quote.wsolAmount || 0);
          const seedAmount = typeof quote.seedAmount === 'bigint'
            ? quote.seedAmount
            : BigInt(quote.seedAmount || 0);

          // Only treat as error if quote data is invalid (no valid amounts)
          // Even if there's an error field, if we have valid quote data, use it
          const hasValidQuoteData = wsolAmount > BigInt(0) && seedAmount > BigInt(0);

          solLog('[SolanaMint] Quote validation:', {
            hasValidQuoteData,
            wsolAmount: wsolAmount.toString(),
            seedAmount: seedAmount.toString(),
            hasError: !!quote.error,
          });

          if (hasValidQuoteData) {
            // Use the quote even if there's an error field (might be a warning)
            // Always prioritize valid data over error messages
            setSolQuote({
              wsolAmount,
              seedAmount,
            });
            setQuoteError(null); // Clear any previous errors
            solLog('[SolanaMint] Quote accepted and stored:', {
              wsolAmount: Number(wsolAmount) / 1e9,
              seedAmount: Number(seedAmount) / 1e18,
              route: quote.route,
              storedSolQuote: { wsolAmount: wsolAmount.toString(), seedAmount: seedAmount.toString() },
            });
          } else {
            // No valid data - show error
            solError('[SolanaMint] Quote validation failed:', {
              wsolAmount: wsolAmount.toString(),
              seedAmount: seedAmount.toString(),
              wsolAmountIsZero: wsolAmount === BigInt(0),
              seedAmountIsZero: seedAmount === BigInt(0),
              originalQuote: {
                wsolAmount: quote.wsolAmount?.toString(),
                seedAmount: quote.seedAmount?.toString(),
                minSeedOut: quote.minSeedOut?.toString(),
                error: quote.error,
                route: quote.route,
              },
            });
            setSolQuote(null);
            // Provide more specific error message
            let errorMessage = quote.error || 'Failed to get quote';
            if (wsolAmount === BigInt(0) && seedAmount === BigInt(0)) {
              errorMessage = quote.error || 'Quote returned zero amounts. Please try again.';
            } else if (wsolAmount === BigInt(0)) {
              errorMessage = 'Quote returned zero wSOL amount. Please try again.';
            } else if (seedAmount === BigInt(0)) {
              errorMessage = 'Quote returned zero SEED amount. Please try again.';
            }
            setQuoteError(errorMessage);
          }
        } else if (!cancelled && !quote) {
          setQuoteError('Failed to get quote');
        }
      } catch (err) {
        solError('[SolanaMint] Quote fetch failed:', err);
        if (!cancelled) {
          setSolQuote(null);
          setQuoteError(err instanceof Error ? err.message : 'Quote failed');
        }
      } finally {
        if (!cancelled) {
          setQuoteLoading(false);
        }
      }
    };

    fetchQuote();

    return () => {
      cancelled = true;
    };
  }, [isSolana, selectedStrain, getQuote]);

  const handleSolanaSetup = async () => {
    if (!solanaWallet) {
      toast.error('Please connect your Solana wallet');
      return;
    }

    if (!privySignAndSendTransaction) {
      toast.error('Transaction signing not available.');
      return;
    }

    setSolanaMintLoading(true);
    try {
      solLog('[SolanaMint] Preparing setup transaction...');
      const tx = await bridge.prepareSetup();

      if (!tx) {
        const errorMsg = bridge.state.error || 'Failed to prepare setup transaction';
        throw new Error(errorMsg);
      }

      solLog('[SolanaMint] Setup transaction prepared. Signing and sending...');

      // Import the bridge implementation to build the actual Solana transaction
      const { solanaBridgeImplementation } = await import('@/lib/solana-bridge-implementation');
      const { PublicKey } = await import('@solana/web3.js');
      const { SOLANA_BRIDGE_CONFIG } = await import('@/lib/solana-constants');

      // Build the Solana transaction
      const walletPubkey = new PublicKey(solanaWalletHook.solanaAddress!);
      const asset = {
        symbol: 'sol',
        label: 'SOL',
        type: 'sol' as const,
        decimals: 9,
        remoteAddress: SOLANA_BRIDGE_CONFIG.base.wrappedSOL.toLowerCase(),
      };

      const callOptions = tx.params.call ? {
        type: 'call' as const,
        target: tx.params.call.target,
        data: tx.params.call.data,
        value: '0',
      } : undefined;

      const solanaTransaction = await solanaBridgeImplementation.createBridgeTransaction({
        walletAddress: walletPubkey,
        amount: tx.params.solAmount,
        destinationAddress: tx.params.twinAddress,
        asset,
        call: callOptions,
      });

      // Serialize for Privy
      const transactionBytes = solanaTransaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      solLog('[SolanaMint] Calling Privy signAndSendTransaction...');
      const result = await privySignAndSendTransaction({
        transaction: new Uint8Array(transactionBytes),
        wallet: solanaWallet,
      });

      solLog('[SolanaMint] Transaction sent! Signature:', result.signature);

      if (result.signature) {
        toast.success('Bridge setup initiated! Waiting for relay to Base...');
        window.dispatchEvent(new Event('balances:refresh'));

        // Bridge relay can take 15-60+ seconds depending on Solana finality and relayer speed
        // Poll for setup completion with increasing intervals
        solLog('[SolanaMint] Waiting for bridge relay to Base...');

        let setupComplete = false;
        const pollIntervals = [5000, 10000, 15000, 20000, 30000]; // 5s, 10s, 15s, 20s, 30s

        for (let i = 0; i < pollIntervals.length && !setupComplete; i++) {
          const delay = pollIntervals[i];
          solLog(`[SolanaMint] Polling for setup status in ${delay / 1000}s (attempt ${i + 1}/${pollIntervals.length})...`);
          await new Promise(resolve => setTimeout(resolve, delay));

          try {
            await solanaWalletHook.refresh();
            // Check if setup is now complete (needsSetup should become false)
            // We need to check the fresh value, so we'll check in next render
            // For now, we just refresh and hope it updated
            solLog('[SolanaMint] Refreshed Twin info, checking status...');
            setupComplete = true; // Exit after one successful refresh post-relay
          } catch (refreshError) {
            solWarn('[SolanaMint] Refresh failed, will retry:', refreshError);
          }
        }

        if (setupComplete) {
          toast.success('Bridge setup complete! You can now mint.');
          solLog('[SolanaMint] Setup complete! UI should update.');
        } else {
          toast('Setup transaction sent. Please refresh in a minute if button doesn\'t update.', { icon: 'ℹ️' });
        }
      }
    } catch (error) {
      solError('[SolanaMint] Setup error:', error);
      toast.error(error instanceof Error ? error.message : 'Setup failed');
    } finally {
      setSolanaMintLoading(false);
      bridge.reset();
    }
  };

  const handleSolanaMint = async () => {
    if (!selectedStrain || !solanaWallet) {
      toast.error('Please connect your Solana wallet');
      return;
    }

    if (needsSetup) {
      await handleSolanaSetup();
      return;
    }

    // Check if Privy's signAndSendTransaction hook is available
    if (!privySignAndSendTransaction) {
      toast.error('Transaction signing not available. Please ensure your wallet is connected.');
      return;
    }

    setSolanaMintLoading(true);
    try {
      // V2: Check if we have a valid quote (no swap data needed - contract does onchain swap)
      if (!bridge.state.quote || !bridge.state.quote.wsolAmount || bridge.state.quote.wsolAmount <= BigInt(0)) {
        solWarn('[SolanaMint] No valid quote, fetching new quote...');
        const freshQuote = await bridge.getQuote('mint', { strain: selectedStrain.id });
        if (!freshQuote || !freshQuote.wsolAmount || freshQuote.wsolAmount <= BigInt(0)) {
          const errorMsg = freshQuote?.error || 'Failed to get quote. Please try again.';
          solError('[SolanaMint] Fresh quote fetch failed:', {
            hasQuote: !!freshQuote,
            wsolAmount: freshQuote?.wsolAmount?.toString(),
            error: freshQuote?.error,
          });
          throw new Error(errorMsg);
        }
        solLog('[SolanaMint] Fresh quote obtained (V2):', {
          wsolAmount: freshQuote.wsolAmount?.toString(),
          minSeedOut: freshQuote.minSeedOut?.toString(),
        });
      }

      // Prepare the mint transaction (V2 - onchain swap)
      solLog('[SolanaMint] Preparing mint transaction...', {
        currentBridgeState: {
          status: bridge.state.status,
          error: bridge.state.error,
          hasQuote: !!bridge.state.quote,
          hasTransaction: !!bridge.state.transaction,
        },
      });

      // Capture error state before calling prepareMint
      const errorStateBefore = bridge.state.error;

      const tx = await bridge.prepareMint(selectedStrain.id);

      // Wait a tick to ensure state has updated, then check again
      await new Promise(resolve => setTimeout(resolve, 150));

      if (!tx) {
        // Check both before and after state
        const errorMsg = bridge.state.error || errorStateBefore || 'Failed to prepare mint transaction';

        solError('[SolanaMint] prepareMint returned null:', {
          errorBefore: errorStateBefore,
          errorAfter: bridge.state.error,
          finalError: errorMsg,
          bridgeState: {
            status: bridge.state.status,
            error: bridge.state.error,
            hasQuote: !!bridge.state.quote,
            hasTransaction: !!bridge.state.transaction,
          },
          quoteState: bridge.state.quote ? {
            wsolAmount: bridge.state.quote.wsolAmount?.toString(),
            seedAmount: bridge.state.quote.seedAmount?.toString(),
            minSeedOut: bridge.state.quote.minSeedOut?.toString(),
            error: bridge.state.quote.error,
            route: bridge.state.quote.route,
          } : 'no quote',
        });

        // Ensure we always have a meaningful error message
        if (!errorMsg || errorMsg === 'Failed to prepare mint transaction') {
          throw new Error('Transaction preparation failed. Please check console for details and try again.');
        }

        throw new Error(errorMsg);
      }

      solLog('[SolanaMint] Transaction prepared successfully:', {
        hasTransaction: !!tx,
        actionType: tx.actionType,
        description: tx.description,
      });

      // Show quote info
      if (bridge.state.quote) {
        const wsolNeeded = Number(bridge.state.quote.wsolAmount) / 1e9;
        solLog(`[SolanaMint] Will spend ~${wsolNeeded.toFixed(4)} SOL for ${selectedStrain.mintPrice} SEED`);
      }

      // Build and send the bridge transaction using Privy
      solLog('[SolanaMint] Building Solana bridge transaction...');

      // Import the bridge implementation to build the actual Solana transaction
      const { solanaBridgeImplementation } = await import('@/lib/solana-bridge-implementation');
      const { PublicKey } = await import('@solana/web3.js');
      const { SOLANA_BRIDGE_CONFIG } = await import('@/lib/solana-constants');

      // Build the Solana transaction
      const walletPubkey = new PublicKey(solanaWalletHook.solanaAddress!);
      const asset = {
        symbol: 'sol',
        label: 'SOL',
        type: 'sol' as const,
        decimals: 9,
        remoteAddress: SOLANA_BRIDGE_CONFIG.base.wrappedSOL.toLowerCase(),
      };

      const callOptions = tx.params.call ? {
        type: 'call' as const,
        target: tx.params.call.target,
        data: tx.params.call.data,
        value: '0',
      } : undefined;

      solLog('[SolanaMint] Creating bridge transaction with params:', {
        walletAddress: walletPubkey.toBase58(),
        amount: tx.params.solAmount.toString(),
        destinationAddress: tx.params.twinAddress,
        hasCall: !!callOptions,
        callTarget: callOptions?.target,
        callDataLength: callOptions?.data?.length || 0,
      });

      const solanaTransaction = await solanaBridgeImplementation.createBridgeTransaction({
        walletAddress: walletPubkey,
        amount: tx.params.solAmount,
        destinationAddress: tx.params.twinAddress,
        asset,
        call: callOptions,
      });

      // Debug transaction before serialization
      solLog('[SolanaMint] Transaction created:', {
        numInstructions: solanaTransaction.instructions?.length,
        feePayer: solanaTransaction.feePayer?.toBase58(),
        hasBlockhash: !!solanaTransaction.recentBlockhash,
        instructionDataLengths: solanaTransaction.instructions?.map(ix => ix.data?.length),
      });

      // Serialize for Privy
      let transactionBytes: Uint8Array;
      try {
        transactionBytes = solanaTransaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
      } catch (serializeError) {
        solError('[SolanaMint] Serialization error:', serializeError);

        // If error is RangeError, it might be because the transaction is missing required fields
        // Try alternative serialization method
        try {
          solLog('[SolanaMint] Trying alternative serialization...');
          const message = solanaTransaction.compileMessage();
          const compiledTransaction = new (await import('@solana/web3.js')).VersionedTransaction(message);
          transactionBytes = compiledTransaction.serialize();
          solLog('[SolanaMint] Alternative serialization successful');
        } catch (altError) {
          solError('[SolanaMint] Alternative serialization failed:', altError);

          solError('[SolanaMint] Raw instruction details:',
            solanaTransaction.instructions?.map((ix, i) => ({
              index: i,
              programId: ix.programId?.toBase58(),
              dataLength: ix.data?.length,
              dataType: typeof ix.data,
              isBuffer: ix.data instanceof Uint8Array || (ix.data && 'buffer' in ix.data),
            }))
          );
          throw new Error(`Transaction serialization failed: ${serializeError instanceof Error ? serializeError.message : String(serializeError)}`);
        }
      }

      solLog('[SolanaMint] Signing and sending transaction with Privy:', {
        transactionSize: transactionBytes.length,
        walletAddress: solanaWallet.address,
      });

      // Check if transaction is too large for Solana (max 1232 bytes)
      if (transactionBytes.length > 1232) {
        solWarn('[SolanaMint] Transaction may be too large:', transactionBytes.length, 'bytes');
      }

      // Sign and send using Privy's hook
      const result = await privySignAndSendTransaction({
        transaction: new Uint8Array(transactionBytes),
        wallet: solanaWallet,
      });

      solLog('[SolanaMint] Transaction sent! Signature:', result.signature);

      if (result.signature) {
        toast.success('Plant minted successfully via Solana bridge!');
        incrementForcedFetch();
        window.dispatchEvent(new Event('balances:refresh'));
      }
    } catch (error) {
      solError('[SolanaMint] Error:', error);
      toast.error(error instanceof Error ? error.message : 'Mint failed');
    } finally {
      setSolanaMintLoading(false);
      bridge.reset();
    }
  };

  const renderPlantMinting = () => {
    // For Solana users, show bridge minting UI
    if (isSolana) {
      const isLoading = solanaMintLoading || ['building', 'quoting', 'signing', 'bridging'].includes(bridge.state.status);
      const statusText: Record<string, string> = {
        quoting: 'Getting SOL quote...',
        building: 'Building transaction...',
        signing: 'Sign in your wallet...',
        bridging: 'Bridging to Base...',
        confirming: 'Confirming...',
      };
      const currentStatusText = statusText[bridge.state.status] || '';

      return (
        <>
          <TabCard>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                {/* Thumb art, not the full animation: a 64px header box was
                    downloading the complete growth animation. */}
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
                  <Button variant="outline" className="w-full justify-between">
                    {selectedStrain ? (
                      <div className="flex items-center space-x-2">
                        <Image src={getPlantThumbImage(selectedStrain.id)} alt={selectedStrain.name} width={24} height={24} unoptimized />
                        <span>{selectedStrain.name}</span>
                      </div>
                    ) : (
                      'Select a Strain'
                    )}
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                  {strains.map(strain => {
                    const isSoldOut = strain.maxSupply - strain.totalMinted <= 0;
                    const isBaseOnly = isSolana && ['FLORA', 'TYJ'].includes(strain.name?.toUpperCase?.() || '');
                    return (
                      <DropdownMenuItem
                        key={strain.id}
                        onSelect={() => (!isSoldOut && !isBaseOnly) && setSelectedStrain(strain)}
                        disabled={isSoldOut || isBaseOnly}
                        className={isSoldOut || isBaseOnly ? 'text-muted-foreground' : ''}
                      >
                        <div className="flex items-center justify-between w-full">
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
                        : formatNumber(selectedStrain.mintPrice)
                      } {paymentTokenSymbol}
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
                    {quoteLoading ? (
                      <div className="mt-1 text-sm text-muted-foreground animate-pulse">Loading...</div>
                    ) : solQuote && solQuote.wsolAmount > BigInt(0) ? (
                      <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-violet-700 dark:text-violet-200">
                      <Image src="/icons/solana.svg" alt="SOL" width={16} height={16} />
                      <span>~{(Number(solQuote.wsolAmount) / 1e9).toFixed(4)} SOL</span>
                      </div>
                    ) : quoteError ? (
                      <div className="mt-1 text-xs text-destructive">Error: {quoteError}</div>
                    ) : (
                      <div className="mt-1 text-sm text-muted-foreground">Unavailable</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </TabCard>

          {/* Solana Bridge Minting */}
          <Card className="border-violet-500/30 bg-violet-500/5">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Image src="/icons/solana.svg" alt="Solana" width={28} height={28} />
                <div>
                  <h3 className="text-lg font-semibold text-violet-700 dark:text-violet-200">Mint via Solana Bridge</h3>
                  <p className="text-xs text-muted-foreground">
                    Your SOL will be bridged and swapped to SEED automatically
                  </p>
                </div>
              </div>

              {/* Status message */}
              {currentStatusText && (
                <div className="flex items-center gap-2 text-sm text-violet-700 dark:text-violet-200">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {currentStatusText}
                </div>
              )}

              {/* Error message */}
              {bridge.state.error && (
                <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                  {bridge.state.error}
                </div>
              )}

              {/* Success message */}
              {bridge.state.status === 'success' && bridge.state.signature && (
                <div className="text-sm text-[hsl(var(--success-strong))] bg-[hsl(var(--success)/0.12)] p-2 rounded">
                  Mint successful!{' '}
                  <a
                    href={`https://explorer.solana.com/tx/${bridge.state.signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => handleExternalAnchorClick(event, `https://explorer.solana.com/tx/${bridge.state.signature}`)}
                    className="underline"
                  >
                    View on Solana Explorer
                  </a>
                </div>
              )}

              {isSolana && (
                <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded mb-2">
                  {SOLANA_MINT_DEBUG ? (
                    <>
                      <div>Solana Address: {solanaWalletHook.solanaAddress?.slice(0, 8)}...{solanaWalletHook.solanaAddress?.slice(-4) || 'Not found'}</div>
                      <div>Twin Address: {twinAddress?.slice(0, 8)}...{twinAddress?.slice(-4) || 'Not found'}</div>
                      <div>Wallet object: {solanaWallet ? 'Found' : 'Not found'} (from {solanaWallets?.length || 0} Solana wallets)</div>
                      <div>Setup Status: {needsSetup ? 'Needs Setup' : 'Ready'} | Twin Deployed: {solanaWalletHook.twinInfo?.isDeployed ? 'Yes' : 'No'}</div>
                    </>
                  ) : (
                    <div>
                      <div className="font-medium text-foreground">
                        {!solanaWallet
                          ? 'Solana wallet is not ready'
                          : needsSetup
                            ? 'Bridge setup required'
                            : 'Bridge ready'}
                      </div>
                      <div>
                        {!solanaWallet
                          ? 'Reconnect your wallet or refresh bridge status before minting.'
                          : needsSetup
                            ? 'Set up bridge access once, then continue with your mint.'
                            : 'Your Solana wallet can mint through the bridge.'}
                      </div>
                    </div>
                  )}
                  {(!solanaWallet || needsSetup || SOLANA_MINT_DEBUG) && (
                    <button
                      type="button"
                      onClick={async () => {
                        solLog('[SolanaMint] Manual refresh triggered');
                        await solanaWalletHook.refresh();
                        solLog('[SolanaMint] Manual refresh complete, isTwinSetup:', solanaWalletHook.isTwinSetup);
                      }}
                      className="mt-1 text-xs underline text-[hsl(var(--info))] hover:opacity-80"
                    >
                      Refresh status
                    </button>
                  )}
                </div>
              )}

              <Button
                onClick={handleSolanaMint}
                disabled={!selectedStrain || isLoading || !solanaWallet || (!needsSetup && (quoteLoading || !solQuote))}
                className={SOLANA_SPECIAL_BUTTON_CLASS}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {currentStatusText || 'Processing...'}
                  </span>
                ) : !selectedStrain ? (
                  'Select a Strain'
                ) : quoteLoading ? (
                  'Loading quote...'
                ) : !solQuote ? (
                  'Quote unavailable'
                ) : !solanaWallet ? (
                  'Wallet not ready'
                ) : needsSetup ? (
                  'Setup Bridge Access'
                ) : (
                  `Mint ${selectedStrain.name} for ~${(Number(solQuote.wsolAmount) / 1e9).toFixed(4)} SOL`
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Twin Address: {twinAddress ? formatAddress(twinAddress) : 'Loading...'}
              </p>
            </CardContent>
          </Card>
        </>
      );
    }

    // Regular EVM wallet minting
    const requiredPayment = selectedStrain
      ? (selectedStrain.paymentPrice ?? BigInt(Math.floor((selectedStrain.mintPrice || 0) * 1e18)))
      : BigInt(0);
    const needsPlantApproval = Boolean(selectedStrain && paymentTokenAllowance < requiredPayment);
    const hasInsufficientPlantBalance = selectedStrain
      ? selectedStrain.paymentPrice
        ? paymentTokenBalance < selectedStrain.paymentPrice
        : seedBalanceRaw < BigInt(Math.floor((selectedStrain.mintPrice || 0) * 1e18))
      : false;
    const plantPaymentToken = selectedStrain?.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
    const plantBalanceLabel = selectedStrain?.paymentPrice
      ? formatTokenAmount(paymentTokenBalance)
      : formatTokenAmount(seedBalanceRaw);
    const plantRequiredLabel = selectedStrain?.paymentPrice
      ? formatTokenAmount(selectedStrain.paymentPrice)
      : formatNumber(selectedStrain?.mintPrice || 0);
    const showPlantEthFlow = Boolean(isSmartWallet && isEthMode && selectedStrain && (ethQuote || ethQuoteLoading));

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
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="text-sm font-medium">Choose a strain</label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedStrain ? (
                    <div className="flex items-center space-x-2">
                      <Image src={getPlantThumbImage(selectedStrain.id)} alt={selectedStrain.name} width={24} height={24} unoptimized />
                      <span>{selectedStrain.name}</span>
                    </div>
                  ) : (
                    'Select a Strain'
                  )}
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                {strains.map(strain => {
                  const isSoldOut = strain.maxSupply - strain.totalMinted <= 0;
                  const isBaseOnly = isSolana && ['FLORA', 'TYJ'].includes(strain.name?.toUpperCase?.() || '');
                  return (
                    <DropdownMenuItem
                      key={strain.id}
                      onSelect={() => (!isSoldOut && !isBaseOnly) && setSelectedStrain(strain)}
                      disabled={isSoldOut || isBaseOnly}
                      className={isSoldOut || isBaseOnly ? 'text-muted-foreground' : ''}
                    >
                      <div className="flex items-center justify-between w-full">
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
                  {/* ETH Mode: show ETH price if smart wallet + ETH mode + valid quote + SEED strain */}
                  {isSmartWallet && isEthMode && ethQuote && isSeedPaymentStrain(selectedStrain) ? (
                    <>
                      <Image
                        src="/icons/ethlogo.svg"
                        alt="ETH"
                        width={16}
                        height={16}
                      />
                      <span>
                        {ethQuoteLoading ? '...' : (Number(ethQuote.ethAmountWithBuffer) / 1e18).toFixed(6)} ETH
                      </span>
                    </>
                  ) : isSmartWallet && isEthMode && ethQuoteLoading && isSeedPaymentStrain(selectedStrain) ? (
                    <>
                      <Image
                        src="/icons/ethlogo.svg"
                        alt="ETH"
                        width={16}
                        height={16}
                      />
                      <span>Loading...</span>
                    </>
                  ) : (
                    /* Default: show SEED/payment token price */
                    <>
                      <Image
                        src={getTokenLogo(selectedStrain.paymentToken)}
                        alt={paymentTokenSymbol}
                        width={16}
                        height={16}
                      />
                      <span>
                        {selectedStrain.paymentPrice
                          ? formatTokenAmount(selectedStrain.paymentPrice)
                          : formatNumber(selectedStrain.mintPrice)
                        } {paymentTokenSymbol}
                      </span>
                    </>
                  )}
                  </div>
                </div>
                <div className={MINT_DETAIL_TILE_CLASS}>
                  <div className="text-muted-foreground">Available</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums">
                    {formatNumber(selectedStrain.maxSupply - selectedStrain.totalMinted)} / {formatNumber(selectedStrain.maxSupply)}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </TabCard>

        {/* StatusBar replaces BalanceCard globally under header */}

        <div className="flex flex-col space-y-2 tablet:space-y-3 tablet:rounded-[var(--radius-panel)] tablet:border tablet:border-border/60 tablet:bg-card/90 tablet:bg-[image:var(--gradient-surface)] tablet:p-4 tablet:shadow-[var(--shadow-hairline)]">
          <h3 className="hidden text-base font-semibold leading-none tablet:block">Mint Plant</h3>
          {/* ETH Mode: Show SwapMintBundle for atomic ETH->SEED->Mint transaction (SEED strains only) */}
          {isSmartWallet && isEthMode && selectedStrain && ethQuote && !ethQuoteLoading && isSeedPaymentStrain(selectedStrain) && (
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Mint with ETH</span>
                <SponsoredBadge show={isSponsored} />
              </div>
              <SwapMintBundle
                strain={selectedStrain.id}
                ethAmount={ethQuote.ethAmountWithBuffer}
                minSeedOut={selectedStrain.paymentPrice ?? BigInt(Math.floor((selectedStrain.mintPrice || 0) * 1e18))}
                onSuccess={(tx) => {
                  toast.success('Plant minted successfully with ETH!');
                  incrementForcedFetch();
                  window.dispatchEvent(new Event('balances:refresh'));
                  openMintShareModal(selectedStrain.id, selectedStrain.name, tx?.transactionHash);
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText={ethBalance < ethQuote.ethAmountWithBuffer ? "Insufficient ETH Balance" : "Mint"}
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

          {/* ETH Mode loading state */}
          {isSmartWallet && isEthMode && selectedStrain && ethQuoteLoading && (
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Mint with ETH</span>
              </div>
              <Button disabled className="w-full">
                Fetching ETH quote...
              </Button>
            </div>
          )}

          {/** Standard plant action. Exactly one primary action is visible. **/}
          {!showPlantEthFlow && selectedStrain && hasInsufficientPlantBalance && (
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Mint Plant</span>
                <SponsoredBadge show={isSponsored && isSmartWallet} />
              </div>
              <DisabledTransaction
                buttonText="Insufficient Balance"
                buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
              />
              <InlineBalanceNotice>
                Not enough {paymentTokenSymbol}. Balance: {plantBalanceLabel} • Required: {plantRequiredLabel}
              </InlineBalanceNotice>
            </div>
          )}

          {!showPlantEthFlow && selectedStrain && !hasInsufficientPlantBalance && (
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {needsPlantApproval ? 'Approval + Mint' : (
                    <>
                      <span className="tablet:hidden">Mint Plant</span>
                      <span className="hidden tablet:inline">Confirm Mint</span>
                    </>
                  )}
                </span>
                <SponsoredBadge show={Boolean(isSmartWallet && (needsPlantApproval || isSponsored))} />
              </div>
              <ApprovalActionTransaction
                actionCalls={[getPlantMintCall(selectedStrain.id)]}
                approvalSpender={PIXOTCHI_NFT_ADDRESS}
                approvalTokenAddress={plantPaymentToken}
                needsApproval={needsPlantApproval}
                onApprovalSuccess={() => {
                  toast.success('Token approval successful!');
                  if (address) {
                    checkTokenApproval(address, plantPaymentToken).then(setPaymentTokenAllowance);
                  }
                  incrementForcedFetch();
                }}
                onSuccess={(tx) => {
                  toast.success(needsPlantApproval && isSmartWallet ? 'Approved and minted successfully!' : 'Plant minted successfully!');
                  if (address) {
                    checkTokenApproval(address, plantPaymentToken).then(setPaymentTokenAllowance);
                  }
                  incrementForcedFetch();
                  window.dispatchEvent(new Event('balances:refresh'));
                  openMintShareModal(selectedStrain.id, selectedStrain.name, tx?.transactionHash);
                  void notifyMintSuccess(selectedStrain.name);
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                batchButtonText="Approve + Mint"
                approvalButtonText={`Approve ${paymentTokenSymbol}`}
                actionButtonText="Mint Plant"
                buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                resetKey={`plant-${selectedStrain.id}-${plantPaymentToken}`}
              />
            </div>
          )}

          {!showPlantEthFlow && !selectedStrain && (
            <DisabledTransaction
              buttonText="Select a Strain First"
              buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
            />
          )}
        </div>
      </>
    );
  };

  const renderLandMinting = () => (
    <>
      <TabCard>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <Image
              src="/icons/village-start.png"
              alt="Land"
              width={72}
              height={72}
              className="h-16 w-16 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <CardTitle>Mint a Land</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{LAND_MINT_DESCRIPTION}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {landSupply && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={MINT_DETAIL_TILE_CLASS}>
                <div className="text-muted-foreground">Price</div>
                <div className="mt-1 flex items-center gap-1 text-sm font-semibold">
                {/* ETH Mode: show ETH price if smart wallet + ETH mode + valid quote */}
                {isSmartWallet && isEthMode && landEthQuote ? (
                  <>
                    <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                    <span>
                      {landEthQuoteLoading ? '...' : (Number(landEthQuote.ethAmountWithBuffer) / 1e18).toFixed(6)} ETH
                    </span>
                  </>
                ) : isSmartWallet && isEthMode && landEthQuoteLoading ? (
                  <>
                    <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                    <span>Loading...</span>
                  </>
                ) : (
                  /* Default: show SEED price */
                  <>
                    <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                    <span>{formatTokenAmount(landMintPrice)} SEED</span>
                  </>
                )}
                </div>
              </div>
              <div className={MINT_DETAIL_TILE_CLASS}>
                <div className="text-muted-foreground">Available</div>
                <div className="mt-1 text-sm font-semibold tabular-nums">
                  {formatNumber(landSupply.maxSupply - landSupply.totalSupply)} / {formatNumber(landSupply.maxSupply)}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </TabCard>
      {/* StatusBar replaces BalanceCard globally under header */}
      <div className="flex flex-col space-y-2 tablet:space-y-3 tablet:rounded-[var(--radius-panel)] tablet:border tablet:border-border/60 tablet:bg-card/90 tablet:bg-[image:var(--gradient-surface)] tablet:p-4 tablet:shadow-[var(--shadow-hairline)]">
        <h3 className="hidden text-base font-semibold leading-none tablet:block">Mint Land</h3>
        {/* ETH Mode: Show SwapLandMintBundle for atomic ETH->SEED->Mint Land transaction */}
        {isSmartWallet && isEthMode && landEthQuote && !landEthQuoteLoading && landMintStatus?.canMint && (
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Mint Land with ETH</span>
              <SponsoredBadge show={isSponsored} />
            </div>
            <SwapLandMintBundle
              ethAmount={landEthQuote.ethAmountWithBuffer}
              minSeedOut={landMintPrice}
              onSuccess={() => {
                toast.success('Land minted successfully with ETH!');
                incrementForcedFetch();
                window.dispatchEvent(new Event('balances:refresh'));
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

        {/* ETH Mode loading state */}
        {isSmartWallet && isEthMode && landEthQuoteLoading && landMintStatus?.canMint && (
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Mint Land with ETH</span>
            </div>
            <Button disabled className="w-full">
              Fetching ETH quote...
            </Button>
          </div>
        )}

        {/* Standard SEED land minting (not ETH mode or no quote or can't mint) */}
        {!(isSmartWallet && isEthMode && (landEthQuote || landEthQuoteLoading) && landMintStatus?.canMint) && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {landMintAllowance < landMintPrice ? 'Approval + Mint Land' : (
                  <>
                    <span className="tablet:hidden">Mint Land</span>
                    <span className="hidden tablet:inline">Confirm Mint</span>
                  </>
                )}
              </span>
              <SponsoredBadge show={Boolean(isSmartWallet && (landMintAllowance < landMintPrice || isSponsored))} />
            </div>
            {landMintStatus && !landMintStatus.canMint ? (
              <DisabledTransaction
                buttonText={landMintStatus.reason}
                buttonClassName="w-full"
              />
            ) : seedBalanceRaw < landMintPrice ? (
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
                actionCalls={[getLandMintCall()]}
                approvalSpender={LAND_CONTRACT_ADDRESS}
                needsApproval={landMintAllowance < landMintPrice}
                onApprovalSuccess={() => {
                  toast.success('Token approval successful!');
                  if (address) {
                    checkLandMintApproval(address).then(setLandMintAllowance);
                  }
                  incrementForcedFetch();
                }}
                onSuccess={() => {
                  toast.success(landMintAllowance < landMintPrice && isSmartWallet ? 'Approved and minted land successfully!' : 'Land minted successfully!');
                  if (address) {
                    checkLandMintApproval(address).then(setLandMintAllowance);
                  }
                  incrementForcedFetch();
                  window.dispatchEvent(new Event('balances:refresh'));
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
          </>
        )}
      </div>
    </>
  );

  const renderDesktopPlantMinting = () => {
    if (isSolana) {
      return renderPlantMinting();
    }

    const selectedImage = getPlantGrowthImage(selectedStrain?.id);
    const availableCount = selectedStrain ? selectedStrain.maxSupply - selectedStrain.totalMinted : 0;
    const mintedPercent = selectedStrain?.maxSupply
      ? Math.min(100, Math.max(0, (selectedStrain.totalMinted / selectedStrain.maxSupply) * 100))
      : 0;
    const requiredPayment = selectedStrain
      ? (selectedStrain.paymentPrice ?? BigInt(Math.floor((selectedStrain.mintPrice || 0) * 1e18)))
      : BigInt(0);
    const needsPlantApproval = paymentTokenAllowance < requiredPayment;
    const hasInsufficientPlantBalance = selectedStrain
      ? selectedStrain.paymentPrice
        ? paymentTokenBalance < selectedStrain.paymentPrice
        : seedBalanceRaw < BigInt(Math.floor((selectedStrain.mintPrice || 0) * 1e18))
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
          <div className="chromatic-white-surface flex min-h-[372px] flex-col justify-between rounded-[var(--radius-panel)] border border-border/60 bg-card/85 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]">
            <div className="flex flex-1 items-center justify-center">
              <div className="relative flex h-48 w-48 items-center justify-center rounded-[var(--radius-control)] border border-border/60 bg-card/70 2xl:h-56 2xl:w-56">
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
                    minSeedOut={selectedStrain.paymentPrice ?? BigInt(Math.floor((selectedStrain.mintPrice || 0) * 1e18))}
                    onSuccess={(tx) => {
                      toast.success('Plant minted successfully with ETH!');
                      incrementForcedFetch();
                      window.dispatchEvent(new Event('balances:refresh'));
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
                    actionCalls={[getPlantMintCall(selectedStrain.id)]}
                    approvalSpender={PIXOTCHI_NFT_ADDRESS}
                    approvalTokenAddress={paymentToken}
                    needsApproval={needsPlantApproval}
                    onApprovalSuccess={() => {
                      toast.success('Token approval successful!');
                      if (address) {
                        checkTokenApproval(address, paymentToken).then(setPaymentTokenAllowance);
                      }
                      incrementForcedFetch();
                    }}
                    onSuccess={(tx) => {
                      toast.success(needsPlantApproval && isSmartWallet ? 'Approved and minted successfully!' : 'Plant minted successfully!');
                      if (address) {
                        checkTokenApproval(address, paymentToken).then(setPaymentTokenAllowance);
                      }
                      incrementForcedFetch();
                      window.dispatchEvent(new Event('balances:refresh'));
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
                    window.dispatchEvent(new Event('balances:refresh'));
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
                    actionCalls={[getLandMintCall()]}
                    approvalSpender={LAND_CONTRACT_ADDRESS}
                    needsApproval={needsLandApproval}
                    onApprovalSuccess={() => {
                      toast.success('Token approval successful!');
                      if (address) {
                        checkLandMintApproval(address).then(setLandMintAllowance);
                      }
                      incrementForcedFetch();
                    }}
                    onSuccess={() => {
                      toast.success(needsLandApproval && isSmartWallet ? 'Approved and minted land successfully!' : 'Land minted successfully!');
                      if (address) {
                        checkLandMintApproval(address).then(setLandMintAllowance);
                      }
                      incrementForcedFetch();
                      window.dispatchEvent(new Event('balances:refresh'));
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

    // Solana users can only mint plants, not lands
    const showLandOption = !isSolana;

    return (
      <div className="space-y-4 tablet:space-y-3">
        {/* The Plants/Lands switch below 54rem is SharedFarmMintMobileToggle in
            app/(game)/page.tsx. A second copy used to live here, gated on
            `!useCombinedMintLayout` but styled `hidden tablet:flex` — the two
            conditions are mutually exclusive at every width, so it only ever
            flashed for the first frame on desktop before the media query resolved. */}
        {showLandOption && useCombinedMintLayout && (
          <div className="grid grid-cols-[minmax(0,1.48fr)_minmax(300px,0.9fr)] items-start gap-3 xl:grid-cols-[minmax(0,1.58fr)_minmax(340px,0.86fr)] 2xl:grid-cols-[minmax(0,1.65fr)_minmax(380px,0.8fr)]">
            {renderDesktopPlantMinting()}

            <aside className="min-w-0 space-y-3">
              {renderDesktopLandMinting()}
              <VerifyClaim
                strainId={4}
                onClaimSuccess={({ strainId, mintTxHash }) => {
                  incrementForcedFetch();
                  window.dispatchEvent(new Event('balances:refresh'));
                  const claimStrain = PLANT_STRAINS_BY_ID[strainId];
                  openMintShareModal(strainId, claimStrain?.name || 'Plant', mintTxHash);
                }}
              />
            </aside>
          </div>
        )}

        {(!showLandOption || !useCombinedMintLayout) && (
          <div className="space-y-4">
            {/* Show land not supported for Solana users if they somehow got to land view */}
            {mintType === 'land' && isSolana ? (
              <SolanaNotSupported feature="Land minting" />
            ) : (
              mintType === 'plant' ? renderPlantMinting() : renderLandMinting()
            )}
            {showLandOption && !isSolana && mintType === 'plant' && (
              <div className="pt-1">
                <VerifyClaim
                  strainId={4}
                  onClaimSuccess={({ strainId, mintTxHash }) => {
                    incrementForcedFetch();
                    window.dispatchEvent(new Event('balances:refresh'));
                    const claimStrain = PLANT_STRAINS_BY_ID[strainId];
                    openMintShareModal(strainId, claimStrain?.name || 'Plant', mintTxHash);
                  }}
                />
              </div>
            )}
          </div>
        )}

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
