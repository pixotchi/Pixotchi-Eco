import type { ReactNode } from 'react';

/** Token choice belongs beside the label so exact amounts keep the whole input row. */
export function SwapAmountLayout({ label, selector, children }: {
  label: ReactNode;
  selector: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full min-w-0 space-y-2">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="min-w-0">{label}</div>
        {selector}
      </div>
      <div className="w-full min-w-0" style={{ containerType: 'inline-size' }}>{children}</div>
    </div>
  );
}

export function swapAmountFontSize(value: string): string {
  // Fit the actual card width, including the narrower tablet column. Keep editable
  // text at least 16px; exceptionally long inputs retain native horizontal editing.
  return `clamp(1rem, calc(100cqi / ${Math.max(1, value.length) * 0.66}), 2.5rem)`;
}
