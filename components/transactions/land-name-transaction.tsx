"use client";

import { useWalletClient } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useTransaction } from '@/hooks/useTransaction'; // aliased path
import { Land } from '@/lib/types';

// This is a simplified contract call for demonstration
// In a real app, this would be in your contracts.ts file
async function changeLandName(walletClient: any, landId: bigint, newName: string) {
  if (!walletClient) throw new Error("Wallet not connected");
  // Mock transaction
  console.log(`Changing name for land ${landId} to "${newName}"`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  // In a real scenario, you'd return the transaction hash or receipt
  return { success: true };
}

interface LandNameTransactionProps {
  landId: bigint;
  newName: string;
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
  buttonText?: string;
  buttonClassName?: string;
}

export function LandNameTransaction({
  landId,
  newName,
  onSuccess,
  onError,
  disabled = false,
  buttonText = "Confirm Transaction",
  buttonClassName = ""
}: LandNameTransactionProps) {
  const { data: walletClient } = useWalletClient();

  const { execute, isLoading } = useTransaction(
    async () => {
        if (!walletClient) throw new Error("Wallet not connected");
        return await changeLandName(walletClient, landId, newName);
    }, 
    {
      onSuccess: (data) => {
        if (onSuccess) onSuccess(data);
      },
      onError: onError,
      successMessage: `Successfully changed land name to "${newName}"!`,
      errorMessage: "Failed to change land name."
    }
  );

  const getButtonContent = () => {
    if (isLoading) {
      return (
        <>
          <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2" />
          <span>Processing...</span>
        </>
      );
    }
    return buttonText;
  };
  
  return (
    <Button
      onClick={() => execute()}
      disabled={disabled || isLoading}
      className={buttonClassName}
    >
      {getButtonContent()}
    </Button>
  );
}


