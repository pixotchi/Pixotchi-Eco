"use client";

import Image from 'next/image';
import { useCountdown } from '@/hooks/useCountdown';

interface FenceTimerProps {
  effectUntil: number; // Unix timestamp in seconds
  className?: string;
  noBackground?: boolean;
  label?: string;
}

export default function FenceTimer({
  effectUntil,
  className = "",
  noBackground = false,
  label,
}: FenceTimerProps) {
  const timeRemaining = useCountdown(effectUntil);

  const baseClasses = `flex items-center rounded-full font-semibold space-x-2`;
  const backgroundClasses = noBackground 
    ? "text-foreground" 
    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 p-3 border border-blue-500/20 dark:border-blue-400/20 rounded-md";

  return (
    <div className={`${baseClasses} ${backgroundClasses} ${className}`}>
      <Image src="/icons/Shield.svg" alt="Fence Protection" width={16} height={16} className="w-4 h-4" />
      <div className="flex flex-col leading-none">
        {label && <span className="text-xs font-medium text-foreground/70 dark:text-foreground/60">{label}</span>}
        <span>{timeRemaining}</span>
      </div>
    </div>
  );
}