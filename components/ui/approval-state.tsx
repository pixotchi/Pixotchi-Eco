import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

export type ApprovalReadState = 'loading' | 'error' | 'approved' | 'required';

/** Read states are information. Only the required state presents a transaction. */
export function ApprovalState({ label, state, children }: { label: string; state: ApprovalReadState; children: ReactNode }) {
  if (state === 'required') return <>{children}</>;
  return <p role="status" className={`flex min-h-11 min-w-0 items-center gap-2 py-2 text-sm ${state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
    {state === 'approved' && <Check className="h-4 w-4 shrink-0 text-[hsl(var(--success-strong))]" aria-hidden="true" />}
    {state === 'approved' ? `${label} approved` : state === 'loading' ? `Checking ${label.toLowerCase()} approval…` : `${label} approval unavailable. Retry the check above.`}
  </p>;
}
