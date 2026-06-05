import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  density?: 'compact' | 'regular' | 'spacious';
  hover?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  surface?: 'default' | 'raised' | 'inset' | 'promo' | 'game';
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, density = 'regular', hover = false, padding = 'md', surface = 'default', children, ...props }, ref) => {
    const paddingStyles = {
      none: 'p-0',
      sm: density === 'compact' ? 'p-2.5' : 'p-3',
      md: density === 'compact' ? 'p-3' : density === 'spacious' ? 'p-5' : 'p-4',
      lg: density === 'compact' ? 'p-4' : density === 'spacious' ? 'p-7' : 'p-6',
    };
    const surfaceStyles = {
      default: 'border-border/60 bg-card/95 bg-[image:var(--gradient-surface)] text-card-foreground surface-shadow backdrop-blur-md',
      raised: 'border-border/65 bg-card bg-[image:var(--gradient-surface-strong)] text-card-foreground surface-shadow-raised backdrop-blur-md',
      inset: 'border-border/60 bg-secondary/80 bg-[image:var(--gradient-panel)] text-foreground surface-inset',
      promo: 'border-primary/25 bg-primary/10 bg-[image:var(--gradient-selection)] text-foreground surface-shadow',
      game: 'border-border/60 bg-card/95 bg-[image:var(--gradient-surface)] text-card-foreground surface-shadow',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-[var(--radius-panel)] border',
          surfaceStyles[surface],
          hover && 'transition-[border-color,background-color,box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-[var(--shadow-raised)]',
          className
        )}
        {...props}
      >
        <div className={cn('h-full w-full flex flex-col', paddingStyles[padding])} role="group">
          {children}
        </div>
      </div>
    );
  }
);

Card.displayName = 'Card';

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

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }; 
