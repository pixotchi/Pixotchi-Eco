'use client';

import { useId } from 'react';
import { getAssetNameValidation, type RenameAssetType } from '@/lib/asset-name-rules';
import { Input } from '@/components/ui/input';

/** Preserve the player's complete draft; the contract limit only gates submission. */
export function AssetNameField({ asset, assetId, value, onChange, disabled, currentName }: {
  asset: RenameAssetType; assetId: string | number; value: string; onChange: (value: string) => void;
  disabled?: boolean; currentName: string;
}) {
  const id = useId();
  const validation = getAssetNameValidation(asset, value);
  const error = validation.isBlank ? 'Enter a name, such as Sunny.'
    : validation.isTooShort ? 'This name is too short. Add another letter or number.'
    : validation.isTooLong ? 'This name is too long. Shorten it; accented letters and emoji use more space.' : null;
  const unchanged = !error && value.trim() === currentName.trim();
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <label htmlFor={id} className="font-semibold">New name</label>
      <span className="text-muted-foreground">{asset === 'plant' ? 'Plant' : 'Land'} #{assetId}</span>
    </div>
    <Input id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
      placeholder="For example, Sunny" autoComplete="off" className="w-full font-semibold tracking-tight"
      aria-invalid={Boolean(error)} aria-describedby={`${id}-help ${id}-feedback`} />
    <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">Up to {validation.maxBytes} basic letters or numbers. Accented letters and emoji use more space.</p>
    <p id={`${id}-feedback`} role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
      {error ?? (unchanged ? 'Choose a different name to make a change.' : 'This name fits.')}
    </p>
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer py-1">Exact name limits</summary>
      <p className="mt-1 leading-relaxed">Names use {validation.minBytes}–{validation.maxBytes} UTF-8 bytes. Your name uses {validation.byteLength}. Spaces at either end are ignored.</p>
    </details>
  </div>;
}
