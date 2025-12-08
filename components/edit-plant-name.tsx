"use client";

import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
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
import { toast } from 'react-hot-toast';
import Image from 'next/image';
import { useBalances } from '@/lib/balance-context';
import { formatUnits } from "viem";
import { useIsSolanaWallet } from '@/components/solana';
import SolanaBridgeButton from '@/components/transactions/solana-bridge-button';
import { formatWsol } from '@/lib/solana-quote';

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
  const [solanaQuote, setSolanaQuote] = useState<{ wsolAmount: bigint; error?: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState(plant.name || '');
  const [isTransactionPending, setIsTransactionPending] = useState(false);

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

  const canAffordNameChange = seedBalance >= BigInt(NAME_CHANGE_COST * 1e18);
  const trimmedName = newName.trim();
  const isNameValid = trimmedName.length > 0 && 
                     trimmedName.length <= MAX_NAME_LENGTH && 
                     trimmedName !== (plant.name || '').trim();
  const canSubmit = canAffordNameChange && isNameValid && !isTransactionPending;

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
            {!isSolana && (
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
              </>
            )}

            {isSolana && (
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

            {!canAffordNameChange && !isLoadingBalance && (
              <p className="text-sm text-red-500">
                Insufficient SEED tokens. You need {NAME_CHANGE_COST - parseFloat(formatUnits(seedBalance, 18))} more.
              </p>
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
              {!canAffordNameChange ? 'Insufficient SEED' : 
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