'use client';

import { usePrimaryName } from '@/components/hooks/usePrimaryName';
import { MintShareModal } from '@/components/mint-share-modal';
import { useIsSolanaWallet,useSolanaWallet,useTwinAddress } from '@/components/solana';
import SolanaBridgeButton from '@/components/transactions/solana-bridge-button';
import ApprovalActionTransaction from '@/components/transactions/approval-action-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import { getPlantMintCall } from '@/components/transactions/mint-transaction';
import SwapLandMintBundle from '@/components/transactions/swap-land-mint-bundle';
import SwapMintBundle from '@/components/transactions/swap-mint-bundle';
import type { LifecycleStatus } from '@/components/transactions/transaction-kit';
import { useSeedPurchaseQuote } from '@/hooks/useSeedPurchaseQuote';
import { useMintCatalog } from '@/hooks/useMintCatalog';
import { formatStartingLifetime, getSharedStartingLifetimeCopy, LAND_MINT_DESCRIPTION, PLANT_MINT_DESCRIPTION } from '@/lib/mint-copy';
import { MintLandSummary, MintReview, MintStrainPicker } from '@/components/mint/mint-presentation';
import { ProgressBar } from '@/components/ui/progress-bar';
import { TokenAmount } from '@/components/ui/token-amount';
import { InlineBalanceNotice } from '@/components/ui/premium';
import { VerifyClaim } from '@/components/verify-claim';
import { formatTokenDisplay, formatTokenEstimate } from '@/lib/token-display';
import { useFarmView } from '@/lib/farm-view-context';
import { navigateToGameTab } from '@/lib/game-navigation';
import { useBalances } from '@/lib/balance-context';
import { PLANT_STRAINS_BY_ID } from '@/lib/constants';
import { checkLandMintApproval,checkTokenApproval,getFormattedTokenBalance,getLandBalance,getLandMintPrice,getLandMintStatus,getLandSupply,getStrainInfo,getTokenBalanceForToken,getTokenSymbol,JESSE_TOKEN_ADDRESS,LAND_CONTRACT_ADDRESS,PIXOTCHI_NFT_ADDRESS,PIXOTCHI_TOKEN_ADDRESS } from '@/lib/contracts';
import { CLIENT_ENV } from '@/lib/env-config';
import { getMiniAppQuickAuthHeaders } from '@/lib/farcaster-miniapp-auth-client';
import { useEthModeSafe } from '@/lib/eth-mode-context';
import { useFrameContext } from '@/lib/frame-context';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { Strain } from '@/lib/types';
import { cn,formatNumber,formatTokenAmount,getFriendlyErrorMessage, formatAddress } from "@/lib/utils";
import Image from 'next/image';
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAccount,useBalance } from 'wagmi';
import { getLandMintCall } from '../transactions/land-mint-transaction';
import { Button } from '../ui/button';
import { CardContent, CardHeader, CardTitle, TabCard } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
// Removed BalanceCard from tabs; status bar now shows balances globally

const SOLANA_MINT_DEBUG = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_SOLANA_MINT_DEBUG === 'true';

const SUCCESS_TRANSACTION_BUTTON_CLASS = 'h-auto min-h-11 whitespace-normal [overflow-wrap:anywhere] w-full bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground hover:brightness-[1.03] shadow-[var(--shadow-control)]';
const SOLANA_SPECIAL_BUTTON_CLASS = 'h-auto min-h-11 whitespace-normal [overflow-wrap:anywhere] w-full bg-[image:var(--gradient-solana)] text-white hover:brightness-105 disabled:opacity-55';
const MINT_DETAIL_TILE_CLASS = 'surface-inset min-w-0 rounded-[var(--radius-control)] p-3 [overflow-wrap:anywhere]';

