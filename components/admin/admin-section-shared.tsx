import { useEffect, useRef } from 'react';
import type { AdminConfirmationState } from './admin-confirmation-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export interface AdminSectionProps {
  adminKey: string;
  isActive: boolean;
  showConfirmDialog: (config: Omit<AdminConfirmationState, 'open'>) => void;
}
export const getErrorName = (error: unknown): string => error instanceof Error ? error.name : '';
export const getErrorMessage = (error: unknown): string | undefined => error instanceof Error ? error.message : undefined;
export const sanitizeInput = (input: string, maxLength = 100): string => input.trim().slice(0, maxLength);
export function AdminReadError({ message, onRetry, busy = false }: { message: string | null; onRetry: () => void; busy?: boolean }) {
  if (!message) return null;
  return <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3">
    <span>{message}</span><Button variant="outline" size="sm" onClick={onRetry} disabled={busy}>Retry loading data</Button>
  </AlertDescription></Alert>;
}
export function useAdminAbortController(isActive: boolean) {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!isActive) return;
    const request = new AbortController();
    controller.current = request;
    return () => { request.abort(); controller.current = null; };
  }, [isActive]);
  return controller;
}
export const LoadingSpinner = ({ text }: { text?: string }) => (
  <div className="text-center py-8" role="status">
    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    {text && <p className="mt-2 text-muted-foreground">{text}</p>}
  </div>
);
