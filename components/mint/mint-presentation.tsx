import type { ReactNode } from 'react';
import Image from 'next/image';
import type { Strain } from '@/lib/types';
import { formatNumber } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/** Wallets share selection and review presentation; their submission controllers stay independent. */
export function MintStrainPicker({ strains, selectedId, onSelect, imageForStrain, pending, isSolana = false }: {
  strains: readonly Strain[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  imageForStrain: (id: number) => string;
  pending: boolean;
  isSolana?: boolean;
}) {
  return <section aria-label="Choose a strain" className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold">Strain</h3>
      <span className="text-xs text-muted-foreground">{strains.length} options</span>
    </div>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
      {strains.map(strain => {
        const remaining = Math.max(0, strain.maxSupply - strain.totalMinted);
        const soldOut = remaining === 0;
        const baseOnly = isSolana && ['FLORA', 'TYJ'].includes(strain.name.toUpperCase());
        const disabled = !strain.isActive || soldOut || baseOnly || pending;
        return <button key={strain.id} type="button" disabled={disabled} aria-pressed={selectedId === strain.id}
          onClick={() => { if (!disabled) onSelect(strain.id); }}
          className={`flex min-h-[58px] min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left transition-[background-color,border-color,color,opacity,scale] duration-[var(--motion-quick)] ease-[var(--ease-standard)] active:scale-[0.985] focus-visible:active:scale-100 focus-visible:transition-none motion-reduce:active:scale-100 motion-reduce:active:opacity-90 [.motion-off_&]:active:scale-100 [.motion-off_&]:active:opacity-90 [.performance-mode_&]:active:scale-100 [.performance-mode_&]:active:opacity-90 disabled:scale-100 disabled:opacity-50 ${selectedId === strain.id ? 'border-primary/50 bg-primary/10' : 'border-border/60 bg-transparent hover:bg-[hsl(var(--nav-hover-bg))]'}`}>
          <Image src={imageForStrain(strain.id)} alt="" width={28} height={28} className="shrink-0" unoptimized />
          <span className="min-w-0 flex-1 basis-[4rem] [overflow-wrap:anywhere]">
            <span className="block text-sm font-pixel">{strain.name}</span>
            {soldOut ? <Badge variant="danger" className="min-h-0 whitespace-nowrap py-0.5">Sold</Badge>
              : baseOnly ? <Badge variant="chain" className="min-h-0 whitespace-nowrap py-0.5">Base</Badge>
              : !strain.isActive ? <span className="block text-xs text-muted-foreground">Unavailable</span>
              : <span className="block text-xs text-muted-foreground">{formatNumber(remaining)} left</span>}
          </span>
        </button>;
      })}
    </div>
  </section>;
}

export function MintReview({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return <section aria-label={label} className="surface-group min-w-0 space-y-3">
    <h3 className="mb-3 text-base font-semibold">Confirm Mint</h3>
    {description && <p className="mb-3 text-sm text-muted-foreground">{description}</p>}
    {children}
  </section>;
}

export function MintLandSummary({ price, availability }: { price: ReactNode; availability: ReactNode }) {
  return <div aria-label="Land mint details" className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
    <Image src="/icons/village-start.png" alt="Land" width={66} height={66} className="shrink-0 object-contain" />
    <div className="min-w-[min(100%,8rem)] flex-1 space-y-2 [overflow-wrap:anywhere]">
      <div>
        <div className="text-muted-foreground">Price</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-sm font-semibold">{price}</div>
      </div>
      <div>
        <div className="text-muted-foreground">Available</div>
        <div className="mt-1 text-sm font-semibold tabular-nums">{availability}</div>
      </div>
    </div>
  </div>;
}
