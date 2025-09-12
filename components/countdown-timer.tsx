"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useCountdown } from '@/hooks/useCountdown';

interface CountdownTimerProps {
  timeUntilStarving: number; // Unix timestamp
  className?: string;
  noBackground?: boolean;
}

export default function CountdownTimer({ 
  timeUntilStarving, 
  className = "",
  noBackground = false 
}: CountdownTimerProps) {
  const timeRemaining = useCountdown(timeUntilStarving);

  const baseClasses = `flex items-center rounded-full font-semibold space-x-1`;
  const backgroundClasses = noBackground 
    ? "text-foreground" 
    : "bg-primary/10 text-primary p-3 border border-primary/20 rounded-md";

  return (
    <div className={`${baseClasses} ${backgroundClasses} ${className}`}>
      <Image src="/icons/tod.svg" alt="Time of Death" width={16} height={16} className="w-4 h-4" />
      <span>{timeRemaining}</span>
    </div>
  );
} 