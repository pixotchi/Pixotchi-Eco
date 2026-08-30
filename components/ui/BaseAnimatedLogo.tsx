"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { usePerformanceMode } from '@/components/ui/performance-mode'

const BASE_COLORS = [
  '#0033a0',
  '#0090de',
  '#d3bc8d',
  '#ffd700',
  '#5bc500',
  '#8edd65',
  '#ee2737',
  '#fc9bb3'
] as const

const getRandomColor = () => BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)]
const getRandomBoxColors = () => ({
  box1: getRandomColor(),
  box2: getRandomColor(),
  box3: getRandomColor(),
  box4: getRandomColor(),
})

type BoxColors = {
  box1: string
  box2: string
  box3: string
  box4: string
}

interface BaseAnimatedLogoProps {
  className?: string
}

export function BaseAnimatedLogo({ className }: BaseAnimatedLogoProps) {
  const { enabled: performanceModeEnabled } = usePerformanceMode()
  const [isHovered, setIsHovered] = useState(false)
  const [boxColors, setBoxColors] = useState<BoxColors>({
    box1: BASE_COLORS[0],
    box2: BASE_COLORS[1],
    box3: BASE_COLORS[4],
    box4: BASE_COLORS[6],
  })
  // Timers live in refs, not state: they must survive re-renders without causing
  // them, and they must be clearable from an unmount cleanup.
  const colorIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Touch devices synthesize mouseenter after touchstart; ignore that echo so a
  // single tap doesn't both toggle on and immediately restart the animation.
  const lastTouchAtRef = useRef(0)

  const stopColorAnimation = useCallback(() => {
    if (colorIntervalRef.current !== null) {
      clearInterval(colorIntervalRef.current)
      colorIntervalRef.current = null
    }
    if (initialChangeTimeoutRef.current !== null) {
      clearTimeout(initialChangeTimeoutRef.current)
      initialChangeTimeoutRef.current = null
    }
  }, [])

  const handleMouseEnter = () => {
    if (Date.now() - lastTouchAtRef.current < 700) return
    setIsHovered(true)
  }

  const handleMouseLeave = () => {
    if (Date.now() - lastTouchAtRef.current < 700) return
    setIsHovered(false)
    setBoxColors(getRandomBoxColors())
  }

  const handleTouchStart = () => {
    lastTouchAtRef.current = Date.now()
    if (!isHovered) {
      setIsHovered(true)
    } else {
      setIsHovered(false)
      setBoxColors(getRandomBoxColors())
    }
  }

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const syncColorAnimation = () => {
      stopColorAnimation()
      if (!isHovered || performanceModeEnabled || reducedMotion.matches) return

      const changeColors = () => setBoxColors(getRandomBoxColors())
      initialChangeTimeoutRef.current = setTimeout(() => {
        initialChangeTimeoutRef.current = null
        changeColors()
      }, 100)
      colorIntervalRef.current = setInterval(changeColors, 1500)
    }

    syncColorAnimation()
    const unsubscribe = (() => {
      try {
        reducedMotion.addEventListener('change', syncColorAnimation)
        return () => reducedMotion.removeEventListener('change', syncColorAnimation)
      } catch {
        reducedMotion.addListener(syncColorAnimation)
        return () => reducedMotion.removeListener(syncColorAnimation)
      }
    })()
    return () => {
      unsubscribe()
      stopColorAnimation()
    }
  }, [isHovered, performanceModeEnabled, stopColorAnimation])

  return (
    <div className={cn('flex justify-center', className)}>
      <div
        className="relative z-20 h-[60px] w-[200px] cursor-pointer"
        aria-hidden="true"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
      >
        {/* Both marks stay mounted in a fixed footprint. The old width/height
            morph reflowed the About panel and could not be interrupted cleanly. */}
        <svg
                  className={cn(
                    "absolute inset-0 h-full w-full transition-[opacity,scale] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
                    isHovered ? "scale-100 opacity-100" : "pointer-events-none scale-[0.96] opacity-0"
                  )}
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
                    className="transition-[fill] duration-[var(--motion-standard)] ease-[var(--ease-standard)]"
                  />
                  
                  {/* Box 2 - A (Simple rectangle) */}
                  <path 
                    d="M261.442 114.841C261.442 108.393 261.442 105.169 262.654 102.689C263.814 100.314 265.729 98.3943 268.097 97.2311C270.571 96.0162 273.787 96.0162 280.218 96.0162H480.34C486.771 96.0162 489.987 96.0162 492.461 97.2311C494.829 98.3943 496.744 100.314 497.904 102.689C499.116 105.169 499.116 108.393 499.116 114.841V315.475C499.116 321.922 499.116 325.146 497.904 327.626C496.744 330.001 494.829 331.921 492.461 333.084C489.987 334.299 486.771 334.299 480.34 334.299H280.218C273.787 334.299 270.571 334.299 268.097 333.084C265.729 331.921 263.814 330.001 262.654 327.626C261.442 325.146 261.442 321.922 261.442 315.475V114.841Z" 
                    fill={boxColors.box2}
                    className="transition-[fill] duration-[var(--motion-standard)] ease-[var(--ease-standard)]"
                  />
                  
                  {/* Box 3 - S (Simple rectangle) */}
                  <path 
                    d="M522.879 114.848C522.879 108.4 522.879 105.176 524.091 102.696C525.251 100.322 527.166 98.4016 529.534 97.2383C532.008 96.0234 535.224 96.0234 541.655 96.0234H741.777C748.208 96.0234 751.424 96.0234 753.898 97.2383C756.266 98.4016 758.181 100.322 759.341 102.696C760.553 105.176 760.553 108.4 760.553 114.848V315.482C760.553 321.93 760.553 325.153 759.341 327.633C758.181 330.008 756.266 331.928 753.898 333.091C751.424 334.306 748.208 334.306 741.777 334.306H541.655C535.224 334.306 532.008 334.306 529.534 333.091C527.166 331.928 525.251 330.008 524.091 327.633C522.879 325.153 522.879 321.93 522.879 315.482V114.848Z" 
                    fill={boxColors.box3}
                    className="transition-[fill] duration-[var(--motion-standard)] ease-[var(--ease-standard)]"
                  />
                  
                  {/* Box 4 - E (Simple rectangle) */}
                  <path 
                    d="M784.326 114.841C784.326 108.393 784.326 105.169 785.537 102.689C786.698 100.314 788.613 98.3943 790.981 97.2311C793.455 96.0162 796.67 96.0162 803.102 96.0162H1003.22C1009.66 96.0162 1012.87 96.0162 1015.34 97.2311C1017.71 98.3943 1019.63 100.314 1020.79 102.689C1022 105.169 1022 108.393 1022 114.841V315.475C1022 321.922 1022 325.146 1020.79 327.626C1019.63 330.001 1017.71 331.921 1015.34 333.084C1012.87 334.299 1009.66 334.299 1003.22 334.299H803.102C796.67 334.299 793.455 334.299 790.981 333.084C788.613 331.921 786.698 330.001 785.537 327.626C784.326 325.146 784.326 321.922 784.326 315.475V114.841Z" 
                    fill={boxColors.box4}
                    className="transition-[fill] duration-[var(--motion-standard)] ease-[var(--ease-standard)]"
                  />
        </svg>

        <div
          className={cn(
            "base-logo-corner absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 bg-[#0000ff] transition-[opacity,scale] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
            isHovered ? "scale-[0.96] opacity-0" : "scale-100 opacity-100"
          )}
        />
      </div>
    </div>
  )
}
