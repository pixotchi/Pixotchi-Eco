"use client";

export const POST_TRANSACTION_REFRESH_DELAYS_MS = [0, 650, 1800, 3800, 6500] as const;

export function dispatchPostTransactionRefresh(
  eventNames: string[] = ["balances:refresh"],
  delays: readonly number[] = POST_TRANSACTION_REFRESH_DELAYS_MS,
) {
  if (typeof window === "undefined") return;

  const emit = () => {
    for (const eventName of eventNames) {
      window.dispatchEvent(new Event(eventName));
    }
  };

  for (const delay of delays) {
    if (delay <= 0) {
      emit();
    } else {
      window.setTimeout(emit, delay);
    }
  }
}
