'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { ChatMode } from '@/lib/types';
import { useOwnerOperationScope } from './useOwnerOperationScope';

/** Principal and request identity jointly own a history result, including A→B→A. */
export function useChatHistoryRequests(principal: string) {
  const scope = useOwnerOperationScope(principal);
  const requests = useRef<Partial<Record<ChatMode, AbortController>>>({});
  const invalidate = useCallback((mode?: ChatMode) => {
    for (const key of mode ? [mode] : ['public', 'ai'] as const) {
      requests.current[key]?.abort();
      delete requests.current[key];
    }
  }, []);
  useLayoutEffect(() => { invalidate(); return () => invalidate(); }, [principal, invalidate]);
  const begin = useCallback((mode: ChatMode) => {
    if (requests.current[mode]) return null;
    const operation = scope.capture();
    const controller = new AbortController();
    requests.current[mode] = controller;
    return {
      signal: controller.signal,
      isCurrent: () => operation.isCurrent() && !controller.signal.aborted && requests.current[mode] === controller,
      finish: () => { if (requests.current[mode] === controller) delete requests.current[mode]; },
    };
  }, [scope]);
  return useMemo(() => ({ begin, invalidate }), [begin, invalidate]);
}
