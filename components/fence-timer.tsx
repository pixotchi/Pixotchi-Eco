"use client";

import Image from 'next/image';
import { useCountdown } from '@/hooks/useCountdown';
import { useEffect, useState } from 'react';

interface FenceTimerProps {
  effectUntil: number; // Unix timestamp in seconds
  className?: string;
  noBackground?: boolean;
  label?: string;
  fallbackText?: string; // Text to show when timer expires or invalid
  showIcon?: boolean; // Control whether to show the shield icon
}

export default function FenceTimer({
  effectUntil,
  className = "",
  noBackground = false,
  label,
  fallbackText = "Expired",
  showIcon = true,
}: FenceTimerProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isValidTimestamp, setIsValidTimestamp] = useState(true);
  
  // Validate timestamp on mount and when effectUntil changes
  useEffect(() => {
    setIsMounted(true);
    
    // Check if timestamp is valid
    const currentTime = Math.floor(Date.now() / 1000);
    const isFuture = effectUntil > currentTime;
    const isReasonable = effectUntil < currentTime + 365 * 24 * 60 * 60; // Within 1 year
    
    setIsValidTimestamp(
      typeof effectUntil === 'number' && 
      !isNaN(effectUntil) && 
      effectUntil > 0 && 
      isFuture && 
      isReasonable
    );
  }, [effectUntil]);

  const timeRemaining = useCountdown(isValidTimestamp ? effectUntil : 0);
  
  // Check if timer has expired
  const hasExpired = timeRemaining === '0:00:00' || timeRemaining === fallbackText || !isValidTimestamp;
  
  const baseClasses = `flex items-center rounded-full font-semibold space-x-2 transition-all duration-200`;
  
  const backgroundClasses = noBackground 
    ? "text-foreground" 
    : hasExpired
      ? "bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400 p-3 border border-gray-200 dark:border-gray-800 rounded-md"
      : "bg-blue-500/10 text-blue-600 dark:text-blue-400 p-3 border border-blue-500/20 dark:border-blue-400/20 rounded-md";

  // Handle server-side rendering
  if (!isMounted) {
    return (
      <div className={`${baseClasses} ${backgroundClasses} ${className} animate-pulse`}>
        {showIcon && (
          <div className="w-4 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
        )}
        <div className="flex flex-col leading-none">
          {label && <span className="text-xs font-medium text-foreground/70 dark:text-foreground/60">{label}</span>}
          <span className="w-16 h-5 bg-gray-300 dark:bg-gray-700 rounded"></span>
        </div>
      </div>
    );
  }

  // Handle invalid timestamps
  if (!isValidTimestamp) {
    return (
      <div className={`${baseClasses} ${backgroundClasses} ${className}`}>
        {showIcon && (
          <Image 
            src="/icons/Shield.svg" 
            alt="Fence Protection Expired" 
            width={16} 
            height={16} 
            className="w-4 h-4 opacity-50"
          />
        )}
        <div className="flex flex-col leading-none">
          {label && <span className="text-xs font-medium text-foreground/70 dark:text-foreground/60">{label}</span>}
          <span className="text-sm">{fallbackText}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${baseClasses} ${backgroundClasses} ${className}`}>
      {showIcon && (
        <Image 
          src="/icons/Shield.svg" 
          alt="Fence Protection" 
          width={16} 
          height={16} 
          className={`w-4 h-4 ${hasExpired ? 'opacity-50' : ''}`}
          onError={(e) => {
            // Fallback if image fails to load
            const target = e.currentTarget;
            target.style.display = 'none';
            console.warn('Shield icon failed to load');
          }}
        />
      )}
      <div className="flex flex-col leading-none">
        {label && (
          <span className="text-xs font-medium text-foreground/70 dark:text-foreground/60">
            {label}
          </span>
        )}
        <span className={hasExpired ? 'line-through' : ''}>
          {hasExpired ? fallbackText : timeRemaining}
        </span>
      </div>
      
      {/* Optional warning for very short times */}
      {!hasExpired && timeRemaining && timeRemaining.includes('00:0') && (
        <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
          !
        </span>
      )}
    </div>
  );
}
