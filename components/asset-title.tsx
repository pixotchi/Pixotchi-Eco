import type { ReactNode } from 'react';

/** Equal side columns keep the asset name centered independently of its edit control. */
export function AssetTitle({ name, edit }: { name: string; edit: ReactNode }) {
  return <div className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-1">
    <span aria-hidden="true" />
    <h3 className="min-w-0 text-center font-semibold tracking-tight text-base leading-relaxed [overflow-wrap:anywhere]">{name}</h3>
    <div className="flex justify-center">{edit}</div>
  </div>;
}
