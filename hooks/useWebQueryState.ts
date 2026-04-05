"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type SetStateAction<T> = T | ((previous: T) => T);

type UseWebQueryStateOptions<T> = {
  key: string;
  defaultValue: T;
  enabled?: boolean;
  parse: (rawValue: string | null) => T | null;
  serialize: (value: T) => string | null;
};

export function useWebQueryState<T>({
  key,
  defaultValue,
  enabled = true,
  parse,
  serialize,
}: UseWebQueryStateOptions<T>) {
  const enabledRef = useRef(enabled);
  const keyRef = useRef(key);
  const defaultValueRef = useRef(defaultValue);
  const parseRef = useRef(parse);
  const serializeRef = useRef(serialize);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
    keyRef.current = key;
    defaultValueRef.current = defaultValue;
    parseRef.current = parse;
    serializeRef.current = serialize;
  }, [defaultValue, enabled, key, parse, serialize]);

  const readValue = useCallback(() => {
    if (!enabledRef.current || typeof window === "undefined") {
      return defaultValueRef.current;
    }

    const params = new URLSearchParams(window.location.search);
    return parseRef.current(params.get(keyRef.current)) ?? defaultValueRef.current;
  }, []);

  const [value, setValueState] = useState<T>(() => {
    if (!enabled || typeof window === "undefined") {
      return defaultValue;
    }

    const params = new URLSearchParams(window.location.search);
    return parse(params.get(key)) ?? defaultValue;
  });

  useEffect(() => {
    setValueState(readValue());
  }, [defaultValue, enabled, key, readValue]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const syncFromLocation = () => {
      setValueState(readValue());
    };

    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [enabled, key, readValue]);

  const setValue = useCallback(
    (nextValue: SetStateAction<T>) => {
      setValueState((previousValue) => {
        const resolvedValue =
          typeof nextValue === "function"
            ? (nextValue as (previous: T) => T)(previousValue)
            : nextValue;

        if (enabledRef.current && typeof window !== "undefined") {
          const url = new URL(window.location.href);
          const serialized = serializeRef.current(resolvedValue);

          if (serialized === null || serialized === "") {
            url.searchParams.delete(keyRef.current);
          } else {
            url.searchParams.set(keyRef.current, serialized);
          }

          const nextUrl = `${url.pathname}${url.search}${url.hash}`;
          window.history.replaceState(window.history.state, "", nextUrl);
        }

        return resolvedValue;
      });
    },
    [],
  );

  return [value, setValue] as const;
}
