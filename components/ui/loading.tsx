import { cn } from '@/lib/utils';
import { BaseExpandedLoadingLogo, BaseExpandedLoadingPageLoader, BaseExpandedLoadingSpinner } from './BaseExpandedLoadingLogo';

export function LoadingSpinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <BaseExpandedLoadingSpinner size={size} className={className} />;
}

export function LoadingCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="animate-pulse">
        <div className="h-32 bg-muted rounded-lg mb-3"></div>
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-3 bg-muted rounded w-1/2"></div>
        </div>
      </div>
    </div>
  );
}

export function LoadingPlantCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="animate-pulse">
        <div className="flex items-center space-x-3">
          <div className="w-16 h-16 bg-muted rounded-lg"></div>
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-3 bg-muted rounded w-1/2"></div>
            <div className="h-3 bg-muted rounded w-1/3"></div>
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
export { BaseExpandedLoadingLogo as LoadingLogo, BaseExpandedLoadingPageLoader as BasePageLoader, BaseExpandedLoadingPageLoader, BaseExpandedLoadingSpinner };
export { BaseAnimatedLogo } from './BaseAnimatedLogo'; 