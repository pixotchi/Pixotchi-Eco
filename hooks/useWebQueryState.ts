"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { normalizeWebQueryState, readWebQueryValue, writeWebQueryValue } from "@/lib/web-query-state";

type SetStateAction<T> = T | ((previous: T) => T);

type UseWebQueryStateOptions<T> = {
  key: string;
  defaultValue: T;
  enabled?: boolean;
  /** Replace for filters/pagination; push for top-level tab changes. */
  history?: "push" | "replace";
  parse: (rawValue: string | null) => T | null;
  serialize: (value: T) => string | null;
};

export const WEB_QUERY_STATE_EVENT = "pixotchi:web-query-state";
const serverSnapshot = () => null;

export function useWebQueryState<T>({
  key,
  defaultValue,
  enabled = true,
  history = "replace",
  parse,
  serialize,
}: UseWebQueryStateOptions<T>) {
  const subscribe = useCallback((onChange: () => void) => {
    if (!enabled) return () => {};
    const sync = () => {
      normalizeWebQueryState();
      onChange();
    };
    window.addEventListener("popstate", sync);
    window.addEventListener(WEB_QUERY_STATE_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(WEB_QUERY_STATE_EVENT, sync);
    };
  }, [enabled]);
  // A primitive snapshot is stable even for JSON-backed Activity feeds. Read
  // during render so a retained React Activity tab cannot reveal old filters
  // and run effects against them before a passive URL sync catches up.
  const getSnapshot = useCallback(() => enabled ? readWebQueryValue(key) : null, [enabled, key]);
  const rawValue = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const [localValue, setLocalValue] = useState<T>(() => defaultValue);
  const value = useMemo(() => enabled ? parse(rawValue) ?? defaultValue : localValue, [defaultValue, enabled, localValue, parse, rawValue]);

  const optionsRef = useRef({ key, defaultValue, enabled, history, parse, serialize });
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    optionsRef.current = { key, defaultValue, enabled, history, parse, serialize };
    valueRef.current = value;
  }, [defaultValue, enabled, history, key, parse, serialize, value]);

  useEffect(() => {
    if (enabled) normalizeWebQueryState();
  }, [enabled, key]);

  const setValue = useCallback((nextValue: SetStateAction<T>) => {
    const options = optionsRef.current;
    // A hidden async callback must merge into this history entry's selection,
    // rather than a stale render retained by React Activity.
    const previousValue = options.enabled
      ? options.parse(readWebQueryValue(options.key)) ?? options.defaultValue
      : valueRef.current;
    const resolvedValue = typeof nextValue === "function"
      ? (nextValue as (previous: T) => T)(previousValue)
      : nextValue;
    if (options.enabled) {
      writeWebQueryValue(options.key, options.serialize(resolvedValue), options.history);
      window.dispatchEvent(new Event(WEB_QUERY_STATE_EVENT));
    } else {
      // Mini Apps retain their shared local state through hide/reveal without
      // reading, normalizing or writing any web query parameters.
      valueRef.current = resolvedValue;
      setLocalValue(resolvedValue);
    }
  }, []);

  return [value, setValue] as const;
}
