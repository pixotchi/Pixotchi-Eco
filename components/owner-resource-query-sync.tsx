'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onOwnerResourceInvalidation } from '@/lib/owner-resource-invalidation';
import { invalidateOwnerResourceQueries } from '@/lib/owner-resource-query-cache';

export function OwnerResourceQuerySync() {
  const client = useQueryClient();
  useEffect(() => onOwnerResourceInvalidation(async (detail) => {
    try {
      await invalidateOwnerResourceQueries(client, detail);
    } catch (error) {
      // Query state retains the error for the screen's normal retry UI.
      console.warn('Owner query refresh failed:', error);
    }
  }), [client]);
  return null;
}
