'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { BaseExpandedLoadingPageLoader } from '../ui/loading';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getFormattedTokenBalance, getFormattedTokenBalanceForToken, getTokenBalanceForToken, getStrainInfo, checkTokenApproval, getLandBalance, getLandSupply, getLandMintStatus, checkLandMintApproval, getLandMintPrice, getTokenSymbol, getEthQuoteForSeedAmount, LAND_CONTRACT_ADDRESS, PIXOTCHI_NFT_ADDRESS, PIXOTCHI_TOKEN_ADDRESS, JESSE_TOKEN_ADDRESS } from '@/lib/contracts';
import { useBalances } from '@/lib/balance-context';
import { Strain } from '@/lib/types';
import { formatNumber, formatTokenAmount } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { getFriendlyErrorMessage } from '@/lib/utils';
import { usePaymaster } from '@/lib/paymaster-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { useFrameContext } from '@/lib/frame-context';
import ApproveTransaction from '@/components/transactions/approve-transaction';
import MintTransaction from '@/components/transactions/mint-transaction';
import ApproveMintBundle from '@/components/transactions/approve-mint-bundle';
import SwapMintBundle from '@/components/transactions/swap-mint-bundle';
import SwapLandMintBundle from '@/components/transactions/swap-land-mint-bundle';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { useTabVisibility } from "@/lib/tab-visibility-context";
import LandMintTransaction from '../transactions/land-mint-transaction';
import { MintShareModal } from '@/components/mint-share-modal';
import { usePrimaryName } from '@/components/hooks/usePrimaryName';
import { VerifyClaim } from '@/components/verify-claim';
import { useEthModeSafe } from '@/lib/eth-mode-context';
import { useIsSolanaWallet, useTwinAddress, SolanaNotSupported, useSolanaBridge, useSolanaWallet } from '@/components/solana';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets, useSignAndSendTransaction } from '@privy-io/react-auth/solana';
import { Transaction } from '@solana/web3.js';
// Removed BalanceCard from tabs; status bar now shows balances globally

const SOLANA_DEBUG = process.env.NEXT_PUBLIC_SOLANA_DEBUG === 'true';
const solLog = (...args: any[]) => { if (SOLANA_DEBUG) console.log(...args); };
const solWarn = (...args: any[]) => { if (SOLANA_DEBUG) console.warn(...args); };
const solError = (...args: any[]) => { if (SOLANA_DEBUG) console.error(...args); };

const STRAIN_NAMES = ['OG', 'FLORA', 'TAKI', 'ROSA', 'ZEST'];

// Placeholder for plant images, assuming you might have them
const PLANT_STATIC_IMAGES = [
  '/icons/plant1.svg',
  '/icons/plant2.svg',
  '/icons/plant3WithFrame.svg',
  '/icons/plant4WithFrame.svg',
  '/icons/plant5.png'
];

