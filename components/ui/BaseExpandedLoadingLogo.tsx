"use client";

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface BaseExpandedLoadingLogoProps {
  className?: string;
  text?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function BaseExpandedLoadingLogo({ className, text, size = 'md' }: BaseExpandedLoadingLogoProps) {
  const randomColors = [
    '#0033a0',
    '#0090de', 
    '#d3bc8d',
    '#ffd700',
    '#5bc500',
    '#8edd65',
    '#ee2737',
    '#fc9bb3'
  ];

  const getRandomColor = () => randomColors[Math.floor(Math.random() * randomColors.length)];

  const [boxColors, setBoxColors] = useState({
    box1: getRandomColor(), // Random starting color
    box2: getRandomColor(), // Random starting color
    box3: getRandomColor(), // Random starting color  
    box4: getRandomColor()  // Random starting color
  });

  const sizeStyles = {
    sm: 'w-20 h-7',
    md: 'w-32 h-11', 
    lg: 'w-48 h-16',
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  // Auto-animate colors continuously (respect reduced motion)
  useEffect(() => {
    const changeColors = () => {
      setBoxColors({
        box1: getRandomColor(),
        box2: getRandomColor(),
        box3: getRandomColor(),
        box4: getRandomColor()
      });
    };

    // Start with immediate color change
    const initialTimeout = setTimeout(changeColors, 100);
    
    // Continue with calmer color changes; slower if prefers-reduced-motion
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const interval = setInterval(changeColors, prefersReduced ? 2500 : 1500);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className={cn('flex flex-col items-center justify-center', className)}>
      <div className={cn('relative overflow-visible', sizeStyles[size])}>
        {/* Always show expanded BASE logo with rapid color animation */}
        <svg 
          className="h-full w-full transition-all duration-100"
          width="1022" 
          height="335" 
          viewBox="0 0 1022 335" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Box 1 - B (Complex shape with notch) */}
          <path 
            d="M1.21181 7.37576C0 9.85571 0 13.0796 0 19.5275V315.475C0 321.922 0 325.146 1.21181 327.626C2.37207 330.001 4.28722 331.921 6.65561 333.084C9.12922 334.299 12.3449 334.299 18.7763 334.299H218.898C225.33 334.299 228.545 334.299 231.019 333.084C233.387 331.921 235.302 330.001 236.463 327.626C237.674 325.146 237.674 321.922 237.674 315.475V114.841C237.674 108.393 237.674 105.169 236.463 102.689C235.302 100.314 233.387 98.3943 231.019 97.2311C228.545 96.0162 225.33 96.0162 218.898 96.0162H113.846C107.415 96.0162 104.199 96.0162 101.725 94.8013C99.357 93.638 97.4418 91.718 96.2816 89.3435C95.0698 86.8636 95.0698 83.6397 95.0698 77.1918V19.5275C95.0698 13.0796 95.0698 9.85571 93.858 7.37576C92.6977 5.00131 90.7825 3.08127 88.4142 1.91804C85.9405 0.703125 82.7249 0.703125 76.2935 0.703125H18.7763C12.3449 0.703125 9.12922 0.703125 6.65561 1.91804C4.28722 3.08127 2.37207 5.00131 1.21181 7.37576Z" 
            fill={boxColors.box1}
            className="transition-colors duration-100 ease-in-out"
          />
          
          {/* Box 2 - A (Simple rectangle) */}
          <path 
            d="M261.442 114.841C261.442 108.393 261.442 105.169 262.654 102.689C263.814 100.314 265.729 98.3943 268.097 97.2311C270.571 96.0162 273.787 96.0162 280.218 96.0162H480.34C486.771 96.0162 489.987 96.0162 492.461 97.2311C494.829 98.3943 496.744 100.314 497.904 102.689C499.116 105.169 499.116 108.393 499.116 114.841V315.475C499.116 321.922 499.116 325.146 497.904 327.626C496.744 330.001 494.829 331.921 492.461 333.084C489.987 334.299 486.771 334.299 480.34 334.299H280.218C273.787 334.299 270.571 334.299 268.097 333.084C265.729 331.921 263.814 330.001 262.654 327.626C261.442 325.146 261.442 321.922 261.442 315.475V114.841Z" 
            fill={boxColors.box2}
            className="transition-colors duration-100 ease-in-out"
          />
          
          {/* Box 3 - S (Simple rectangle) */}
          <path 
            d="M522.879 114.848C522.879 108.4 522.879 105.176 524.091 102.696C525.251 100.322 527.166 98.4016 529.534 97.2383C532.008 96.0234 535.224 96.0234 541.655 96.0234H741.777C748.208 96.0234 751.424 96.0234 753.898 97.2383C756.266 98.4016 758.181 100.322 759.341 102.696C760.553 105.176 760.553 108.4 760.553 114.848V315.482C760.553 321.93 760.553 325.153 759.341 327.633C758.181 330.008 756.266 331.928 753.898 333.091C751.424 334.306 748.208 334.306 741.777 334.306H541.655C535.224 334.306 532.008 334.306 529.534 333.091C527.166 331.928 525.251 330.008 524.091 327.633C522.879 325.153 522.879 321.93 522.879 315.482V114.848Z" 
            fill={boxColors.box3}
            className="transition-colors duration-100 ease-in-out"
          />
          
          {/* Box 4 - E (Simple rectangle) */}
          <path 
            d="M784.326 114.841C784.326 108.393 784.326 105.169 785.537 102.689C786.698 100.314 788.613 98.3943 790.981 97.2311C793.455 96.0162 796.67 96.0162 803.102 96.0162H1003.22C1009.66 96.0162 1012.87 96.0162 1015.34 97.2311C1017.71 98.3943 1019.63 100.314 1020.79 102.689C1022 105.169 1022 108.393 1022 114.841V315.475C1022 321.922 1022 325.146 1020.79 327.626C1019.63 330.001 1017.71 331.921 1015.34 333.084C1012.87 334.299 1009.66 334.299 1003.22 334.299H803.102C796.67 334.299 793.455 334.299 790.981 333.084C788.613 331.921 786.698 330.001 785.537 327.626C784.326 325.146 784.326 321.922 784.326 315.475V114.841Z" 
            fill={boxColors.box4}
            className="transition-colors duration-100 ease-in-out"
          />
        </svg>
      </div>
      
      {text && (
        <p className={cn('mt-3 text-muted-foreground font-medium', textSizes[size])}>
          {text}
        </p>
      )}
    </div>
  );
}

export function BaseExpandedLoadingPageLoader({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <BaseExpandedLoadingLogo size="lg" text={text} />
    </div>
  );
}

export function BaseExpandedLoadingSpinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <BaseExpandedLoadingLogo size={size} className={className} />;
} 