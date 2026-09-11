"use client";

import { useRef, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { UI_SPRING, useQuietMotion } from "@/lib/motion";

/** Animate meaningful value changes; exact accessible text is never split into digits. */
export function RollingNumber({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const quiet = useQuietMotion();
  const previous = useRef(value);
  const changed = previous.current !== value;
  useEffect(() => {
    previous.current = value;
  }, [value]);
  return (
    <span
      className={`inline-flex items-baseline tabular-nums tracking-tight ${className}`}
      aria-label={value}
    >
      <span aria-hidden="true" className="inline-flex">
        {Array.from(value).map((character, index) => (
          <span
            key={value.length - index}
            className="relative inline-block overflow-hidden align-bottom"
            style={{
              height: "1.25em",
              minWidth: /\d/.test(character) ? ".62em" : undefined,
            }}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={character}
                className="inline-block"
                initial={
                  !quiet && changed && /\d/.test(character)
                    ? { y: "80%", opacity: 0 }
                    : false
                }
                animate={{ y: "0%", opacity: 1 }}
                exit={quiet ? {} : { y: "-80%", opacity: 0 }}
                transition={quiet ? { duration: 0 } : UI_SPRING}
              >
                {character === " " ? "\u00a0" : character}
              </motion.span>
            </AnimatePresence>
          </span>
        ))}
      </span>
    </span>
  );
}