export default function MintTab() {
  const { address: evmAddress, chainId } = useAccount();
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const { seedBalance: seedBalanceRaw } = useBalances();
  const frameContext = useFrameContext();
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('mint');

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
      ? (frameContext.context as any)?.user
      : undefined;
  const farcasterClient =
    typeof frameContext?.context === 'object'
      ? (frameContext.context as any)?.client
      : undefined;

  // Resolve basename/ENS for share functionality
  const { name: primaryName } = usePrimaryName(address ?? undefined);

  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [strains, setStrains] = useState<Strain[]>([]);
  const [selectedStrain, setSelectedStrain] = useState<Strain | null>(null);
  const [paymentTokenAllowance, setPaymentTokenAllowance] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(true);
  const [paymentTokenSymbol, setPaymentTokenSymbol] = useState<string>('SEED');
  const [paymentTokenBalance, setPaymentTokenBalance] = useState<bigint>(BigInt(0));
  const [mintType, setMintType] = useState<'plant' | 'land'>('plant');
  const [landBalance, setLandBalance] = useState(0);
  const [landSupply, setLandSupply] = useState<{ totalSupply: number; maxSupply: number; } | null>(null);
  const [landMintStatus, setLandMintStatus] = useState<{ canMint: boolean; reason: string; } | null>(null);
  const [landMintAllowance, setLandMintAllowance] = useState<bigint>(BigInt(0));
  const [landMintPrice, setLandMintPrice] = useState<bigint>(BigInt(0));

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

  const fetchData = async () => {
    if (!address) return;

    // Only show full page loader on initial load based on current view
    if (mintType === 'plant') {
      if (strains.length === 0) setLoading(true);
    } else {
      if (!landSupply) setLoading(true);
    }

    try {
      if (mintType === 'plant') {
        const [balance, strainsData] = await Promise.allSettled([
          getFormattedTokenBalance(address),
          getStrainInfo(),
        ]);

        if (balance.status === 'fulfilled') setTokenBalance(balance.value);
        if (strainsData.status === 'fulfilled') {
          const availableStrains = strainsData.value.filter(s => s.maxSupply - s.totalMinted > 0);
          setStrains(strainsData.value);
          if (!selectedStrain && availableStrains.length > 0) {
            setSelectedStrain(availableStrains[0]);
          }
        }
      } else {
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
      }

    } catch (error) {
      console.error('Unexpected error in fetchData:', error);
      toast.error(getFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  // Fetch payment token info when selected strain changes
  useEffect(() => {
    if (!address || !selectedStrain || mintType !== 'plant') return;

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
        const paymentPrice = selectedStrain.paymentPrice;

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
  }, [selectedStrain, address, mintType]);

  // Fetch ETH quote when strain changes and ETH mode is active
  useEffect(() => {
    // Only fetch ETH quotes for smart wallet users with ETH mode enabled, on plant tab
    // AND only for strains that use SEED as payment token (ETH mode doesn't support JESSE, etc.)
    if (!isSmartWallet || !isEthMode || !selectedStrain || mintType !== 'plant' || isSolana || !isSeedPaymentStrain(selectedStrain)) {
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
  }, [isSmartWallet, isEthMode, selectedStrain, mintType, isSolana]);

  // Fetch ETH quote for land minting when on land tab + ETH mode active
  useEffect(() => {
    // Only fetch ETH quotes for smart wallet users with ETH mode enabled, on land tab
    if (!isSmartWallet || !isEthMode || mintType !== 'land' || isSolana || landMintPrice <= BigInt(0)) {
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
  }, [isSmartWallet, isEthMode, mintType, isSolana, landMintPrice]);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }

    fetchData();
  }, [address, forcedFetchCount, mintType, chainId]);

  // Refresh when tab becomes visible
  useEffect(() => {
    if (isVisible) {
      console.log('🔄 [MintTab] Tab visible, refreshing...');
      fetchData();
    }
  }, [isVisible, fetchData]);

  // Solana bridge minting (only used when isSolana is true)
  const bridge = useSolanaBridge();
  const { needsSetup } = bridge;
  const solanaWalletHook = useSolanaWallet();
  // Use Solana-specific hooks from @privy-io/react-auth/solana
  const { wallets: solanaWallets } = useSolanaWallets();
  const { user, authenticated } = usePrivy();
  const { signAndSendTransaction: privySignAndSendTransaction } = useSignAndSendTransaction();

  // Find Solana wallet from connected wallets
  const solanaWallet = useMemo(() => {
    if (!isSolana) {
      return null;
    }

    // Debug: log all Solana wallets
    solLog('[SolanaMint] Looking for Solana wallet:', {
      authenticated,
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
        chainType: 'chainType' in a ? (a as any).chainType : undefined,
      })));

      for (const account of user.linkedAccounts) {
        if (account.type === 'wallet' && 'chainType' in account && (account as any).chainType === 'solana') {
          solLog('[SolanaMint] Found Solana wallet in linked accounts:', (account as any).address);
          return account as any;
        }
      }
    }

    solLog('[SolanaMint] No Solana wallet found');
    return null;
  }, [isSolana, solanaWallets, user, authenticated]);

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
      // V2: Check if we have a valid quote (no swap data needed - contract does on-chain swap)
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

      // Prepare the mint transaction (V2 - on-chain swap)
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
          <Card>
            <CardHeader>
              <CardTitle>Choose a Strain</CardTitle>
            </CardHeader>
            <CardContent>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    {selectedStrain ? (
                      <div className="flex items-center space-x-2">
                        <Image src={PLANT_STATIC_IMAGES[selectedStrain.id - 1]} alt={selectedStrain.name} width={24} height={24} />
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
                            <Image src={PLANT_STATIC_IMAGES[strain.id - 1]} alt={strain.name} width={24} height={24} />
                            <span>{strain.name}</span>
                          </div>
                          {isSoldOut && (
                            <span className="text-xs font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                              SOLD OUT
                            </span>
                          )}
                          {isBaseOnly && !isSoldOut && (
                            <span className="text-xs font-bold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                              ON BASE
                            </span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>

          {selectedStrain && (
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Price</span>
                  <div className="flex items-center space-x-1 font-semibold">
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
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Available</span>
                  <span className="font-semibold">{formatNumber(selectedStrain.maxSupply - selectedStrain.totalMinted)} / {formatNumber(selectedStrain.maxSupply)}</span>
                </div>
                {quoteLoading && (
                  <div className="flex justify-between items-center border-t pt-3 mt-3">
                    <span className="text-muted-foreground">Est. SOL Cost</span>
                    <span className="text-sm text-muted-foreground animate-pulse">Loading...</span>
                  </div>
                )}
                {!quoteLoading && solQuote && solQuote.wsolAmount > BigInt(0) && (
                  <div className="flex justify-between items-center border-t pt-3 mt-3">
                    <span className="text-muted-foreground">Est. SOL Cost</span>
                    <div className="flex items-center space-x-1 font-semibold text-purple-400">
                      <Image src="/icons/solana.svg" alt="SOL" width={16} height={16} />
                      <span>~{(Number(solQuote.wsolAmount) / 1e9).toFixed(4)} SOL</span>
                    </div>
                  </div>
                )}
                {!quoteLoading && quoteError && (
                  <div className="flex justify-between items-center border-t pt-3 mt-3">
                    <span className="text-muted-foreground">Est. SOL Cost</span>
                    <span className="text-xs text-red-400">Error: {quoteError}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Solana Bridge Minting */}
          <Card className="border-purple-500/30 bg-purple-500/5">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Image src="/icons/solana.svg" alt="Solana" width={28} height={28} />
                <div>
                  <h3 className="text-lg font-semibold text-purple-400">Mint via Solana Bridge</h3>
                  <p className="text-xs text-muted-foreground">
                    Your SOL will be bridged and swapped to SEED automatically
                  </p>
                </div>
              </div>

              {/* Status message */}
              {currentStatusText && (
                <div className="flex items-center gap-2 text-sm text-purple-400">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {currentStatusText}
                </div>
              )}

              {/* Error message */}
              {bridge.state.error && (
                <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded">
                  {bridge.state.error}
                </div>
              )}

              {/* Success message */}
              {bridge.state.status === 'success' && bridge.state.signature && (
                <div className="text-sm text-green-400 bg-green-500/10 p-2 rounded">
                  Mint successful!{' '}
                  <a
                    href={`https://explorer.solana.com/tx/${bridge.state.signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View on Solana Explorer
                  </a>
                </div>
              )}

              {/* Debug info - shows wallet detection status */}
              {isSolana && (
                <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded mb-2">
                  <div> Solana Address: {solanaWalletHook.solanaAddress?.slice(0, 8)}...{solanaWalletHook.solanaAddress?.slice(-4) || 'Not found'}</div>
                  <div> Twin Address: {twinAddress?.slice(0, 8)}...{twinAddress?.slice(-4) || 'Not found'}</div>
                  <div> Wallet object: {solanaWallet ? '✅ Found' : '❌ Not found'} (from {solanaWallets?.length || 0} Solana wallets)</div>
                  <div> Setup Status: {needsSetup ? '❌ Needs Setup' : '✅ Ready'} | Twin Deployed: {solanaWalletHook.twinInfo?.isDeployed ? '✅' : '❌'}</div>
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={async () => {
                        solLog('[SolanaMint] Manual refresh triggered');
                        await solanaWalletHook.refresh();
                        solLog('[SolanaMint] Manual refresh complete, isTwinSetup:', solanaWalletHook.isTwinSetup);
                      }}
                      className="text-xs underline text-blue-400 hover:text-blue-300"
                    >
                      🔄 Refresh Status
                    </button>
                  </div>
                  {!solanaWallet && (
                    <div className="text-yellow-500 mt-1">
                      ⚠️ Cannot sign transactions - wallet object not available
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={handleSolanaMint}
                disabled={!selectedStrain || isLoading || !solanaWallet || (!needsSetup && (quoteLoading || !solQuote))}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
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
                Twin Address: {twinAddress ? `${twinAddress.slice(0, 6)}...${twinAddress.slice(-4)}` : 'Loading...'}
              </p>
            </CardContent>
          </Card>
        </>
      );
    }

    // Regular EVM wallet minting
    return (
      <>
        <div className="mb-6">
          <VerifyClaim
            strainId={4} // Force Zest strain (ID 4)
            onClaimSuccess={() => {
              incrementForcedFetch();
              window.dispatchEvent(new Event('balances:refresh'));
            }}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Choose a Strain</CardTitle>
          </CardHeader>
          <CardContent>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedStrain ? (
                    <div className="flex items-center space-x-2">
                      <Image src={PLANT_STATIC_IMAGES[selectedStrain.id - 1]} alt={selectedStrain.name} width={24} height={24} />
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
                          <Image src={PLANT_STATIC_IMAGES[strain.id - 1]} alt={strain.name} width={24} height={24} />
                          <span>{strain.name}</span>
                        </div>
                        {isSoldOut && (
                          <span className="text-xs font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                            SOLD OUT
                          </span>
                        )}
                        {isBaseOnly && !isSoldOut && (
                          <span className="text-xs font-bold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                            ON BASE
                          </span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardContent>
        </Card>

        {selectedStrain && (
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Price</span>
                <div className="flex items-center space-x-1 font-semibold">
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
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Available</span>
                <span className="font-semibold">{formatNumber(selectedStrain.maxSupply - selectedStrain.totalMinted)} / {formatNumber(selectedStrain.maxSupply)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* StatusBar replaces BalanceCard globally under header */}

        <div className="flex flex-col space-y-2">
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
                onSuccess={() => {
                  toast.success('Plant minted successfully with ETH!');
                  incrementForcedFetch();
                  window.dispatchEvent(new Event('balances:refresh'));
                  if (address) {
                    const mintedAt = new Date().toISOString();
                    setShareData({
                      address,
                      basename: primaryName || undefined,
                      strainName: selectedStrain.name,
                      strainId: selectedStrain.id,
                      mintedAt,
                    });
                    setShowShareModal(true);
                  }
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText={ethBalance < ethQuote.ethAmountWithBuffer ? "Insufficient ETH Balance" : "Mint"}
                buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
                disabled={ethBalance < ethQuote.ethAmountWithBuffer}
              />
              {ethBalance < ethQuote.ethAmountWithBuffer && (
                <p className="text-xs text-value text-center">
                  Not enough ETH. Balance: {(Number(ethBalance) / 1e18).toFixed(6)} ETH • Required: {(Number(ethQuote.ethAmountWithBuffer) / 1e18).toFixed(6)} ETH
                </p>
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

          {/* Standard SEED minting (not ETH mode or no quote) */}
          {!(isSmartWallet && isEthMode && selectedStrain && (ethQuote || ethQuoteLoading)) && (paymentTokenAllowance < (selectedStrain?.paymentPrice ?? BigInt((selectedStrain?.mintPrice || 0) * 1e18))) && (
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Approval</span>
                <SponsoredBadge show={isSponsored && isSmartWallet} />
              </div>
              {/* If smart wallet + sponsored, offer bundled Approve + Mint */}
              {(() => {
                if (!selectedStrain) return null;
                const useBundle = isSmartWallet && isSponsored;
                const paymentToken = selectedStrain.paymentToken || PIXOTCHI_TOKEN_ADDRESS;

                const hasInsufficientBalance = selectedStrain.paymentPrice
                  ? paymentTokenBalance < selectedStrain.paymentPrice
                  : seedBalanceRaw < BigInt(Math.floor((selectedStrain.mintPrice || 0) * 1e18));

                const hasInsufficientAllowance = paymentTokenAllowance < (selectedStrain.paymentPrice ?? BigInt(selectedStrain.mintPrice * 1e18));

                return useBundle ? (
                  <>
                    <ApproveMintBundle
                      strain={selectedStrain.id}
                      tokenAddress={paymentToken}
                      onSuccess={() => {
                        toast.success('Approved and minted successfully!');
                        if (address) {
                          checkTokenApproval(address, selectedStrain.paymentToken).then(setPaymentTokenAllowance);
                        }
                        incrementForcedFetch();
                        window.dispatchEvent(new Event('balances:refresh'));
                      }}
                      onTransactionComplete={(tx) => {
                        if (address) {
                          const mintedAt = new Date().toISOString();
                          setShareData({
                            address,
                            basename: primaryName || undefined,
                            strainName: selectedStrain.name,
                            strainId: selectedStrain.id,
                            mintedAt,
                            txHash: tx?.transactionHash,
                          });
                          setShowShareModal(true);
                        }
                      }}
                      onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                      buttonText={hasInsufficientBalance ? "Insufficient Balance" : "Approve + Mint"}
                      buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
                      disabled={hasInsufficientBalance}
                    />
                    {hasInsufficientBalance && (
                      <p className="text-xs text-value text-center mt-2">
                        Not enough {paymentTokenSymbol}. Balance: {formatTokenAmount(selectedStrain.paymentPrice ? paymentTokenBalance : seedBalanceRaw)} {paymentTokenSymbol} • Required: {selectedStrain.paymentPrice ? formatTokenAmount(selectedStrain.paymentPrice) : formatNumber(selectedStrain.mintPrice)} {paymentTokenSymbol}
                      </p>
                    )}
                  </>
                ) : (
                  <ApproveTransaction
                    spenderAddress={PIXOTCHI_NFT_ADDRESS}
                    tokenAddress={paymentToken}
                    onSuccess={() => {
                      toast.success('Token approval successful!');
                      if (address) {
                        checkTokenApproval(address, paymentToken).then(setPaymentTokenAllowance);
                      }
                      incrementForcedFetch();
                    }}
                    onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                    buttonText={`Approve ${paymentTokenSymbol}`}
                    buttonClassName="w-full"
                  />
                );
              })()}
            </div>
          )}

          {/** Hide Mint step if using bundle path (smart wallet + sponsored + needsApproval) or ETH mode **/}
          {!(isSmartWallet && isEthMode && selectedStrain && (ethQuote || ethQuoteLoading)) && !(isSmartWallet && isSponsored && (paymentTokenAllowance < (selectedStrain?.paymentPrice ?? BigInt((selectedStrain?.mintPrice || 0) * 1e18))) && selectedStrain) && (
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Mint Plant</span>
                <SponsoredBadge show={isSponsored && isSmartWallet} />
              </div>
              {selectedStrain ? (
                <>
                  <MintTransaction
                    strain={selectedStrain.id}
                    onSuccess={(tx) => {
                      toast.success('Plant minted successfully!');
                      incrementForcedFetch();
                      window.dispatchEvent(new Event('balances:refresh'));
                      if (address) {
                        const mintedAt = new Date().toISOString();
                        setShareData({
                          address,
                          basename: primaryName || undefined,
                          strainName: selectedStrain.name,
                          strainId: selectedStrain.id,
                          mintedAt,
                          txHash: tx?.transactionHash,
                        });
                        setShowShareModal(true);
                      }
                      try {
                        const fid = farcasterUser?.fid;
                        const notificationDetails = farcasterClient?.notificationDetails;
                        if (fid) {
                          fetch('/api/notify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              fid,
                              notification: {
                                title: 'Mint Completed! 🌱',
                                body: `You minted ${selectedStrain?.name || 'a plant'} — tap to view your farm`,
                                notificationDetails,
                              },
                            }),
                          }).catch(() => { });
                        }
                      } catch { }
                    }}
                    onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                    buttonText="Mint Plant"
                    buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
                    disabled={(paymentTokenAllowance < (selectedStrain.paymentPrice ?? BigInt(selectedStrain.mintPrice * 1e18))) || (selectedStrain.paymentPrice ? paymentTokenBalance < selectedStrain.paymentPrice : seedBalanceRaw < BigInt(Math.floor((selectedStrain?.mintPrice || 0) * 1e18)))}
                  />
                  {!(paymentTokenAllowance < (selectedStrain.paymentPrice ?? BigInt(selectedStrain.mintPrice * 1e18))) && (selectedStrain.paymentPrice ? paymentTokenBalance < selectedStrain.paymentPrice : seedBalanceRaw < BigInt(Math.floor((selectedStrain?.mintPrice || 0) * 1e18))) && (
                    <p className="text-xs text-value text-center mt-2">
                      Not enough {paymentTokenSymbol}. Balance: {formatTokenAmount(selectedStrain.paymentPrice ? paymentTokenBalance : seedBalanceRaw)} {paymentTokenSymbol} • Required: {selectedStrain.paymentPrice ? formatTokenAmount(selectedStrain.paymentPrice) : formatNumber(selectedStrain.mintPrice)} {paymentTokenSymbol}
                    </p>
                  )}
                </>
              ) : (
                <DisabledTransaction
                  buttonText="Select a Strain First"
                  buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
                />
              )}
            </div>
          )}
        </div>
      </>
    );
  };

  const renderLandMinting = () => (
    <>
      {landSupply && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Price</span>
              <div className="flex items-center space-x-1 font-semibold">
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
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Available</span>
              <span className="font-semibold">{formatNumber(landSupply.maxSupply - landSupply.totalSupply)} / {formatNumber(landSupply.maxSupply)}</span>
            </div>
          </CardContent>
        </Card>
      )}
      {/* StatusBar replaces BalanceCard globally under header */}
      <div className="flex flex-col space-y-2">
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
              buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
              disabled={ethBalance < landEthQuote.ethAmountWithBuffer}
            />
            {ethBalance < landEthQuote.ethAmountWithBuffer && (
              <p className="text-xs text-value text-center">
                Not enough ETH. Balance: {(Number(ethBalance) / 1e18).toFixed(6)} ETH • Required: {(Number(landEthQuote.ethAmountWithBuffer) / 1e18).toFixed(6)} ETH
              </p>
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
            {landMintAllowance < landMintPrice && (
              <div className="flex flex-col space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Step 1: Approve SEED</span>
                  <SponsoredBadge show={isSponsored && isSmartWallet} />
                </div>
                <ApproveTransaction
                  spenderAddress={LAND_CONTRACT_ADDRESS}
                  onSuccess={() => {
                    toast.success('Token approval successful!');
                    if (address) {
                      checkLandMintApproval(address).then(setLandMintAllowance);
                    }
                    incrementForcedFetch();
                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText="Approve SEED for Land"
                  buttonClassName="w-full"
                />
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {landMintAllowance < landMintPrice ? 'Step 2: Mint Land' : 'Mint Land'}
              </span>
              <SponsoredBadge show={isSmartWallet} />
            </div>
            {landMintStatus && !landMintStatus.canMint ? (
              <DisabledTransaction
                buttonText={landMintStatus.reason}
                buttonClassName="w-full"
              />
            ) : (
              <>
                <LandMintTransaction
                  onSuccess={() => {
                    toast.success('Land minted successfully!');
                    incrementForcedFetch();
                    window.dispatchEvent(new Event('balances:refresh'));
                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText={`Mint Land`}
                  buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
                  disabled={!landMintStatus?.canMint || (landMintAllowance < landMintPrice) || seedBalanceRaw < landMintPrice}
                />
                {landMintStatus?.canMint && !(landMintAllowance < landMintPrice) && seedBalanceRaw < landMintPrice && (
                  <p className="text-xs text-value text-center mt-2">
                    Not enough SEED. Balance: {formatTokenAmount(seedBalanceRaw)} SEED • Required: {formatTokenAmount(landMintPrice)} SEED
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );


  const renderContent = () => {
    if (!isConnected) {
      return (
        <Card className="text-center p-6">
          <h3 className="text-lg font-semibold mb-2">Connect Wallet</h3>
          <p className="text-muted-foreground mb-4">Please connect your wallet to mint plants.</p>
        </Card>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center py-8">
          <BaseExpandedLoadingPageLoader text="Loading mint data..." />
        </div>
      )
    }

    // Solana users can only mint plants, not lands
    const showLandOption = !isSolana;

    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col space-y-3">
            <div className="flex justify-between items-start w-full gap-4">
              <div className="space-y-2">
                <h3 className="text-xl font-pixel font-bold">
                  {mintType === 'plant' ? 'Mint a Plant' : 'Mint a Land'}
                </h3>
                <p className="text-muted-foreground text-sm max-w-xl">
                  {mintType === 'plant'
                    ? 'Plant your SEED and mint your very own Pixotchi Plant NFT. Each strain has a unique look and feel.'
                    : 'Expand your onchain farm by minting a new land plot. Lands unlock new buildings and opportunities.'}
                </p>
                {isSolana && (
                  <p className="text-xs text-purple-400">
                    Connected via Solana Bridge
                  </p>
                )}
              </div>
              {showLandOption ? (
                <ToggleGroup
                  value={mintType}
                  onValueChange={(v) => setMintType(v as 'plant' | 'land')}
                  options={[
                    { value: 'plant', label: 'Plants' },
                    { value: 'land', label: 'Lands' },
                  ]}
                />
              ) : (
                // Solana users only see Plants tab
                <div className="text-xs text-muted-foreground">
                  Plants only
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Show land not supported for Solana users if they somehow got to land view */}
        {mintType === 'land' && isSolana ? (
          <SolanaNotSupported feature="Land minting" />
        ) : (
          mintType === 'plant' ? renderPlantMinting() : renderLandMinting()
        )}

        <MintShareModal
          open={showShareModal}
          onOpenChange={setShowShareModal}
          data={shareData}
        />
      </div>
    );
  };

  return <div>{renderContent()}</div>;
} 