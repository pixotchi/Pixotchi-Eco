"use client";

import Image from 'next/image';
import { useCountdown } from '@/hooks/useCountdown';

interface FenceTimerProps {
  effectUntil: number; // Unix timestamp
  className?: string;
  noBackground?: boolean;
}

export default function FenceTimer({ 
  effectUntil, 
  className = "",
  noBackground = false 
}: FenceTimerProps) {
  const timeRemaining = useCountdown(effectUntil);

  const baseClasses = `flex items-center rounded-full font-semibold space-x-1`;
  const backgroundClasses = noBackground 
    ? "text-foreground" 
    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 p-3 border border-blue-500/20 dark:border-blue-400/20 rounded-md";

  return (
    <div className={`${baseClasses} ${backgroundClasses} ${className}`}>
      <Image src="/icons/Shield.svg" alt="Fence Protection" width={16} height={16} className="w-4 h-4" />
      <span>{timeRemaining}</span>
    </div>
  );
}