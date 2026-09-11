import Image from 'next/image';

/** A small, static growth story made from the game's own collectible art. */
export function GardenPreview({ compact = false }: { compact?: boolean }) {
  return <div className={`garden-preview ${compact ? 'garden-preview-compact' : ''}`} aria-label="Plant, care, grow and earn ETH rewards" role="img">
    {[{ level: 2, label: 'Plant' }, { level: 10, label: 'Care' }, { level: 20, label: 'Grow' }].map(({ level, label }) =>
      <div key={level} className="garden-preview-stage" aria-hidden="true">
        <Image src={`/ipfs/strain1/${level}.svg`} alt="" width={112} height={112} preload={level === 20} className="h-full w-full object-contain [image-rendering:pixelated]" />
        <span>{label}</span>
      </div>
    )}
    <div className="garden-preview-stage garden-preview-reward" aria-hidden="true">
      <div className="garden-preview-reward-art">
        <Image src="/icons/ethlogo.svg" alt="" width={112} height={112} className="object-contain [image-rendering:pixelated]" />
      </div>
      <span>Earn ETH</span>
    </div>
  </div>;
}
