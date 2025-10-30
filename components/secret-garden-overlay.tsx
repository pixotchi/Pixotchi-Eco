"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

type SecretGardenOverlayProps = {
  open: boolean;
  onClose: () => void;
  debug?: boolean;
};

type SecretCellStyle = CSSProperties & {
  "--o"?: number | string;
  "--r"?: number | string;
  "--pixel-color"?: string;
};

const PIXOTCHI_PATTERN = [
  ".....................",
  "..........F.....A....",
  ".........FFF....AAAA.",
  "........FFGFF........",
  ".........FFF.........",
  "..........F..........",
  "......LL..P..........",
  ".......LLLP..........",
  "..........P.LLL......",
  "..........PLL........",
  ".......LL.P..........",
  "........LLP..........",
  "..........P.L........",
  "..........PL.........",
  ".....PPPPPPPPPPP.....",
  "......RRRRRRRRR......",
  "......RRRRRRRRR......",
  ".......RRRRRRR.......",
  "........RRRRR........",
  ".....................",
  ".....................",
];

const COLOR_MAP: Record<string, { color: string; opacity: number }> = {
  ".": { color: "#1f2937", opacity: 0.05 },
  L: { color: "#4ade80", opacity: 0.85 },
  F: { color: "#ff69b4", opacity: 0.85 },
  G: { color: "#ffff00", opacity: 0.85 },
  P: { color: "#fddcb1", opacity: 0.92 },
  R: { color: "#d18c3b", opacity: 0.9 },
  A: { color: "#0000ff", opacity: 0.95 },
};

const SECRET_CELLS = PIXOTCHI_PATTERN.flatMap((row, rowIndex) =>
  row.split("").map((symbol, colIndex) => {
    const palette = COLOR_MAP[symbol] ?? COLOR_MAP["."];
    const opacity = palette.opacity;
    const rotationQuarterTurns = (rowIndex * 7 + colIndex * 3) % 4;

    const style: SecretCellStyle = {
      "--o": opacity,
      "--r": rotationQuarterTurns,
      "--pixel-color": palette.color,
    };

    return {
      id: `${rowIndex}-${colIndex}`,
      symbol,
      style,
    };
  })
);

