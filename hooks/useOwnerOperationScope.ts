"use client";

import { useLayoutEffect, useRef } from 'react';
import { OwnerOperationScope } from '@/lib/owner-operation-scope';

export function useOwnerOperationScope(owner: string | null) {
  const scopeRef = useRef<OwnerOperationScope | null>(null);
  if (!scopeRef.current) scopeRef.current = new OwnerOperationScope(owner);
  const scope = scopeRef.current;
  useLayoutEffect(() => {
    scope.setOwner(owner);
    return () => scope.invalidate();
  }, [owner, scope]);
  return scope;
}
