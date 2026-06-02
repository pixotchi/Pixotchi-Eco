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
      default: 'border-border/80 bg-card text-card-foreground shadow-sm',
      raised: 'border-border/70 bg-card text-card-foreground shadow-[var(--shadow-raised)]',
      inset: 'border-border/60 bg-background/45 text-foreground shadow-[var(--shadow-hairline)]',
      promo: 'border-primary/20 bg-primary/5 text-foreground shadow-sm',
      game: 'border-primary/25 bg-card/85 text-card-foreground shadow-[var(--shadow-control)]',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-[var(--radius-panel)] border',
          surfaceStyles[surface],
          hover && 'transition-all duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:shadow-[var(--shadow-raised)]',
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
        className={cn('flex flex-col space-y-1.5 pb-3', className)}
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
