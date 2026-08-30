"use client";

import { useIsSolanaWallet } from '@/components/solana';
import { PlantNameTransaction } from '@/components/transactions/plant-name-transaction';
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
import { Input } from '@/components/ui/input';
import { InlineBalanceNotice } from '@/components/ui/premium';
import { ASSET_NAME_RULES, DEFAULT_PLANT_NAME_CHANGE_COST_SEED, getAssetNameInvalidReason, getAssetNameValidation, truncateUtf8ToMaxBytes } from '@/lib/asset-name-rules';
import { useBalances } from '@/lib/balance-context';
import { getEthQuoteForSeedAmount, getPlantNameChangePrice } from '@/lib/contracts';
import { useEthModeSafe } from '@/lib/eth-mode-context';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { Plant } from '@/lib/types';
import { formatTokenAmount } from '@/lib/utils';
import Image from 'next/image';
import { useEffect,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAccount,useBalance } from 'wagmi';

interface EditPlantNameProps {
  plant: Plant;
  onNameChanged?: (plantId: number, newName: string) => void;
  className?: string;
  iconSize?: number;
}

const PLANT_NAME_RULE = ASSET_NAME_RULES.plant;
const WEI_PER_TOKEN = BigInt('1000000000000000000');
const SUCCESS_AUTO_CLOSE_MS = 1000;
const FALLBACK_NAME_CHANGE_COST_WEI = BigInt(DEFAULT_PLANT_NAME_CHANGE_COST_SEED) * WEI_PER_TOKEN;
const renamePanelClassName =
  "chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]";

