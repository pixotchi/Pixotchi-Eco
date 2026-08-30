"use client";

import { useEffect, useState } from "react";

/**
 * Media-query state with a LAZY initializer, so the first client render already
 * reflects the real viewport instead of a hardcoded default that a useEffect
 * corrects one frame later. That default-then-correct pattern is what made the
 * desktop StatusBar render standalone on first paint and then jump into the
 * header (a visible layout shift on every desktop load).
 *
 * The same `(min-width: 54rem)` query used to be re-derived in six separate
 * components; this is the one shared implementation.
 *
 * SSR note: on the server (and during hydration of server-rendered markup) this
 * returns `false`. The app-shell consumers are all inside client-only trees
 * (`ssr: false` tabs or the post-connect shell), so the lazy read runs on the
 * true first client render.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.(query).matches),
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia(query);
    const sync = () => setMatches(mediaQuery.matches);

    sync();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, [query]);

  return matches;
}

/** The app's tablet/two-column gate — the `tablet:` screen in globals.css. */
export const TABLET_MEDIA_QUERY = "(min-width: 54rem)";
/** The desktop shell gate — Tailwind's `xl:`. */
export const DESKTOP_MEDIA_QUERY = "(min-width: 80rem)";
