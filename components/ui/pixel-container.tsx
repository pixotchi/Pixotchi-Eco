import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface StandardContainerProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'muted' | 'transparent';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingMap = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const StandardContainer = forwardRef<HTMLDivElement, StandardContainerProps>(
  ({ className = '', variant = 'default', padding = 'md', children, ...props }, ref) => {
    const base = 'rounded-lg border border-border shadow-sm';
    const surface = variant === 'muted' ? 'bg-muted' : variant === 'transparent' ? 'bg-transparent border-transparent shadow-none' : 'bg-card';
    return (
      <div ref={ref} className={cn(base, surface, paddingMap[padding], className)} {...props}>
        {children}
      </div>
    );
  }
);

StandardContainer.displayName = 'StandardContainer';

export { StandardContainer };