function EditPlantName({
  plant,
  onNameChanged,
  className = "",
  iconSize = 16
}: EditPlantNameProps) {
  const { address } = useAccount();
  const { seedBalance, loading: isLoadingBalance } = useBalances();
  const isSolana = useIsSolanaWallet();
  const { isSmartWallet } = useSmartWallet();
  const { isEthMode } = useEthModeSafe();
  const [, setSolanaQuote] = useState<{ wsolAmount: bigint; error?: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState(plant.name || '');
  const [isTransactionPending, setIsTransactionPending] = useState(false);
  const autoCloseTimerRef = useRef<number | null>(null);
  const [nameChangeCostWei, setNameChangeCostWei] = useState<bigint>(FALLBACK_NAME_CHANGE_COST_WEI);

  // ETH Mode state
  const [ethQuote, setEthQuote] = useState<{ ethAmount: bigint; ethAmountWithBuffer: bigint } | null>(null);
  const [ethQuoteLoading, setEthQuoteLoading] = useState(false);
  const { data: ethBalanceData } = useBalance({ address });
  const ethBalance = ethBalanceData?.value ?? BigInt(0);

  // Check if this plant belongs to the current user
  const isOwnedByUser = address && plant.owner.toLowerCase() === address.toLowerCase();

  // Reset form when dialog opens. The pending flag MUST reset too: it was only
  // cleared in the success/error handlers, so closing mid-transaction left
  // canSubmit false forever and the dialog dead-ended on reopen.
  useEffect(() => {
    if (isOpen) {
      setNewName(plant.name || '');
      setIsTransactionPending(false);
    }
  }, [isOpen, plant.name]);

  // Cancel any pending auto-close on unmount (and clear before scheduling a new
  // one) so a stale timer can't force-close a freshly reopened dialog.
  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current !== null) {
        window.clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, []);

  const scheduleAutoClose = () => {
    if (autoCloseTimerRef.current !== null) {
      window.clearTimeout(autoCloseTimerRef.current);
    }
    autoCloseTimerRef.current = window.setTimeout(() => {
      autoCloseTimerRef.current = null;
      setIsOpen(false);
    }, SUCCESS_AUTO_CLOSE_MS);
  };

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    getPlantNameChangePrice()
      .then((price) => {
        if (!cancelled && price !== null) {
          setNameChangeCostWei(price);
        } else if (!cancelled) {
          setNameChangeCostWei(FALLBACK_NAME_CHANGE_COST_WEI);
        }
      })
      .catch(() => {
        if (!cancelled) setNameChangeCostWei(FALLBACK_NAME_CHANGE_COST_WEI);
      });

    return () => { cancelled = true; };
  }, [isOpen]);

  const handleNameChange = (value: string) => {
    setNewName(truncateUtf8ToMaxBytes(value, PLANT_NAME_RULE.maxBytes));
  };

  const canAffordNameChange = isSmartWallet && isEthMode && ethQuote
    ? ethBalance >= ethQuote.ethAmountWithBuffer
    : seedBalance >= nameChangeCostWei;
  const trimmedName = newName.trim();
  const nameValidation = getAssetNameValidation('plant', newName);
  const nameInvalidReason = getAssetNameInvalidReason('plant', newName);
  const isNameValid = nameValidation.validFormat &&
    trimmedName !== (plant.name || '').trim();
  const canSubmit = canAffordNameChange && isNameValid && !isTransactionPending;

  // Fetch ETH quote when dialog opens and ETH mode is active
  useEffect(() => {
    if (!isOpen || !isSmartWallet || !isEthMode || isSolana) {
      setEthQuote(null);
      return;
    }

    let cancelled = false;
    const fetchQuote = async () => {
      setEthQuoteLoading(true);
      try {
        const quote = await getEthQuoteForSeedAmount(nameChangeCostWei);
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
        console.error('[EditPlantName] ETH quote fetch failed:', err);
        if (!cancelled) setEthQuote(null);
      } finally {
        if (!cancelled) setEthQuoteLoading(false);
      }
    };

    fetchQuote();
    return () => { cancelled = true; };
  }, [isOpen, isSmartWallet, isEthMode, isSolana, nameChangeCostWei]);

  const handleSuccess = () => {
    toast.success(`Plant name changed to "${newName.trim()}"!`);
    setIsTransactionPending(false);

    // Notify parent component
    if (onNameChanged) {
      onNameChanged(plant.id, newName.trim());
    }

    // Close dialog after a short delay to show success state
    scheduleAutoClose();
  };

  const handleError = (error: UntypedValue) => {
    console.error('Name change transaction failed:', error);
    toast.error('Failed to change plant name. Please try again.');
    setIsTransactionPending(false);
  };

  const handleTransactionStart = () => {
    setIsTransactionPending(true);
  };

  // Don't show edit icon if user doesn't own this plant
  if (!isOwnedByUser) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
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

      <DialogContent surface="soft" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Change Plant Name</DialogTitle>
          <DialogDescription>
            Change the name of your plant.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pt-4">
          <section className={renamePanelClassName}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <label htmlFor="plant-name" className="text-sm font-semibold text-foreground">
                New Name
              </label>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Plant #{plant.id}
              </span>
            </div>
            <Input
              id="plant-name"
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Enter new name..."
              className="w-full font-pixel"
            />
            <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
              <span>{nameValidation.rawByteLength}/{PLANT_NAME_RULE.maxBytes} bytes</span>
              {nameValidation.rawByteLength === PLANT_NAME_RULE.maxBytes && (
                <span className="text-destructive">Byte limit reached</span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Emoji and accented letters can use more than 1 byte.
            </p>
          </section>
        </DialogBody>

        <DialogFooter sticky className="block space-y-2">
          {isSolana ? (
            // Solana bridge transaction for name change
            <SolanaBridgeButton
              actionType="setName"
              plantId={plant.id}
              name={newName.trim()}
              buttonText={`Change Name (via Bridge)`}
              buttonClassName="w-full"
              onQuote={setSolanaQuote}
              disabled={!isNameValid || isTransactionPending}
              onSuccess={() => {
                toast.success(`Plant name changed to "${newName.trim()}"!`);
                setIsTransactionPending(false);
                if (onNameChanged) {
                  onNameChanged(plant.id, newName.trim());
                }
                scheduleAutoClose();
              }}
              onError={(error) => {
                console.error('Name change transaction failed:', error);
                toast.error('Failed to change plant name. Please try again.');
                setIsTransactionPending(false);
              }}
            />
          ) : isSmartWallet && isEthMode && ethQuote && !ethQuoteLoading ? (
            // ETH Mode: SwapPlantNameBundle
            <SwapPlantNameBundle
              plantId={plant.id}
              newName={newName.trim()}
              ethAmount={ethQuote.ethAmountWithBuffer}
              minSeedOut={nameChangeCostWei}
              onSuccess={() => {
                handleSuccess();
              }}
              onError={handleError}
              buttonText={
                !canAffordNameChange
                  ? 'Insufficient ETH'
                  : `Change Name with ETH`
              }
              buttonClassName="w-full bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] hover:bg-[hsl(var(--success)/0.9)]"
              disabled={!isNameValid || isTransactionPending || !canAffordNameChange}
            />
          ) : canSubmit ? (
            <PlantNameTransaction
              plantId={plant.id}
              newName={newName.trim()}
              onSuccess={handleSuccess}
              onError={handleError}
              onButtonClick={handleTransactionStart}
              buttonText={nameChangeCostWei > BigInt(0) ? `Change Name (${formatTokenAmount(nameChangeCostWei)} SEED)` : 'Change Name (free)'}
              buttonClassName="w-full"
              disabled={!canSubmit}
              hideLabel
            />
          ) : (
            <Button
              disabled
              className="w-full"
            >
              {isSmartWallet && isEthMode && ethQuoteLoading ? 'Loading ETH quote...' :
                !canAffordNameChange ? (isSmartWallet && isEthMode ? 'Insufficient ETH' : 'Insufficient SEED') :
                  nameInvalidReason ? nameInvalidReason :
                      trimmedName === (plant.name || '').trim() ? 'Name unchanged' :
                        'Change Name'}
            </Button>
          )}
          {isSmartWallet && isEthMode && !isSolana && !canAffordNameChange && ethQuote ? (
            <InlineBalanceNotice>
              Not enough ETH. Balance: {(Number(ethBalance) / 1e18).toFixed(6)} • Required: {(Number(ethQuote.ethAmountWithBuffer) / 1e18).toFixed(6)}
            </InlineBalanceNotice>
          ) : !isSolana && !canAffordNameChange && !isLoadingBalance ? (
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
