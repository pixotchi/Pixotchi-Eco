"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plant } from '@/lib/types';
import { PlantNameTransaction } from '@/components/transactions/plant-name-transaction';
import SwapPlantNameBundle from '@/components/transactions/swap-plant-name-bundle';
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { useBalances } from '@/lib/balance-context';
import { formatUnits } from "viem";
import { useIsSolanaWallet } from '@/components/solana';
import SolanaBridgeButton from '@/components/transactions/solana-bridge-button';
import { formatWsol } from '@/lib/solana-quote';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { useEthModeSafe } from '@/lib/eth-mode-context';
import { getEthQuoteForSeedAmount } from '@/lib/contracts';
import { Skeleton } from '@/components/ui/skeleton';

interface EditPlantNameProps {
  plant: Plant;
  onNameChanged?: (plantId: number, newName: string) => void;
  className?: string;
  iconSize?: number;
}

const NAME_CHANGE_COST = 350; // SEED tokens required
const MAX_NAME_LENGTH = 9; // Under 10 characters as requested

export function EditPlantName({
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
  const [solanaQuote, setSolanaQuote] = useState<{ wsolAmount: bigint; error?: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState(plant.name || '');
  const [isTransactionPending, setIsTransactionPending] = useState(false);

  // ETH Mode state
  const [ethQuote, setEthQuote] = useState<{ ethAmount: bigint; ethAmountWithBuffer: bigint } | null>(null);
  const [ethQuoteLoading, setEthQuoteLoading] = useState(false);
  const { data: ethBalanceData } = useBalance({ address });
  const ethBalance = ethBalanceData?.value ?? BigInt(0);

  // Check if this plant belongs to the current user
  const isOwnedByUser = address && plant.owner.toLowerCase() === address.toLowerCase();

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setNewName(plant.name || '');
    }
  }, [isOpen, plant.name]);

  const handleNameChange = (value: string) => {
    // Strictly limit to MAX_NAME_LENGTH characters
    const truncatedValue = value.slice(0, MAX_NAME_LENGTH);
    setNewName(truncatedValue);
  };

  const canAffordNameChange = isSmartWallet && isEthMode && ethQuote
    ? ethBalance >= ethQuote.ethAmountWithBuffer
    : seedBalance >= BigInt(NAME_CHANGE_COST * 1e18);
  const trimmedName = newName.trim();
  const isNameValid = trimmedName.length > 0 &&
    trimmedName.length <= MAX_NAME_LENGTH &&
    trimmedName !== (plant.name || '').trim();
  const canSubmit = canAffordNameChange && isNameValid && !isTransactionPending;

  // SEED cost in wei for ETH quote
  const nameChangeCostWei = BigInt(NAME_CHANGE_COST) * BigInt(1e18);

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

  const handleSuccess = (tx: any) => {
    toast.success(`Plant name changed to "${newName.trim()}"!`);
    setIsTransactionPending(false);

    // Notify parent component
    if (onNameChanged) {
      onNameChanged(plant.id, newName.trim());
    }

    // Manually trigger a balance refresh across the app
    window.dispatchEvent(new Event('balances:refresh'));

    // Close dialog after a short delay to show success state
    setTimeout(() => {
      setIsOpen(false);
    }, 1000);
  };

  const handleError = (error: any) => {
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
          size="sm"
          className={`p-1 h-auto hover:bg-muted ${className}`}
          title="Change plant name"
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

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Change Plant Name</DialogTitle>
          <DialogDescription>
            Change the name of your plant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">

          {/* Name input */}
          <div className="space-y-3">
            <label htmlFor="plant-name" className="text-sm font-medium">
              New Name
            </label>
            <Input
              id="plant-name"
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Enter new name..."
              maxLength={MAX_NAME_LENGTH}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{newName.length}/{MAX_NAME_LENGTH} characters</span>
              {newName.length === MAX_NAME_LENGTH && (
                <span className="text-red-500">Maximum length reached</span>
              )}
            </div>
          </div>

          {/* Balance and cost info */}
          <div className="space-y-3">
            {/* ETH Mode: show ETH balance/cost */}
            {isSmartWallet && isEthMode && !isSolana ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>Your ETH Balance:</span>
                  <div className="flex items-center space-x-1">
                    <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                    <span>{(Number(ethBalance) / 1e18).toFixed(6)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span>Cost:</span>
                  <div className="flex items-center space-x-1">
                    <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                    <span className="font-medium">
                      {ethQuoteLoading ? <Skeleton className="h-4 w-20" />
                        : ethQuote ? `${(Number(ethQuote.ethAmountWithBuffer) / 1e18).toFixed(6)} ETH`
                          : '...'}
                    </span>
                  </div>
                </div>

                {!canAffordNameChange && ethQuote && (
                  <p className="text-sm text-red-500">
                    Insufficient ETH. Need {((Number(ethQuote.ethAmountWithBuffer) - Number(ethBalance)) / 1e18).toFixed(6)} more ETH.
                  </p>
                )}
              </>
            ) : !isSolana ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>Your SEED Balance:</span>
                  <div className="flex items-center space-x-1">
                    <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                    <span className={isLoadingBalance ? 'animate-pulse' : ''}>
                      {isLoadingBalance ? '...' : parseFloat(formatUnits(seedBalance, 18)).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span>Cost:</span>
                  <div className="flex items-center space-x-1">
                    <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                    <span className="font-medium">{NAME_CHANGE_COST.toLocaleString()}</span>
                  </div>
                </div>

                {!canAffordNameChange && !isLoadingBalance && (
                  <p className="text-sm text-red-500">
                    Insufficient SEED tokens. You need {NAME_CHANGE_COST - parseFloat(formatUnits(seedBalance, 18))} more.
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between text-sm">
                <span>Est. cost (SOL):</span>
                <div className="font-medium">
                  {solanaQuote
                    ? solanaQuote.error
                      ? <span className="text-amber-500">Quote error</span>
                      : `${formatWsol(solanaQuote.wsolAmount)} SOL`
                    : '...'}
                </div>
              </div>
            )}
          </div>

          {/* Transaction Button */}
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
              onSuccess={(signature) => {
                toast.success(`Plant name changed to "${newName.trim()}"!`);
                setIsTransactionPending(false);
                if (onNameChanged) {
                  onNameChanged(plant.id, newName.trim());
                }
                window.dispatchEvent(new Event('balances:refresh'));
                setTimeout(() => setIsOpen(false), 1000);
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
              onSuccess={(tx) => {
                handleSuccess(tx);
              }}
              onError={handleError}
              buttonText={
                !canAffordNameChange
                  ? 'Insufficient ETH'
                  : `Change Name with ETH`
              }
              buttonClassName="w-full bg-green-600 hover:bg-green-700 text-white"
              disabled={!isNameValid || isTransactionPending || !canAffordNameChange}
            />
          ) : canSubmit ? (
            <div onClick={handleTransactionStart}>
              <PlantNameTransaction
                plantId={plant.id}
                newName={newName.trim()}
                onSuccess={handleSuccess}
                onError={handleError}
                buttonText={`Change Name (${NAME_CHANGE_COST} SEED)`}
                buttonClassName="w-full"
                disabled={!canSubmit}
              />
            </div>
          ) : (
            <Button
              disabled
              className="w-full"
            >
              {isSmartWallet && isEthMode && ethQuoteLoading ? 'Loading ETH quote...' :
                !canAffordNameChange ? (isSmartWallet && isEthMode ? 'Insufficient ETH' : 'Insufficient SEED') :
                  trimmedName.length === 0 ? 'Enter a name' :
                    trimmedName.length > MAX_NAME_LENGTH ? 'Name too long' :
                      trimmedName === (plant.name || '').trim() ? 'Name unchanged' :
                        'Change Name'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default EditPlantName;