const GRID_COLUMNS = PIXOTCHI_PATTERN[0]?.length ?? 0;
const GRID_ROWS = PIXOTCHI_PATTERN.length;
const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function SecretGardenOverlay({ open, onClose, debug = false }: SecretGardenOverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [artVisible, setArtVisible] = useState(false);
  const [initialReveal, setInitialReveal] = useState(true);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lastHoveredRef = useRef<HTMLElement | null>(null);
  const debugIndicatorRef = useRef<HTMLDivElement | null>(null);
  const initialRevealRef = useRef(initialReveal);
  const headingId = useId();
  const descriptionId = useId();

  const handleRevealStart = useCallback(() => {
    if (!initialRevealRef.current) {
      return;
    }
    initialRevealRef.current = false;
    setInitialReveal(false);
    if (debug) {
      const indicator = debugIndicatorRef.current;
      if (indicator) {
        indicator.style.opacity = "1";
      }
    }
  }, [debug]);

  const clearHover = useCallback(() => {
    const previous = lastHoveredRef.current;
    if (previous) {
      previous.removeAttribute("data-hover");
      lastHoveredRef.current = null;
    }
    if (debug) {
      const indicator = debugIndicatorRef.current;
      if (indicator) {
        indicator.style.opacity = "0";
      }
    }
  }, [debug]);

  const updateHoverFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const grid = gridRef.current;
      if (!grid) {
        return;
      }

      const rect = grid.getBoundingClientRect();
      if (debug) {
        const indicator = debugIndicatorRef.current;
        if (indicator) {
          indicator.style.transform = `translate(${clientX}px, ${clientY}px)`;
          indicator.style.opacity = "1";
        }
      }
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;

      if (
        relativeX < 0 ||
        relativeY < 0 ||
        relativeX >= rect.width ||
        relativeY >= rect.height
      ) {
        clearHover();
        if (debug) {
          const indicator = debugIndicatorRef.current;
          if (indicator) {
            indicator.style.opacity = "0";
          }
        }
        return;
      }

      const cellWidth = rect.width / GRID_COLUMNS;
      const cellHeight = rect.height / GRID_ROWS;

      if (cellWidth <= 0 || cellHeight <= 0) {
        clearHover();
        if (debug) {
          const indicator = debugIndicatorRef.current;
          if (indicator) {
            indicator.style.opacity = "0";
          }
        }
        return;
      }

      const column = Math.floor(relativeX / cellWidth);
      const row = Math.floor(relativeY / cellHeight);

      if (
        column < 0 ||
        column >= GRID_COLUMNS ||
        row < 0 ||
        row >= GRID_ROWS
      ) {
        clearHover();
        if (debug) {
          const indicator = debugIndicatorRef.current;
          if (indicator) {
            indicator.style.opacity = "0";
          }
        }
        return;
      }

      const index = row * GRID_COLUMNS + column;
      const target = grid.children[index] as HTMLElement | undefined;

      if (!target || target.dataset.pixel !== "true") {
        clearHover();
        if (debug) {
          const indicator = debugIndicatorRef.current;
          if (indicator) {
            indicator.style.opacity = "0";
          }
        }
        return;
      }

      if (lastHoveredRef.current !== target) {
        lastHoveredRef.current?.removeAttribute("data-hover");
        target.setAttribute("data-hover", "true");
        lastHoveredRef.current = target;
      }
      if (debug) {
        const indicator = debugIndicatorRef.current;
        if (indicator) {
          indicator.style.opacity = "1";
        }
      }
    },
    [clearHover, debug]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setArtVisible(false);
      setInitialReveal(true);
      const timer = window.setTimeout(() => setArtVisible(true), 1800);
      return () => window.clearTimeout(timer);
    }

    setArtVisible(false);
    const timer = window.setTimeout(() => setShouldRender(false), 1600);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const grid = gridRef.current;
    if (!grid) return;

    const supportsHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (supportsHover) return; // native hover works

    const handlePointerMove = (event: PointerEvent) => {
      handleRevealStart();
      updateHoverFromPoint(event.clientX, event.clientY);
    };

    const handlePointerDown = (event: PointerEvent) => {
      handleRevealStart();
      try {
        grid.setPointerCapture(event.pointerId);
      } catch {}
      updateHoverFromPoint(event.clientX, event.clientY);
    };

    const handlePointerUp = (event: PointerEvent) => {
      try {
        grid.releasePointerCapture(event.pointerId);
      } catch {}
      clearHover();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      try {
        grid.releasePointerCapture(event.pointerId);
      } catch {}
      clearHover();
    };

    const handlePointerLeave = () => {
      clearHover();
    };

    grid.addEventListener("pointermove", handlePointerMove);
    grid.addEventListener("pointerleave", handlePointerLeave);
    grid.addEventListener("pointerdown", handlePointerDown);
    grid.addEventListener("pointerup", handlePointerUp);
    grid.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      grid.removeEventListener("pointermove", handlePointerMove);
      grid.removeEventListener("pointerleave", handlePointerLeave);
      grid.removeEventListener("pointerdown", handlePointerDown);
      grid.removeEventListener("pointerup", handlePointerUp);
      grid.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [open, handleRevealStart, updateHoverFromPoint, clearHover]);

  useEffect(() => {
    initialRevealRef.current = initialReveal;
  }, [initialReveal]);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [open]);

  useEffect(() => {
    if (!open && previousFocusRef.current) {
      previousFocusRef.current.focus({ preventScroll: true });
      previousFocusRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (open && artVisible && closeButtonRef.current) {
      closeButtonRef.current.focus({ preventScroll: true });
    }
  }, [open, artVisible]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const container = contentRef.current;
      if (!container) {
        return;
      }

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true"
      );

      if (focusable.length === 0) {
        event.preventDefault();
        closeButtonRef.current?.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        }
        return;
      }

      if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    },
    [onClose]
  );

  const portalTarget = useMemo(() => {
    if (!mounted) return null;
    return typeof document !== "undefined" ? document.body : null;
  }, [mounted]);

  if (!shouldRender || !portalTarget) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[6000]">
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-[1600ms] ease-in ${
          open ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden="true"
      />

      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`relative z-10 flex h-full w-full items-center justify-center px-4 py-6 transition-opacity duration-500 ease-out ${
          open && artVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
          <div className="space-y-3 px-2">
            <p className="text-xs uppercase tracking-[0.35em] text-white/70 sm:text-sm">
              Secret Garden Unlocked
            </p>
            <h2 id={headingId} className="text-2xl font-pixel text-white sm:text-3xl">Pixotchi on Base</h2>
            <p className="text-sm text-white/70 sm:text-base" id={descriptionId}>
              Thanks for watering Pixotchi with belief and patience. This bloom is for everyone building the garden with us.
            </p>
          </div>

          <div
            ref={gridRef}
            className="secret-garden-pixel-grid"
            onMouseEnter={handleRevealStart}
            onMouseMove={handleRevealStart}
            onPointerDown={handleRevealStart}
            onClick={handleRevealStart}
          >
            {SECRET_CELLS.map((cell) => (
              <span
                key={cell.id}
                style={cell.style}
                data-pixel="true"
                className={`secret-garden-pixel ${initialReveal ? "secret-garden-pixel--initial" : ""}`}
                aria-hidden="true"
              >
              </span>
            ))}
          </div>

          {debug ? (
            <div
              ref={debugIndicatorRef}
              aria-hidden="true"
              className="pointer-events-none fixed left-0 top-0 z-[7000] h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-blue-500/50 opacity-0 transition-opacity duration-150"
            />
          ) : null}

          <Button
            ref={closeButtonRef}
            onClick={onClose}
            variant="outline"
            className="mt-2 text-sm sm:text-base"
          >
            Return to the farm
          </Button>
        </div>
      </div>

      <style jsx global>{`
        .secret-garden-pixel-grid {
          display: grid;
          justify-content: center;
          grid-template-columns: repeat(${GRID_COLUMNS}, 1fr);
          width: min(82vw, 18rem);
          gap: clamp(0.18rem, 0.7vw, 0.25rem);
          margin: 0 auto;
          touch-action: none;
        }
        .secret-garden-pixel {
          width: 100%;
          aspect-ratio: 1 / 1;
          border-radius: 0.12rem;
          opacity: var(--o, 0.2);
          transition: opacity 0.8s ease-in, rotate 0.4s ease-out, filter 0.6s ease-out, background-color 0.45s ease, border-color 0.45s ease;
          transform-origin: center;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 0 10px rgba(15, 23, 42, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.75);
        }
        .secret-garden-pixel--initial {
          background: var(--pixel-color, rgba(255, 255, 255, 1));
          border-color: transparent;
          box-shadow: none;
        }
        .secret-garden-pixel:hover,
        .secret-garden-pixel[data-hover="true"] {
          transition-duration: 0s;
          rotate: calc(var(--r, 0) * 90deg);
          opacity: 1 !important;
          filter: grayscale(0) brightness(1);
          background: var(--pixel-color, rgba(255, 255, 255, 1));
          border-color: rgba(148, 163, 184, 0.3);
          box-shadow: 0 0 14px rgba(34, 197, 94, 0.22);
        }
        @media (prefers-reduced-motion: reduce) {
          .secret-garden-pixel {
            transition: opacity 0.6s ease;
          }
        }
      `}</style>
    </div>,
    portalTarget
  );
}


