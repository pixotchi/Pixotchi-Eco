"use client";

import React, { createContext, useContext, useReducer, ReactNode, useCallback } from 'react';

export type LoadingState = {
  id: string;
  message?: string;
  progress?: number; // 0-100
  type: 'spinner' | 'progress' | 'skeleton' | 'none';
};

type LoadingAction =
  | { type: 'ADD_LOADING'; payload: LoadingState }
  | { type: 'REMOVE_LOADING'; payload: string }
  | { type: 'UPDATE_LOADING'; payload: { id: string; updates: Partial<LoadingState> } }
  | { type: 'CLEAR_ALL' };

interface LoadingContextType {
  loadingStates: LoadingState[];
  isLoading: (id?: string) => boolean;
  startLoading: (id: string, options?: Partial<Omit<LoadingState, 'id'>>) => void;
  stopLoading: (id: string) => void;
  updateLoading: (id: string, updates: Partial<LoadingState>) => void;
  clearAll: () => void;
  getLoadingState: (id: string) => LoadingState | undefined;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

function loadingReducer(state: LoadingState[], action: LoadingAction): LoadingState[] {
  switch (action.type) {
    case 'ADD_LOADING':
      // Remove existing loading state with same id first
      const filtered = state.filter(loading => loading.id !== action.payload.id);
      return [...filtered, action.payload];

    case 'REMOVE_LOADING':
      return state.filter(loading => loading.id !== action.payload);

    case 'UPDATE_LOADING':
      return state.map(loading =>
        loading.id === action.payload.id
          ? { ...loading, ...action.payload.updates }
          : loading
      );

    case 'CLEAR_ALL':
      return [];

    default:
      return state;
  }
}

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [loadingStates, dispatch] = useReducer(loadingReducer, []);

  const isLoading = useCallback((id?: string) => {
    if (!id) return loadingStates.length > 0;
    return loadingStates.some(loading => loading.id === id);
  }, [loadingStates]);

  const startLoading = useCallback((id: string, options: Partial<Omit<LoadingState, 'id'>> = {}) => {
    const loadingState: LoadingState = {
      id,
      message: options.message,
      progress: options.progress,
      type: options.type || 'spinner'
    };
    dispatch({ type: 'ADD_LOADING', payload: loadingState });
  }, []);

  const stopLoading = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_LOADING', payload: id });
  }, []);

  const updateLoading = useCallback((id: string, updates: Partial<LoadingState>) => {
    dispatch({ type: 'UPDATE_LOADING', payload: { id, updates } });
  }, []);

  const clearAll = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
  }, []);

  const getLoadingState = useCallback((id: string) => {
    return loadingStates.find(loading => loading.id === id);
  }, [loadingStates]);

  const value: LoadingContextType = {
    loadingStates,
    isLoading,
    startLoading,
    stopLoading,
    updateLoading,
    clearAll,
    getLoadingState
  };

  return (
    <LoadingContext.Provider value={value}>
      {children}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }
  return context;
}

// Utility hook for managing loading states in async operations
export function useAsyncLoading() {
  const { startLoading, stopLoading, updateLoading } = useLoading();

  const executeAsync = useCallback(async <T,>(
    id: string,
    asyncFn: () => Promise<T>,
    options: {
      message?: string;
      onProgress?: (progress: number) => void;
      onError?: (error: Error) => void;
    } = {}
  ): Promise<T> => {
    try {
      startLoading(id, {
        message: options.message,
        type: options.onProgress ? 'progress' : 'spinner'
      });

      const result = await asyncFn();

      stopLoading(id);
      return result;
    } catch (error) {
      stopLoading(id);
      if (options.onError && error instanceof Error) {
        options.onError(error);
      }
      throw error;
    }
  }, [startLoading, stopLoading]);

  return { executeAsync };
}

// Hook for managing multiple related loading states
export function useLoadingGroup(baseId: string) {
  const { startLoading, stopLoading, updateLoading, isLoading } = useLoading();

  const startGroupLoading = useCallback((suffix: string, options?: Partial<Omit<LoadingState, 'id'>>) => {
    startLoading(`${baseId}-${suffix}`, options);
  }, [baseId, startLoading]);

  const stopGroupLoading = useCallback((suffix: string) => {
    stopLoading(`${baseId}-${suffix}`);
  }, [baseId, stopLoading]);

  const updateGroupLoading = useCallback((suffix: string, updates: Partial<LoadingState>) => {
    updateLoading(`${baseId}-${suffix}`, updates);
  }, [baseId, updateLoading]);

  const isGroupLoading = useCallback((suffix?: string) => {
    if (!suffix) {
      // Check if any loading state with this base ID is active
      return isLoading(`${baseId}-`);
    }
    return isLoading(`${baseId}-${suffix}`);
  }, [baseId, isLoading]);

  return {
    startGroupLoading,
    stopGroupLoading,
    updateGroupLoading,
    isGroupLoading
  };
}
