import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

/*
 * Removed: the `density` prop (zero call sites — every branch resolved to the
 * regular column), the `lg` padding and `inset`/`promo`/`game` surfaces (zero
 * <Card> call sites), and the unnamed role="group" on the inner wrapper (an
 * unnamed group adds a useless node to the accessibility tree on every card).
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  padding?: 'none' | 'sm' | 'md';
  surface?: 'default' | 'raised';
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, hover = false, padding = 'md', surface = 'default', children, ...props }, ref) => {
    const paddingStyles = {
      none: 'p-0',
      sm: 'p-3',
      md: 'p-4',
    };
    const surfaceStyles = {
      default: 'border-[hsl(var(--edge-panel))] bg-card/95 bg-[image:var(--gradient-surface)] text-card-foreground surface-shadow backdrop-blur-md',
      raised: 'border-[hsl(var(--border-strong)/0.4)] bg-card bg-[image:var(--gradient-surface-strong)] text-card-foreground surface-shadow-raised backdrop-blur-md',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-[var(--radius-panel)] border',
          surfaceStyles[surface],
          hover && 'transition-[border-color,background-color,box-shadow] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:shadow-[var(--shadow-raised)]',
          className
        )}
        {...props}
      >
        <div className={cn('h-full w-full flex flex-col', paddingStyles[padding])}>
          {children}
        </div>
      </div>
    );
  }
);

Card.displayName = 'Card';

type TabCardProps = Omit<CardProps, 'surface'>;

const TabCard = forwardRef<HTMLDivElement, TabCardProps>(
  ({ children, ...props }, ref) => (
    <Card ref={ref} surface="raised" {...props}>
      {children}
    </Card>
  )
);

TabCard.displayName = 'TabCard';

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('mb-3 flex flex-col space-y-1.5', className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <h3
        ref={ref}
        className={cn('text-base font-semibold leading-none tracking-normal', className)}
        {...props}
      >
        {children}
      </h3>
    );
  }
);

CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn('text-sm text-muted-foreground', className)}
        {...props}
      >
        {children}
      </p>
    );
  }
);

CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('', className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CardContent.displayName = 'CardContent';

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('flex items-center pt-3', className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CardFooter.displayName = 'CardFooter';

export { Card, TabCard, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
