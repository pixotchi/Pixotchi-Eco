"use client";

import { useIsSolanaWallet, useTwinAddress } from '@/components/solana';
import ApprovalActionTransaction from '@/components/transactions/approval-action-transaction';
import SolanaBridgeButton from '@/components/transactions/solana-bridge-button';
import SwapPlantNameBundle from '@/components/transactions/swap-plant-name-bundle';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { AssetNameField } from '@/components/asset-name-field';
import { InlineBalanceNotice } from '@/components/ui/premium';
import { getAssetNameValidation } from '@/lib/asset-name-rules';
import { useBalances } from '@/lib/balance-context';
import { checkTokenApproval, getPlantNameChangePrice, PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { useSeedPurchaseQuote } from '@/hooks/useSeedPurchaseQuote';
import { useAssetNameDraft, type AssetNameSession } from '@/hooks/useAssetNameDraft';
import { useEthModeSafe } from '@/lib/eth-mode-context';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { Plant, TransactionCall } from '@/lib/types';
import { formatTokenAmount } from '@/lib/utils';
import { formatTokenDisplay } from '@/lib/token-display';
import Image from 'next/image';
import { useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAccount,useBalance } from 'wagmi';

interface EditPlantNameProps {
  plant: Plant;
  onNameChanged?: (plantId: number, newName: string) => void;
  className?: string;
  iconSize?: number;
}

const renamePanelClassName =
  "surface-lifted rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]";
const PLANT_NAME_ABI = [
  {
    inputs: [
      { name: '_id', type: 'uint256' },
      { name: '_name', type: 'string' },
    ],
    name: 'setPlantName',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

type AllowanceState = {
  status: 'loading' | 'known' | 'error';
  value: bigint | null;
  owner: string | null;
};

function EditPlantName({
  plant,
  onNameChanged,
  className = "",
  iconSize = 16
}: EditPlantNameProps) {
  const { address: evmAddress } = useAccount();
  const {
    seedBalance,
    seedBalanceStatus,
    balanceError,
    refreshBalances,
  } = useBalances();
  const isSolana = useIsSolanaWallet();
  const twinAddress = useTwinAddress();
  const address = evmAddress || (isSolana && twinAddress ? twinAddress as `0x${string}` : undefined);
  const { isSmartWallet } = useSmartWallet();
  const { isEthMode } = useEthModeSafe();
  const [, setSolanaQuote] = useState<{ wsolAmount: bigint; error?: string } | null>(null);
  const { isOpen, newName, setNewName, isTransactionPending, setIsTransactionPending, onOpenChange, beginTransaction, isCurrentSession, scheduleAutoClose } = useAssetNameDraft(`${address?.toLowerCase() ?? ''}:${plant.owner.toLowerCase()}:${plant.id}`, plant.name || '');
  const submittedNameRef = useRef<{ session: AssetNameSession; id: number; name: string } | null>(null);
  const [nameChangeCostWei, setNameChangeCostWei] = useState<bigint>(BigInt(0));
  const [priceStatus, setPriceStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [priceRetry, setPriceRetry] = useState(0);
  const [allowanceRetry, setAllowanceRetry] = useState(0);
  const [seedAllowance, setSeedAllowance] = useState<AllowanceState>({ status: 'loading', value: null, owner: null });

  // Payment choice does not depend on whether its asynchronous quote succeeded.
  const usesEthPayment = isSmartWallet && isEthMode && !isSolana;
  const { quote: ethQuote, isLoading: ethQuoteLoading, error: ethQuoteError, retry: retryEthQuote, requireCurrentQuote } = useSeedPurchaseQuote(
    nameChangeCostWei,
    isOpen && usesEthPayment && priceStatus === 'ready',
    undefined,
    `plant:rename:${address?.toLowerCase() ?? ''}:${plant.id}`,
  );
  const {
    data: ethBalanceData,
    isLoading: ethBalanceLoading,
    isError: ethBalanceError,
    refetch: refetchEthBalance,
  } = useBalance({ address });
  const ethBalance = ethBalanceData?.value ?? BigInt(0);
  const ethBalanceKnown = ethBalanceData !== undefined && !ethBalanceError;
  const ethBalanceUnavailable = !ethBalanceKnown && !ethBalanceLoading;
  const retryEthBalance = () => {
    void Promise.allSettled([refetchEthBalance(), refreshBalances()]);
  };

  // Check if this plant belongs to the current user
  const isOwnedByUser = address && plant.owner.toLowerCase() === address.toLowerCase();

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    setPriceStatus('loading');
    getPlantNameChangePrice()
      .then((price) => {
        if (!cancelled && price !== null) {
          setNameChangeCostWei(price);
          setPriceStatus('ready');
        } else if (!cancelled) {
          setPriceStatus('error');
        }
      })
      .catch(() => {
        if (!cancelled) setPriceStatus('error');
      });

    return () => { cancelled = true; };
  }, [isOpen, priceRetry, address, plant.id]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setSeedAllowance((previous) => ({ status: 'loading', value: previous.value, owner: previous.owner }));

    if (!address) {
      setSeedAllowance((previous) => ({ status: 'error', value: previous.value, owner: previous.owner }));
      return () => { cancelled = true; };
    }

    checkTokenApproval(address)
      .then((allowance) => {
        if (!cancelled) setSeedAllowance({ status: 'known', value: allowance, owner: address.toLowerCase() });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to fetch SEED allowance for plant rename:', error);
          setSeedAllowance((previous) => ({ status: 'error', value: previous.value, owner: previous.owner }));
        }
      });

    return () => { cancelled = true; };
  }, [address, isOpen, allowanceRetry]);

  const canAffordNameChange = usesEthPayment
    ? ethQuote !== null && ethBalanceKnown && ethBalance >= ethQuote.ethAmountWithBuffer
    : seedBalanceStatus === 'ready' && seedBalance >= nameChangeCostWei;
  const ethButtonText = (() => {
    if (isTransactionPending) return 'Changing Name…';
    if (priceStatus !== 'ready') return priceStatus === 'loading' ? 'Checking rename price…' : 'Rename price unavailable';
    if (ethQuoteLoading) return 'Updating ETH quote…';
    if (!ethQuote) return 'ETH quote unavailable';
    if (!ethBalanceKnown) return ethBalanceLoading ? 'Checking ETH balance' : 'ETH balance unavailable';
    if (!canAffordNameChange) return 'Insufficient ETH';
    return 'Change Name with ETH';
  })();
  const trimmedName = newName.trim();
  const nameValidation = getAssetNameValidation('plant', newName);
  const isNameValid = nameValidation.validFormat &&
    trimmedName !== (plant.name || '').trim();
  const seedAllowanceKnown = seedAllowance.status === 'known'
    && seedAllowance.value !== null
    && seedAllowance.owner === address?.toLowerCase();
  const seedNeedsApproval = seedAllowanceKnown
    && seedAllowance.value !== null
    && seedAllowance.value < nameChangeCostWei;
  const seedBalanceKnown = seedBalanceStatus === 'ready';
  const seedActionReady = seedAllowanceKnown && seedBalanceKnown && priceStatus === 'ready';

  const plantNameCalls = useMemo<TransactionCall[]>(() => [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PLANT_NAME_ABI,
    functionName: 'setPlantName',
    args: [BigInt(plant.id), trimmedName],
  }], [plant.id, trimmedName]);

  const handleSuccess = () => {
    const submitted = submittedNameRef.current;
    if (!submitted) return;
    onNameChanged?.(submitted.id, submitted.name);
    if (!isCurrentSession(submitted.session)) return;
    setIsTransactionPending(false);
    scheduleAutoClose(submitted.session);
  };

  const handleError = (error: UntypedValue) => {
    if (submittedNameRef.current && !isCurrentSession(submittedNameRef.current.session)) return;
    console.error('Name change transaction failed:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to change plant name. Please try again.');
    setIsTransactionPending(false);
  };

  const requireCurrentNamePrice = async () => {
    if (priceStatus !== 'ready') throw new Error('Verify the rename price before continuing.');
    const price = await getPlantNameChangePrice();
    if (price === null) { setPriceStatus('error'); throw new Error('Rename price could not be verified. Retry the price check.'); }
    if (price !== nameChangeCostWei) { setNameChangeCostWei(price); throw new Error('The rename price changed. Review it before continuing.'); }
    if (usesEthPayment) await requireCurrentQuote();
  };
  const handleTransactionStart = async () => {
    const session = beginTransaction();
    submittedNameRef.current = { session, id: plant.id, name: newName.trim() };
    try { await requireCurrentNamePrice(); }
    catch (error) { if (isCurrentSession(session)) setIsTransactionPending(false); throw error; }
  };

  // Don't show edit icon if user doesn't own this plant
  if (!isOwnedByUser) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary ${className}`}
          title="Change plant name"
          aria-label="Change plant name"
        >
          <Image
            src="/icons/pencil.svg"
            alt="Edit"
            width={iconSize}
            height={iconSize}
            className="text-muted-foreground hover:text-foreground"
          />
        </Button>
      </DialogTrigger>

      <DialogContent layout="form" surface="soft" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Change Plant Name</DialogTitle>
          <DialogDescription>
            Change the name of your plant.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pt-4">
          <section className={renamePanelClassName}>
            <AssetNameField asset="plant" assetId={plant.id} value={newName} onChange={setNewName} disabled={isTransactionPending} currentName={plant.name || ''} />
          </section>
        </DialogBody>

        <DialogFooter className="block space-y-2">
          {priceStatus === 'error' && <Button variant="outline" onClick={() => setPriceRetry(value => value + 1)}>Retry rename price</Button>}
          {!usesEthPayment && !isSolana && seedAllowance.status === 'error' && <Button variant="outline" onClick={() => setAllowanceRetry(value => value + 1)}>Retry SEED permission</Button>}
          {!usesEthPayment && !isSolana && seedBalanceStatus === 'error' && <Button variant="outline" onClick={() => void refreshBalances()}>Retry SEED balance</Button>}
          {isSolana ? (
            // Solana bridge transaction for name change
            <SolanaBridgeButton
              actionType="setName"
              plantId={plant.id}
              name={newName.trim()}
              buttonText={`Change Name (via Bridge)`}
              buttonClassName="w-full"
              onQuote={setSolanaQuote}
              disabled={!isNameValid || isTransactionPending || priceStatus !== 'ready'}
              onBeforeSubmit={handleTransactionStart}
              onPendingChange={setIsTransactionPending}
              onSuccess={handleSuccess}
              onError={handleError}
            />
          ) : usesEthPayment ? (
            <div className="space-y-2">
              <SwapPlantNameBundle
                plantId={plant.id}
                newName={newName.trim()}
                ethAmount={ethQuote?.ethAmountWithBuffer ?? BigInt(0)}
                minSeedOut={nameChangeCostWei}
                onSuccess={handleSuccess}
                onError={handleError}
                onButtonClick={handleTransactionStart}
                buttonText={ethButtonText}
                buttonClassName="w-full bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] hover:bg-[hsl(var(--success)/0.9)]"
                disabled={priceStatus !== 'ready' || !isNameValid || isTransactionPending || ethQuoteLoading || !canAffordNameChange}
              />
              {ethQuoteError && !ethQuoteLoading && (
                <>
                  <p role="status" className="text-center text-xs text-muted-foreground">We could not price this name change in ETH. Retry to get a fresh quote.</p>
                  <Button type="button" variant="outline" className="w-full" disabled={isTransactionPending} onClick={() => void retryEthQuote()}>
                    Retry ETH quote
                  </Button>
                </>
              )}
              {ethBalanceUnavailable && (
                <Button type="button" variant="outline" className="w-full" onClick={retryEthBalance}>
                  Retry balance check
                </Button>
              )}
            </div>
          ) : (
            <ApprovalActionTransaction
              successMessage={`Plant #${plant.id} renamed to ${newName.trim()}`}
              intentKey={`plant:rename:${plant.id}`}
              actionCalls={plantNameCalls}
              approvalSpender={PIXOTCHI_NFT_ADDRESS}
              needsApproval={seedNeedsApproval}
              batchButtonText="Approve + Change Name"
              approvalButtonText="Approve SEED"
              actionButtonText={!seedActionReady ? (priceStatus !== 'ready' ? 'Rename price unavailable' : !seedAllowanceKnown ? 'SEED permission unavailable' : 'SEED balance unavailable') : nameChangeCostWei > BigInt(0)
                ? `Change Name (${formatTokenAmount(nameChangeCostWei)} SEED)`
                : 'Change Name (free)'}
              buttonClassName="w-full"
              disabled={!isNameValid || isTransactionPending || !canAffordNameChange || !seedActionReady}
              onButtonClick={handleTransactionStart}
              onApprovalSuccess={() => {
                const session = submittedNameRef.current?.session;
                if (!session || !isCurrentSession(session)) return;
                setIsTransactionPending(false);
                setSeedAllowance((previous) => ({ status: 'loading', value: previous.value, owner: previous.owner }));
                if (!address) return;
                void checkTokenApproval(address).then((value) => {
                  if (!isCurrentSession(session)) return;
                  setSeedAllowance({ status: 'known', value, owner: address.toLowerCase() });
                }).catch((error) => {
                  if (!isCurrentSession(session)) return;
                  console.error('Failed to refresh SEED allowance after approval:', error);
                  setSeedAllowance((previous) => ({ status: 'error', value: previous.value, owner: previous.owner }));
                });
              }}
              onSuccess={handleSuccess}
              onError={handleError}
            />
          )}
          {usesEthPayment && ethBalanceKnown && !canAffordNameChange && ethQuote ? (
            <InlineBalanceNotice>
              Not enough ETH. Balance: {formatTokenDisplay(ethBalance, 18, 18)} • Required: {formatTokenDisplay(ethQuote.ethAmountWithBuffer, 18, 18)}
            </InlineBalanceNotice>
          ) : usesEthPayment && ethBalanceUnavailable && ethQuote ? (
            <InlineBalanceNotice>
              ETH balance unavailable. Retry before submitting the name change.
            </InlineBalanceNotice>
          ) : !isSolana && !usesEthPayment && seedBalanceStatus === 'error' ? (
            <InlineBalanceNotice>
              SEED balance unavailable{balanceError ? `: ${balanceError}` : ''}. Retry before submitting the name change.
            </InlineBalanceNotice>
          ) : !isSolana && !usesEthPayment && seedBalanceKnown && !canAffordNameChange ? (
	            <InlineBalanceNotice>
	              Not enough SEED. Balance: {formatTokenAmount(seedBalance)} • Required: {formatTokenAmount(nameChangeCostWei)}
	            </InlineBalanceNotice>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EditPlantName;
