"use client";

import { useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { getFriendlyErrorMessage } from '@/lib/utils';
import { TransactionState, TransactionStatus } from '@/lib/types';

interface UseTransactionOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  successMessage?: string;
  errorMessage?: string;
}

export function useTransaction<T, P extends any[]>(
  transactionFn: (...params: P) => Promise<T>,
  options: UseTransactionOptions<T> = {}
) {
  const [state, setState] = useState<TransactionState>({ status: 'idle' });

  const execute = useCallback(async (...params: P) => {
    setState({ status: 'pending' });

    try {
      const result = await transactionFn(...params);
      setState({ status: 'success' });
      if (options.successMessage) {
        toast.success(options.successMessage);
      }
      if (options.onSuccess) {
        options.onSuccess(result);
      }
      return result;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error('An unknown error occurred');
      console.error('Transaction failed:', error);
      setState({ status: 'error', error: getFriendlyErrorMessage(error) });
      if (options.errorMessage) {
        toast.error(options.errorMessage);
      } else {
        toast.error(getFriendlyErrorMessage(error));
      }
      if (options.onError) {
        options.onError(error);
      }
    }
  }, [transactionFn, options]);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return {
    execute,
    reset,
    status: state.status,
    error: state.error,
    isLoading: state.status === 'pending',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
  };
}