type PaymentTokenSnapshot = {
  allowance: bigint;
  balance: bigint;
  allowanceStatus: 'loading' | 'ready' | 'error';
  balanceStatus: 'loading' | 'ready' | 'error';
  error: unknown;
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
  const { isSmartWallet } = useSmartWallet();
  const {
    seedBalance: seedBalanceRaw,
    seedBalanceStatus,
    refreshBalances,
  } = useBalances();
  const frameContext = useFrameContext();
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('mint');
  // See the 30s freshness guard on the visibility refetch effect below.
  const lastVisibleFetchRef = useRef(0);

  // ETH Mode for smart wallet users
  const { isEthMode, setEthMode } = useEthModeSafe();

  // ETH balance for ETH mode insufficent balance check
  const {
    data: ethBalanceData,
    isLoading: isEthBalanceLoading,
    error: ethBalanceError,
    refetch: refetchEthBalance,
  } = useBalance({
    address: evmAddress,
  });
  const ethBalanceIdentity = evmAddress && chainId
    ? `${evmAddress.toLowerCase()}:${chainId}`
    : null;
  const ethBalanceSnapshotsRef = useRef(new Map<string, bigint>());
  const lastKnownEthBalance = ethBalanceIdentity
    ? ethBalanceSnapshotsRef.current.get(ethBalanceIdentity)
    : undefined;
  const ethBalance = ethBalanceData?.value ?? lastKnownEthBalance ?? BigInt(0);
  const ethBalanceStatus: 'loading' | 'ready' | 'error' = ethBalanceData?.value !== undefined
    ? 'ready'
    : isEthBalanceLoading
      ? 'loading'
      : 'error';
  const ethBalanceReadError = ethBalanceError ?? (!isEthBalanceLoading && ethBalanceData?.value === undefined ? new Error('ETH balance is unavailable') : null);

  useEffect(() => {
    if (ethBalanceIdentity && ethBalanceData?.value !== undefined) {
      ethBalanceSnapshotsRef.current.set(ethBalanceIdentity, ethBalanceData.value);
    }
  }, [ethBalanceData?.value, ethBalanceIdentity]);

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
  const { strains, selectedStrainId, selectedStrain, selectStrain: setSelectedStrainId, updateCatalog } = useMintCatalog();
  const submittedStrainRef = useRef<Strain | null>(null);
  const [plantMintPending, setPlantMintPending] = useState(false);
  const [landMintPending, setLandMintPending] = useState(false);
  const updatePlantMintStatus = useCallback((status: LifecycleStatus) => {
    setPlantMintPending(['buildingTransaction', 'transactionPending', 'transactionUnresolved', 'submissionAmbiguous', 'transactionStale', 'confirmedSyncing'].includes(status.statusName));
  }, []);
  const updateLandMintStatus = useCallback((status: LifecycleStatus) => {
    setLandMintPending(['buildingTransaction', 'transactionPending', 'transactionUnresolved', 'submissionAmbiguous', 'transactionStale', 'confirmedSyncing'].includes(status.statusName));
  }, []);
  const [paymentTokenSnapshot, setPaymentTokenSnapshot] = useState<PaymentTokenSnapshot>(() => ({
    allowance: BigInt(0),
    balance: BigInt(0),
    allowanceStatus: 'loading',
    balanceStatus: 'loading',
    error: null,
    identity: null,
    symbol: 'SEED',
  }));
  const paymentTokenSnapshotsRef = useRef(new Map<string, PaymentTokenSnapshot>());
  const [paymentTokenRefreshGeneration, setPaymentTokenRefreshGeneration] = useState(0);
  const paymentTokenRequestGenerationRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const selectedPaymentToken = selectedStrain?.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
  const paymentTokenIdentity = mintFetchKey && selectedStrain
    ? `${mintFetchKey}:${selectedStrain.id}:${selectedPaymentToken.toLowerCase()}`
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
  const paymentTokenAllowanceStatus = paymentTokenSnapshotCurrent
    ? paymentTokenSnapshot.allowanceStatus
    : 'loading';
  const paymentTokenBalanceStatus = paymentTokenSnapshotCurrent
    ? paymentTokenSnapshot.balanceStatus
    : 'loading';
  const paymentTokenReadError = paymentTokenSnapshotCurrent
    ? paymentTokenSnapshot.error
    : null;
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
  const [landMintError, setLandMintError] = useState<string | null>(null);
  const [strainsError, setStrainsError] = useState<string | null>(null);
  const sharedStartingLifetimeCopy = strainsError ? null : getSharedStartingLifetimeCopy(strains);
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
    setLandMintError(null);
    setStrainsError(null);
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
          setStrainsError(null);
          updateCatalog(strainsData.value);
        } else {
          setStrainsError('Strain data is unavailable. Retry to load the catalog.');
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
        setLandMintError(null);
        landMintDataLoadedKeyRef.current = fetchKey;
      }

    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error('Unexpected error in fetchData:', error);
      setLandMintError('Land mint data is unavailable. Retry to refresh it.');
      toast.error(getFriendlyErrorMessage(error));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [address, chainId, isSolana, mintFetchKey, updateCatalog]);

  // Fetch payment token info when selected strain changes
  useEffect(() => {
    const requestGeneration = ++paymentTokenRequestGenerationRef.current;
    // Identity mismatch already gates the current render; clearing the stored
    // snapshot also keeps subsequent renders fail-closed while reads settle.
    const previousSnapshot = paymentTokenIdentity
      ? paymentTokenSnapshotsRef.current.get(paymentTokenIdentity)
      : undefined;
    setPaymentTokenSnapshot({
      allowance: previousSnapshot?.allowance ?? BigInt(0),
      balance: previousSnapshot?.balance ?? BigInt(0),
      allowanceStatus: 'loading',
      balanceStatus: 'loading',
      error: null,
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

      const previous = paymentTokenSnapshotsRef.current.get(paymentTokenIdentity);
      const nextSnapshot: PaymentTokenSnapshot = {
        allowance: allowance.status === 'fulfilled' ? allowance.value : previous?.allowance ?? BigInt(0),
        balance: rawBalance.status === 'fulfilled' ? rawBalance.value : previous?.balance ?? BigInt(0),
        allowanceStatus: allowance.status === 'fulfilled' ? 'ready' : 'error',
        balanceStatus: rawBalance.status === 'fulfilled' ? 'ready' : 'error',
        error: rawBalance.status === 'rejected'
          ? rawBalance.reason
          : allowance.status === 'rejected'
            ? allowance.reason
            : null,
        identity: paymentTokenIdentity,
        symbol: symbol.status === 'fulfilled'
          ? formatTokenSymbol(symbol.value, selectedPaymentToken)
          : selectedPaymentToken.toLowerCase() === JESSE_TOKEN_ADDRESS.toLowerCase()
            ? '$JESSE'
            : 'SEED',
      };
      paymentTokenSnapshotsRef.current.set(paymentTokenIdentity, nextSnapshot);
      setPaymentTokenSnapshot(nextSnapshot);
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

  const retryMintReads = useCallback(() => {
    refreshPaymentTokenSnapshot();
    void refetchEthBalance().catch((error) => {
      console.warn('[MintTab] ETH balance refresh failed:', error);
    });
    void refreshBalances().catch((error) => {
      console.warn('[MintTab] Balance refresh failed:', error);
    });
    void fetchData();
  }, [fetchData, refetchEthBalance, refreshBalances, refreshPaymentTokenSnapshot]);

  const renderStrainError = () => strainsError ? (
    <div role="alert" className="space-y-2 rounded-[var(--radius-control)] border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-foreground">
      <p>{strainsError}</p>
      <Button type="button" variant="outline" size="touchCompact" onClick={retryMintReads}>
        Retry strain catalog
      </Button>
    </div>
  ) : null;

  const plantUsesEth = Boolean(isSmartWallet && isEthMode && !isSolana && isSeedPaymentStrain(selectedStrain));
  const landUsesEth = Boolean(isSmartWallet && isEthMode && !isSolana);
  const plantMintAvailable = Boolean(selectedStrain?.isActive && !strainsError && selectedStrain.totalMinted < selectedStrain.maxSupply);
  const plantQuote = useSeedPurchaseQuote(
    selectedStrain ? (selectedStrain.paymentPrice ?? selectedStrain.mintPriceRaw) : BigInt(0),
    plantUsesEth && plantMintAvailable,
    undefined,
    `plant:mint:${mintFetchKey}:${selectedStrainId}`,
  );
  const landQuote = useSeedPurchaseQuote(
    landMintPrice,
    landUsesEth && !landMintError && Boolean(landMintStatus?.canMint),
    undefined,
    `land:mint:${mintFetchKey}`,
  );
  const { quote: ethQuote, isLoading: ethQuoteLoading } = plantQuote;
  const { quote: landEthQuote, isLoading: landEthQuoteLoading } = landQuote;

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
                  <CardTitle level="page">Mint a Plant</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{PLANT_MINT_DESCRIPTION}</p>
                  {sharedStartingLifetimeCopy && <p className="mt-1 text-sm text-muted-foreground">{sharedStartingLifetimeCopy}</p>}
                </div>
              </div>
              <p className="text-xs text-violet-700 dark:text-violet-200">Connected via Solana Bridge</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {renderStrainError()}
              <MintStrainPicker strains={strains} selectedId={selectedStrain?.id ?? null}
                onSelect={setSelectedStrainId} imageForStrain={getPlantThumbImage}
                pending={solanaActionPending} isSolana />

              {selectedStrain && (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 text-xs">
                  <div className={MINT_DETAIL_TILE_CLASS}>
                    <div className="text-muted-foreground">Price</div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-sm font-semibold">
                      <Image
                        src={getTokenLogo(selectedStrain.paymentToken)}
                        alt={paymentTokenSymbol}
                        width={16}
                        height={16}
                      />
                      <span>
                        {selectedStrain.paymentPrice !== undefined
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
                  <p className="col-span-full text-sm">Starting lifetime: {formatStartingLifetime(selectedStrain.strainInitialTOD)}</p>
                  <div className={`${MINT_DETAIL_TILE_CLASS} col-span-full`}>
                    <div className="text-muted-foreground">Estimated SOL cost</div>
                    {solQuote ? (
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-sm font-semibold text-violet-700 dark:text-violet-200">
                        <Image src="/icons/solana.svg" alt="SOL" width={16} height={16} />
                        <span title={`${formatTokenDisplay(solQuote.wsolAmount, 9, 9)} SOL`}>{formatTokenEstimate(solQuote.wsolAmount, 9, 4)} SOL</span>
                      </div>
                    ) : quoteError ? (
                      <div className="mt-1 text-xs text-destructive">Error: {quoteError}</div>
                    ) : (
                      <div className="mt-1 text-sm text-muted-foreground">Loading...</div>
                    )}
                  </div>
                </div>
              )}
          <MintReview label="Review plant mint" description="Mint via Solana Bridge. Success is reported after the action executes on Base.">
            <div className="space-y-4">
              <div className="surface-inset rounded-[var(--radius-control)] p-3 text-xs text-muted-foreground">
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
                    className="mt-1 min-h-11 px-2 text-xs text-info-strong underline hover:opacity-80"
                  >
                    Refresh status
                  </Button>
                )}
              </div>

              {selectedStrain ? (
                <SolanaBridgeButton
                  actionType="mint"
                  strain={selectedStrain.id}
                  disabled={!plantMintAvailable}
                  buttonText={solQuote
                    ? `Mint ${selectedStrain.name} for ${formatTokenEstimate(solQuote.wsolAmount, 9, 4)} SOL`
                    : undefined}
                  buttonClassName={SOLANA_SPECIAL_BUTTON_CLASS}
                  onQuote={handleSolanaQuote}
                  onPendingChange={(pending) => {
                    if (pending) submittedStrainRef.current = { ...selectedStrain };
                    setSolanaActionPending(pending);
                  }}
                  onSuccess={(signature) => {
                    const submittedStrain = submittedStrainRef.current ?? selectedStrain;
                    incrementForcedFetch();
                    openMintShareModal(submittedStrain.id, submittedStrain.name, signature);
                    void notifyMintSuccess(submittedStrain.name);
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
            </div>
          </MintReview>
            </CardContent>
          </TabCard>
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
    const plantPaymentBalanceStatus = selectedStrain?.paymentPrice !== undefined
      ? paymentTokenBalanceStatus
      : seedBalanceStatus;
    const plantPaymentDataUnknown = Boolean(selectedStrain)
      && (strainsError !== null || plantPaymentBalanceStatus !== 'ready' || paymentTokenAllowanceStatus !== 'ready');
    const hasInsufficientPlantBalance = selectedStrain && !plantPaymentDataUnknown
      ? selectedStrain.paymentPrice !== undefined
        ? paymentTokenBalance < selectedStrain.paymentPrice
        : seedBalanceRaw < selectedStrain.mintPriceRaw
      : false;
    const showEthPlantMint = plantUsesEth && selectedStrain;
    const paymentToken = selectedStrain?.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
    const plantBalanceLabel = selectedStrain?.paymentPrice !== undefined
      ? formatTokenAmount(paymentTokenBalance)
      : formatTokenAmount(seedBalanceRaw);
    const plantRequiredLabel = selectedStrain?.paymentPrice !== undefined
      ? formatTokenAmount(selectedStrain.paymentPrice)
      : formatNumber(selectedStrain?.mintPrice || 0);

    return (
      <TabCard padding="sm" className="@container/mint-plant tablet:min-h-[520px]" aria-label="Plant mint">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle level="page">Mint a Plant</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{PLANT_MINT_DESCRIPTION}</p>
              {sharedStartingLifetimeCopy && <p className="mt-1 text-sm text-muted-foreground">{sharedStartingLifetimeCopy}</p>}
            </div>
          </div>
        </CardHeader>
        {/* The outer layout already shares tablet width with land minting. Split
            this card only when its own content can fit both artwork and review. */}
        <CardContent className="grid gap-4 @min-[38rem]/mint-plant:grid-cols-[minmax(230px,0.86fr)_minmax(330px,1fr)]">
          <div className="surface-inset flex min-w-0 items-center gap-4 rounded-[var(--radius-panel)] p-4 @min-[38rem]/mint-plant:min-h-[372px] @min-[38rem]/mint-plant:flex-col @min-[38rem]/mint-plant:justify-between">
            <div className="flex shrink-0 items-center justify-center @min-[38rem]/mint-plant:w-full @min-[38rem]/mint-plant:flex-1">
              <div className="relative flex h-20 w-20 shrink-0 items-center justify-center @min-[38rem]/mint-plant:aspect-square @min-[38rem]/mint-plant:h-auto @min-[38rem]/mint-plant:w-full @min-[38rem]/mint-plant:max-w-48 2xl:max-w-56">
                <Image
                  src={selectedImage}
                  alt={selectedStrain?.name || 'Selected plant'}
                  width={168}
                  height={168}
                  className="h-full w-full object-contain"
                  unoptimized
                />
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-4 @min-[38rem]/mint-plant:flex-none @min-[38rem]/mint-plant:self-stretch">
              <div>
                <h3 className="text-xl font-semibold">{selectedStrain?.name || 'Select a strain'}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {selectedStrain ? `${plantRequiredLabel} ${paymentTokenSymbol} · ${formatStartingLifetime(selectedStrain.strainInitialTOD)} starting lifetime` : 'Pick one of the available strains.'}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {renderStrainError()}
            <div className="surface-group">
              <MintStrainPicker strains={strains} selectedId={selectedStrain?.id ?? null}
                onSelect={setSelectedStrainId} imageForStrain={getPlantThumbImage}
                pending={plantMintPending} />
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 text-xs">
                <div className={MINT_DETAIL_TILE_CLASS}>
                  <div className="text-muted-foreground">Price</div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-sm font-semibold">
                      {selectedStrain && isSmartWallet && isEthMode && ethQuote && isSeedPaymentStrain(selectedStrain) ? (
                        <>
                          <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                          <TokenAmount amount={ethQuote.ethAmountWithBuffer} unit="ETH" mode="estimate" precision={8} withIcon={false} />
                        </>
                      ) : selectedStrain && plantUsesEth ? (
                        <>
                          <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                          {ethQuoteLoading ? 'Loading...' : 'ETH quote unavailable'}
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

            <MintReview label="Review plant mint">
              {selectedStrain && !strainsError && !plantMintAvailable && (
                <p role="status" className="mb-3 text-sm text-muted-foreground">
                  {selectedStrain.isActive ? 'This strain is sold out.' : 'This strain is currently unavailable.'} Choose another strain to mint.
                </p>
              )}

              {showEthPlantMint && (
                <div className="space-y-2">
                  <SwapMintBundle
                    strain={selectedStrain.id}
                    ethAmount={ethQuote?.ethAmountWithBuffer ?? BigInt(0)}
                    minSeedOut={selectedStrain.paymentPrice ?? selectedStrain.mintPriceRaw}
                    onButtonClick={async () => {
                      await plantQuote.requireCurrentQuote();
                      submittedStrainRef.current = { ...selectedStrain };
                    }}
                    onStatusUpdate={updatePlantMintStatus}
                    onSuccess={(tx) => {
                      const submittedStrain = submittedStrainRef.current ?? selectedStrain;
                      incrementForcedFetch();
                      openMintShareModal(submittedStrain.id, submittedStrain.name, tx?.transactionHash);
                      void notifyMintSuccess(submittedStrain.name);
                    }}
                    buttonText={!plantMintAvailable ? (strainsError ? 'Strain data unavailable' : !selectedStrain.isActive ? 'Strain unavailable' : 'Strain sold out')
                      : ethQuoteLoading && !ethQuote ? 'Fetching ETH quote...'
                      : !ethQuote ? 'ETH quote unavailable'
                      : ethBalanceStatus !== 'ready'
                      ? (ethBalanceReadError ? "ETH balance unavailable" : "Checking ETH balance...")
                      : ethBalance < ethQuote.ethAmountWithBuffer ? "Insufficient ETH Balance" : "Mint with ETH"}
                    buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                    disabled={ethBalanceStatus !== 'ready' || ethBalance < (ethQuote?.ethAmountWithBuffer ?? BigInt(0)) || !ethQuote || ethQuoteLoading || !plantMintAvailable}
                  />
                  {plantMintAvailable && !ethQuoteLoading && !ethQuote && (
                    <div role="alert" className="space-y-2">
                      <p className="text-xs text-muted-foreground">{plantQuote.error || 'An ETH quote is needed before minting.'}</p>
                      <Button variant="outline" className="w-full" disabled={plantMintPending} onClick={() => void plantQuote.retry()}>Retry ETH quote</Button>
                      <Button variant="ghost" className="w-full" disabled={plantMintPending || landMintPending} onClick={() => setEthMode(false)}>Switch to SEED</Button>
                    </div>
                  )}
                  {ethBalanceStatus !== 'ready' ? (
                    <>
                      <InlineBalanceNotice>
                        {ethBalanceReadError
                          ? 'Your ETH balance could not be verified. Retry before minting.'
                          : 'Checking your ETH balance before enabling minting...'}
                      </InlineBalanceNotice>
                      {ethBalanceReadError && (
                        <Button type="button" variant="outline" className="w-full" onClick={retryMintReads}>
                          Retry balance check
                        </Button>
                      )}
                    </>
                  ) : ethQuote && ethBalance < ethQuote.ethAmountWithBuffer && (
                    <InlineBalanceNotice>
                      Not enough ETH. Balance: {formatTokenDisplay(ethBalance, 18, 18)} • Required: {formatTokenDisplay(ethQuote.ethAmountWithBuffer, 18, 18)}
                    </InlineBalanceNotice>
                  )}
                </div>
              )}

              {!plantUsesEth && selectedStrain && plantPaymentDataUnknown && (
                <div className="space-y-2">
                  <DisabledTransaction
                    buttonText={strainsError
                      ? "Strain data unavailable"
                      : paymentTokenReadError ? "Balance unavailable" : "Checking balance..."}
                    buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                  />
                  <InlineBalanceNotice>
                    {strainsError
                      ? 'The strain catalog could not be verified. Retry before minting.'
                      : paymentTokenReadError
                      ? 'Your payment balance could not be verified. Retry before minting.'
                      : 'Checking your payment balance and allowance...'}
                  </InlineBalanceNotice>
                  {(Boolean(strainsError) || Boolean(paymentTokenReadError)) && (
                    <Button type="button" variant="outline" className="w-full" onClick={retryMintReads}>
                      Retry balance check
                    </Button>
                  )}
                </div>
              )}

              {!plantUsesEth && selectedStrain && hasInsufficientPlantBalance && (
                <div className="space-y-2">
                  <InlineBalanceNotice tone="neutral" className="text-sm">
                    Not enough {paymentTokenSymbol}. Balance: {plantBalanceLabel} • Required: {plantRequiredLabel}
                  </InlineBalanceNotice>
                  {paymentTokenSymbol === 'SEED'
                    ? <Button className="h-auto min-h-11 w-full whitespace-normal" onClick={() => navigateToGameTab('swap')}>Get SEED in Swap</Button>
                    : <DisabledTransaction buttonText="Insufficient Balance" buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS} />}
                </div>
              )}

              {!plantUsesEth && selectedStrain && !plantPaymentDataUnknown && !hasInsufficientPlantBalance && (
                <div className="space-y-2">
                  <ApprovalActionTransaction
                    intentKey="mint:plant"
                    actionCalls={[getPlantMintCall(selectedStrain.id)]}
                    onButtonClick={() => {
                      submittedStrainRef.current = { ...selectedStrain };
                    }}
                    onStatusUpdate={updatePlantMintStatus}
                    approvalSpender={PIXOTCHI_NFT_ADDRESS}
                    approvalTokenAddress={paymentToken}
                    needsApproval={needsPlantApproval}
                    onApprovalSuccess={() => {

                      refreshPaymentTokenSnapshot();
                      incrementForcedFetch();
                    }}
                    onSuccess={(tx) => {
                      const submittedStrain = submittedStrainRef.current ?? selectedStrain;

                      refreshPaymentTokenSnapshot();
                      incrementForcedFetch();
                      openMintShareModal(submittedStrain.id, submittedStrain.name, tx?.transactionHash);
                      void notifyMintSuccess(submittedStrain.name);
                    }}
                    batchButtonText="Approve + Mint"
                    approvalButtonText={`Approve ${paymentTokenSymbol}`}
                    actionButtonText={plantMintAvailable ? 'Mint Plant' : !selectedStrain.isActive ? 'Strain unavailable' : 'Strain sold out'}
                    disabled={!plantMintAvailable}
                    buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                    resetKey={`plant-${selectedStrain.id}-${paymentToken}`}
                  />
                </div>
              )}

              {!selectedStrain && (
                <DisabledTransaction
                  buttonText={selectedStrainId === null ? 'Select a Strain First' : 'Selected strain unavailable — choose another'}
                  buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                />
              )}
            </MintReview>
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
    const landMintDataUnknown = !landMintDataCurrent || (!isEthMode && seedBalanceStatus !== 'ready');
    const hasInsufficientLandBalance = !landMintDataUnknown && seedBalanceRaw < landMintPrice;

    return (
      <TabCard padding="sm">
        <CardHeader className="pb-3">
          <CardTitle level="page">Mint Land</CardTitle>
          <p className="text-sm text-muted-foreground">{LAND_MINT_DESCRIPTION}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-3">
            <MintLandSummary price={<>
                    {isSmartWallet && isEthMode && landEthQuote ? (
                      <>
                        <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                        <TokenAmount amount={landEthQuote.ethAmountWithBuffer} unit="ETH" mode="estimate" precision={8} withIcon={false} />
                      </>
                    ) : landUsesEth ? (
                      <>
                        <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                        {landEthQuoteLoading ? 'Loading...' : 'ETH quote unavailable'}
                      </>
                    ) : (
                      <>
                        <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                        <TokenAmount amount={landMintPrice} unit="SEED" mode="exact" withIcon={false} />
                      </>
                    )}
            </>} availability={landSupply ? `${formatNumber(landAvailable)} / ${formatNumber(landSupply.maxSupply)}` : '—'} />

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

          <MintReview label="Review land mint">
            {landMintError && (
              <div role="alert" className="space-y-2 rounded-[var(--radius-control)] border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-foreground">
                <p>{landMintError}</p>
                <Button type="button" variant="outline" className="w-full" onClick={retryMintReads}>
                  Retry land mint data
                </Button>
              </div>
            )}

            {!landUsesEth && !landMintError && landMintDataUnknown && (
              <div className="space-y-2">
                <DisabledTransaction
                  buttonText="Checking land mint data..."
                  buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                />
                <InlineBalanceNotice>
                  Checking land price, supply, and wallet balance before enabling minting.
                </InlineBalanceNotice>
              </div>
            )}

            {landUsesEth && (
              <div className="space-y-2">
                <SwapLandMintBundle
                  ethAmount={landEthQuote?.ethAmountWithBuffer ?? BigInt(0)}
                  minSeedOut={landMintPrice}
                  onButtonClick={async () => { await landQuote.requireCurrentQuote(); }}
                  onStatusUpdate={updateLandMintStatus}
                  onSuccess={() => {

                    incrementForcedFetch();
                  }}
                  buttonText={landMintError ? 'Land mint data unavailable'
                    : landMintDataUnknown ? 'Checking land mint data...'
                    : !landMintStatus?.canMint ? (landMintStatus?.reason || 'Land mint unavailable')
                    : landEthQuoteLoading && !landEthQuote ? 'Fetching ETH quote...'
                    : !landEthQuote ? 'ETH quote unavailable'
                    : ethBalanceStatus !== 'ready'
                    ? (ethBalanceReadError ? "ETH balance unavailable" : "Checking ETH balance...")
                    : ethBalance < landEthQuote.ethAmountWithBuffer ? "Insufficient ETH Balance" : "Mint Land"}
                  buttonClassName={SUCCESS_TRANSACTION_BUTTON_CLASS}
                  disabled={ethBalanceStatus !== 'ready' || ethBalance < (landEthQuote?.ethAmountWithBuffer ?? BigInt(0)) || !landEthQuote || landEthQuoteLoading || Boolean(landMintError) || landMintDataUnknown || !landMintStatus?.canMint}
                />
                {landMintStatus?.canMint && !landMintError && !landEthQuoteLoading && !landEthQuote && (
                  <div role="alert" className="space-y-2">
                    <p className="text-xs text-muted-foreground">{landQuote.error || 'An ETH quote is needed before minting.'}</p>
                    <Button variant="outline" className="w-full" disabled={landMintPending} onClick={() => void landQuote.retry()}>Retry ETH quote</Button>
                    <Button variant="ghost" className="w-full" disabled={plantMintPending || landMintPending} onClick={() => setEthMode(false)}>Switch to SEED</Button>
                  </div>
                )}
                {ethBalanceStatus !== 'ready' ? (
                  <>
                    <InlineBalanceNotice>
                      {ethBalanceReadError
                        ? 'Your ETH balance could not be verified. Retry before minting.'
                        : 'Checking your ETH balance before enabling land minting...'}
                    </InlineBalanceNotice>
                    {ethBalanceReadError && (
                      <Button type="button" variant="outline" className="w-full" onClick={retryMintReads}>
                        Retry balance check
                      </Button>
                    )}
                  </>
                ) : landEthQuote && ethBalance < landEthQuote.ethAmountWithBuffer && (
                  <InlineBalanceNotice>
                    Not enough ETH. Balance: {formatTokenDisplay(ethBalance, 18, 18)} • Required: {formatTokenDisplay(landEthQuote.ethAmountWithBuffer, 18, 18)}
                  </InlineBalanceNotice>
                )}
              </div>
            )}

            {!landUsesEth && !landMintError && !landMintDataUnknown && (
              <div className="space-y-3">
                {landMintStatus && !landMintStatus.canMint ? (
                  <DisabledTransaction
                    buttonText={landMintStatus.reason}
                    buttonClassName="h-auto min-h-11 whitespace-normal [overflow-wrap:anywhere] w-full"
                  />
                ) : hasInsufficientLandBalance ? (
                  <>
                    <InlineBalanceNotice tone="neutral" className="text-sm">
                      Not enough SEED. Balance: {formatTokenAmount(seedBalanceRaw)} • Required: {formatTokenAmount(landMintPrice)}
                    </InlineBalanceNotice>
                    <Button className="h-auto min-h-11 w-full whitespace-normal" onClick={() => navigateToGameTab('swap')}>Get SEED in Swap</Button>
                  </>
                ) : (
                  <ApprovalActionTransaction
                    intentKey="mint:land"
                    actionCalls={[getLandMintCall()]}
                    approvalSpender={LAND_CONTRACT_ADDRESS}
                    needsApproval={needsLandApproval}
                    onStatusUpdate={updateLandMintStatus}
                    onApprovalSuccess={() => {

                      incrementForcedFetch();
                    }}
                    onSuccess={() => {

                      incrementForcedFetch();
                    }}
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
          </MintReview>
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
          <CardContent className="space-y-4">
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
          {/* On phones, contents lets the claim precede the paid plant choices.
              On desktop, both small options share a bounded side column. The
              same controllers stay mounted when the layout changes. */}
          <aside className="contents min-[54rem]:col-start-2 min-[54rem]:row-start-1 min-[54rem]:flex min-[54rem]:min-w-0 min-[54rem]:flex-col min-[54rem]:gap-3">
            <div role="region" aria-label="Free plant claim" className={cn('order-1 w-full max-w-md [&:empty]:hidden', mintType !== 'plant' && 'hidden min-[54rem]:block')}>
              <VerifyClaim appearance="compact" strainId={4} onClaimSuccess={({ strainId, mintTxHash }) => {
                incrementForcedFetch();
                const claimStrain = PLANT_STRAINS_BY_ID[strainId];
                openMintShareModal(strainId, claimStrain?.name || 'Plant', mintTxHash);
              }} />
            </div>
            <div className={cn('order-3 min-w-0', mintType !== 'land' && 'hidden min-[54rem]:block')}>
              {renderDesktopLandMinting()}
            </div>
          </aside>
          <section className={cn('order-2 min-w-0 min-[54rem]:col-start-1 min-[54rem]:row-start-1', mintType !== 'plant' && 'hidden min-[54rem]:block')}>
            {renderDesktopPlantMinting()}
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
