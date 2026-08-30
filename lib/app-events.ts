const BALANCE_REFRESH_EVENT = "pixotchi:balances:refresh";
const TASKS_OPEN_EVENT = "pixotchi:tasks:open";
const STAKING_OPEN_EVENT = "pixotchi:staking:open";
const LEGACY_BALANCE_REFRESH_EVENT = "balances:refresh";
const LEGACY_TASKS_OPEN_EVENT = "pixotchi:openTasks";
const LEGACY_STAKING_OPEN_EVENT = "staking:open";

type EventCleanup = () => void;

function dispatchTypedEvent<T>(name: string, detail?: T) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function subscribeToTypedEvents<T>(
  names: string[],
  listener: (detail: T | undefined) => void,
): EventCleanup {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handlers = names.map((name) => {
    const handler = (event: Event) => {
      listener((event as CustomEvent<T>).detail);
    };

    window.addEventListener(name, handler as EventListener);
    return { handler, name };
  });

  return () => {
    handlers.forEach(({ handler, name }) => {
      window.removeEventListener(name, handler as EventListener);
    });
  };
}

export function requestBalanceRefresh(delayMs: number = 500) {
  dispatchTypedEvent(BALANCE_REFRESH_EVENT, { delayMs });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LEGACY_BALANCE_REFRESH_EVENT));
  }
}

export function onBalanceRefresh(
  listener: (detail: { delayMs?: number } | undefined) => void,
): EventCleanup {
  return subscribeToTypedEvents(
    [BALANCE_REFRESH_EVENT, LEGACY_BALANCE_REFRESH_EVENT],
    listener,
  );
}


export function openTasksDialog() {
  dispatchTypedEvent(TASKS_OPEN_EVENT);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LEGACY_TASKS_OPEN_EVENT));
  }
}

export function onTasksDialogOpen(listener: () => void): EventCleanup {
  return subscribeToTypedEvents(
    [TASKS_OPEN_EVENT, LEGACY_TASKS_OPEN_EVENT],
    () => listener(),
  );
}

export function openStakingDialog() {
  dispatchTypedEvent(STAKING_OPEN_EVENT);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LEGACY_STAKING_OPEN_EVENT));
  }
}

export function onStakingDialogOpen(listener: () => void): EventCleanup {
  return subscribeToTypedEvents(
    [STAKING_OPEN_EVENT, LEGACY_STAKING_OPEN_EVENT],
    () => listener(),
  );
}
