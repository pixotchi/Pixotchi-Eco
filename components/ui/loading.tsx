import { BaseExpandedLoadingLogo,BaseExpandedLoadingPageLoader,BaseExpandedLoadingSpinner } from './BaseExpandedLoadingLogo';

export function LoadingSpinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <BaseExpandedLoadingSpinner size={size} className={className} />;
}

export function LoadingCard() {
  return (
    <div className="rounded-[var(--radius-panel)] border border-[hsl(var(--border-strong)/0.34)] bg-card/95 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]">
      <div className="animate-pulse">
        <div className="mb-3 h-32 rounded-[var(--radius-control)] bg-muted"></div>
        <div className="space-y-2">
          <div className="h-4 w-3/4 rounded-[calc(var(--radius-control)-0.35rem)] bg-muted"></div>
          <div className="h-3 w-1/2 rounded-[calc(var(--radius-control)-0.35rem)] bg-muted"></div>
        </div>
      </div>
    </div>
  );
}

export function LoadingPlantCard() {
  return (
    <div className="rounded-[var(--radius-panel)] border border-[hsl(var(--border-strong)/0.34)] bg-card/95 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]">
      <div className="animate-pulse">
        <div className="flex items-center space-x-3">
          <div className="h-16 w-16 rounded-[var(--radius-control)] bg-muted"></div>
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 rounded-[calc(var(--radius-control)-0.35rem)] bg-muted"></div>
            <div className="h-3 w-1/2 rounded-[calc(var(--radius-control)-0.35rem)] bg-muted"></div>
            <div className="h-3 w-1/3 rounded-[calc(var(--radius-control)-0.35rem)] bg-muted"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoadingGrid({ count = 6, cardType = 'default' }: { count?: number; cardType?: 'default' | 'plant' }) {
  const CardComponent = cardType === 'plant' ? LoadingPlantCard : LoadingCard;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardComponent key={i} />
      ))}
    </div>
  );
}

export function PageLoader() {
  return <BaseExpandedLoadingPageLoader text="Loading..." />;
}

// Export consistent loading components
export { BaseAnimatedLogo } from './BaseAnimatedLogo';
export { BaseExpandedLoadingPageLoader,BaseExpandedLoadingSpinner,BaseExpandedLoadingPageLoader as BasePageLoader,BaseExpandedLoadingLogo as LoadingLogo };
