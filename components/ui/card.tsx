import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

/** Card owns padding on its root. Header and Content add no horizontal padding. */
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
      default: 'surface-panel',
      raised: 'surface-panel shadow-[var(--shadow-hairline)]',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'flex min-w-0 flex-col rounded-[var(--radius-panel)] border',
          paddingStyles[padding],
          surfaceStyles[surface],
          hover && 'transition-[border-color,background-color,box-shadow] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:shadow-[var(--shadow-raised)]',
          className
        )}
        {...props}
      >
        {children}
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
        className={cn('type-section-title', className)}
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
        className={cn('type-body text-muted-foreground', className)}
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

export { Card, TabCard, CardHeader, CardTitle, CardDescription, CardContent };
