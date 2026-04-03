"use client";

import { useCallback, useEffect, useState } from "react";

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
  const readValue = useCallback(() => {
    if (!enabled || typeof window === "undefined") {
      return defaultValue;
    }

    const params = new URLSearchParams(window.location.search);
    return parse(params.get(key)) ?? defaultValue;
  }, [defaultValue, enabled, key, parse]);

  const [value, setValueState] = useState<T>(defaultValue);

  useEffect(() => {
    setValueState(readValue());
  }, [readValue]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const syncFromLocation = () => {
      setValueState(readValue());
    };

    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [enabled, readValue]);

  const setValue = useCallback(
    (nextValue: SetStateAction<T>) => {
      setValueState((previousValue) => {
        const resolvedValue =
          typeof nextValue === "function"
            ? (nextValue as (previous: T) => T)(previousValue)
            : nextValue;

        if (enabled && typeof window !== "undefined") {
          const url = new URL(window.location.href);
          const serialized = serialize(resolvedValue);

          if (serialized === null || serialized === "") {
            url.searchParams.delete(key);
          } else {
            url.searchParams.set(key, serialized);
          }

          const nextUrl = `${url.pathname}${url.search}${url.hash}`;
          window.history.replaceState(window.history.state, "", nextUrl);
        }

        return resolvedValue;
      });
    },
    [enabled, key, serialize],
  );

  return [value, setValue] as const;
}
