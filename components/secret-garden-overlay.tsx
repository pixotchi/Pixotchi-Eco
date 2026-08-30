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
import { usePerformanceMode } from "@/components/ui/performance-mode";

type SecretGardenOverlayProps = {
  open: boolean;
  onClose: () => void;
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

export function SecretGardenOverlay({ open, onClose }: SecretGardenOverlayProps) {
  const { enabled: performanceModeEnabled } = usePerformanceMode();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [artVisible, setArtVisible] = useState(false);
  const [initialReveal, setInitialReveal] = useState(true);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lastHoveredRef = useRef<HTMLElement | null>(null);
  const initialRevealRef = useRef(initialReveal);
  const skipMotionRef = useRef(performanceModeEnabled || prefersReducedMotion);
  const headingId = useId();
  const descriptionId = useId();

  const handleRevealStart = useCallback(() => {
    if (!initialRevealRef.current) {
      return;
    }
    initialRevealRef.current = false;
    setInitialReveal(false);
  }, []);

  const clearHover = useCallback(() => {
    const previous = lastHoveredRef.current;
    if (previous) {
      previous.removeAttribute("data-hover");
      lastHoveredRef.current = null;
    }
  }, []);

  const updateHoverFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const grid = gridRef.current;
      if (!grid) {
        return;
      }

      const rect = grid.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;

      if (
        relativeX < 0 ||
        relativeY < 0 ||
        relativeX >= rect.width ||
        relativeY >= rect.height
      ) {
        clearHover();
        return;
      }

      const cellWidth = rect.width / GRID_COLUMNS;
      const cellHeight = rect.height / GRID_ROWS;

      if (cellWidth <= 0 || cellHeight <= 0) {
        clearHover();
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
        return;
      }

      const index = row * GRID_COLUMNS + column;
      const target = grid.children[index] as HTMLElement | undefined;

      if (!target || target.dataset.pixel !== "true") {
        clearHover();
        return;
      }

      if (lastHoveredRef.current !== target) {
        lastHoveredRef.current?.removeAttribute("data-hover");
        target.setAttribute("data-hover", "true");
        lastHoveredRef.current = target;
      }
    },
    [clearHover]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(reducedMotion.matches);
    syncPreference();
    try {
      reducedMotion.addEventListener("change", syncPreference);
      return () => reducedMotion.removeEventListener("change", syncPreference);
    } catch {
      reducedMotion.addListener(syncPreference);
      return () => reducedMotion.removeListener(syncPreference);
    }
  }, []);

  useEffect(() => {
    const skipMotion = performanceModeEnabled || prefersReducedMotion;
    skipMotionRef.current = skipMotion;
    if (!skipMotion) return;
    if (open) {
      setArtVisible(true);
    } else {
      setShouldRender(false);
    }
  }, [open, performanceModeEnabled, prefersReducedMotion]);

  useEffect(() => {
    const skipSpatialMotion = skipMotionRef.current;

    if (open) {
      setShouldRender(true);
      setArtVisible(false);
      setInitialReveal(true);
      if (skipSpatialMotion) {
        setArtVisible(true);
        return;
      }

      // Two frames guarantee one painted starting state without holding users
      // on a perceptible blank black screen.
      let frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setArtVisible(true));
      });
      return () => window.cancelAnimationFrame(frame);
    }

    setArtVisible(false);
    const timer = window.setTimeout(() => setShouldRender(false), skipSpatialMotion ? 0 : 280);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    // Keyed on shouldRender, not open: releasing at open=false let the page
    // scroll under a backdrop that was still fully opaque and fading for 1.6s.
    if (!shouldRender) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    // Scrollbar compensation (Radix dialogs get this from react-remove-scroll;
    // this bespoke overlay shifted the page ~15px on desktop without it).
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [shouldRender]);

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
      } catch (error) {
        // Pointer capture may fail in some browsers/contexts - this is expected
        console.debug('Pointer capture failed (non-critical):', error);
      }
      updateHoverFromPoint(event.clientX, event.clientY);
    };

    const handlePointerUp = (event: PointerEvent) => {
      try {
        grid.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Pointer release may fail if capture wasn't set - this is expected
        console.debug('Pointer release failed (non-critical):', error);
      }
      clearHover();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      try {
        grid.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Pointer release may fail if capture wasn't set - this is expected
        console.debug('Pointer release failed (non-critical):', error);
      }
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

  // Document-level Escape: the dialog-node handler below only fires once focus
  // is inside the overlay, which used to leave Escape dead during the intro.
  useEffect(() => {
    if (!open) return;
    const onDocKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onDocKey);
    return () => document.removeEventListener("keydown", onDocKey);
  }, [open, onClose]);

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
    // pointer-events-none on the wrapper: during the 1.6s exit fade this used to
    // be a transparent full-viewport layer that swallowed every tap. The content
    // layer re-enables pointer events only while actually open.
    <div className="pointer-events-none fixed inset-0 z-[var(--z-takeover)]" aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-[var(--motion-standard)] ease-[var(--ease-standard)] ${
          open && artVisible ? "opacity-100" : "opacity-0"
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
        className={`relative z-10 flex h-full w-full items-center justify-center px-4 py-6 transition-opacity duration-[var(--motion-modal)] ease-[var(--ease-standard)] ${
          open && artVisible ? "pointer-events-auto" : ""
        } ${
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
          transition: opacity var(--motion-quick) var(--ease-standard), transform var(--motion-quick) var(--ease-standard);
          transform-origin: center;
          transform: rotate(0deg);
          background-color: rgba(255, 255, 255, 0.96);
          box-shadow: none;
          border: 1px solid rgba(255, 255, 255, 0.75);
        }
        .secret-garden-pixel--initial {
          background-color: var(--pixel-color, rgba(255, 255, 255, 1));
          border-color: transparent;
          box-shadow: none;
        }
        .secret-garden-pixel[data-hover="true"] {
          transform: rotate(calc(var(--r, 0) * 90deg));
          opacity: 1 !important;
          background-color: var(--pixel-color, rgba(255, 255, 255, 1));
          border-color: rgba(148, 163, 184, 0.3);
          box-shadow: 0 0 14px rgba(34, 197, 94, 0.22);
        }
        @media (hover: hover) and (pointer: fine) {
          .secret-garden-pixel:hover {
            transform: rotate(calc(var(--r, 0) * 90deg));
            opacity: 1 !important;
            background-color: var(--pixel-color, rgba(255, 255, 255, 1));
            border-color: rgba(148, 163, 184, 0.3);
            box-shadow: 0 0 14px rgba(34, 197, 94, 0.22);
          }
        }
      `}</style>
    </div>,
    portalTarget
  );
}
