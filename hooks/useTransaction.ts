"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
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
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);

  // Keep options ref up to date without causing re-renders
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(async (...params: P) => {
    if (!mountedRef.current) return;
    setState({ status: 'pending' });

    try {
      const result = await transactionFn(...params);
      if (!mountedRef.current) return;
      setState({ status: 'success' });
      
      const opts = optionsRef.current;
      if (opts.successMessage) {
        toast.success(opts.successMessage);
      }
      if (opts.onSuccess) {
        opts.onSuccess(result);
      }
      return result;
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const error = err instanceof Error ? err : new Error('An unknown error occurred');
      console.error('Transaction failed:', error);
      setState({ status: 'error', error: getFriendlyErrorMessage(error) });
      
      const opts = optionsRef.current;
      if (opts.errorMessage) {
        toast.error(opts.errorMessage);
      } else {
        toast.error(getFriendlyErrorMessage(error));
      }
      if (opts.onError) {
        opts.onError(error);
      }
      throw error; // Re-throw to allow caller to handle
    }
  }, [transactionFn]);

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
