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
    const base = 'rounded-[var(--radius-panel)] border border-border/65 shadow-[var(--shadow-hairline)]';
    const surface = variant === 'muted' ? 'bg-muted/80' : variant === 'transparent' ? 'bg-transparent border-transparent shadow-none' : 'bg-card/95';
    return (
      <div ref={ref} className={cn(base, surface, paddingMap[padding], className)} {...props}>
        {children}
      </div>
    );
  }
);

StandardContainer.displayName = 'StandardContainer';

export { StandardContainer };
