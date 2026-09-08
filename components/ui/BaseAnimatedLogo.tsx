"use client";

import React, { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { BaseMark } from './base-mark'
import { useBaseMarkColors } from '@/hooks/useBaseMarkColors'

interface BaseAnimatedLogoProps {
  className?: string
}

export function BaseAnimatedLogo({ className }: BaseAnimatedLogoProps) {
  const [isHovered, setIsHovered] = useState(false)
  const boxColors = useBaseMarkColors(isHovered)
  // Touch devices synthesize mouseenter after touchstart; ignore that echo so a
  // single tap doesn't both toggle on and immediately restart the animation.
  const lastTouchAtRef = useRef(0)

  const handleMouseEnter = () => {
    if (Date.now() - lastTouchAtRef.current < 700) return
    setIsHovered(true)
  }

  const handleMouseLeave = () => {
    if (Date.now() - lastTouchAtRef.current < 700) return
    setIsHovered(false)
  }

  const handleTouchStart = () => {
    lastTouchAtRef.current = Date.now()
    if (!isHovered) {
      setIsHovered(true)
    } else {
      setIsHovered(false)
    }
  }


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
        <BaseMark colors={boxColors} className={cn(
          "absolute inset-0 transition-[opacity,scale] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
          isHovered ? "scale-100 opacity-100" : "pointer-events-none scale-[0.96] opacity-0"
        )} />

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
