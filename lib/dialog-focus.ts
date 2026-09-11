/** Safari does not focus a button on pointer press. Track that opener separately
 * from keyboard focus, with one shared listener for all mounted dialog roots. */
let roots = 0;
let pointerOpener: HTMLElement | null = null;
let pointerTime = 0;
const escapeHandlers = new Map<HTMLElement, (event: KeyboardEvent) => void>();

export function registerDialogEscape(node: HTMLElement, handler: (event: KeyboardEvent) => void) {
  escapeHandlers.set(node, handler);
  return () => { escapeHandlers.delete(node); };
}

/** A just-mounted nested layer can receive focus before Radix's passive layer
 * listener updates. Never let the older listener dismiss its parent instead. */
export function routeNestedDialogEscape(frame: HTMLElement | null, event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="dialog"]') : null;
  const handler = target && target !== frame ? escapeHandlers.get(target) : undefined;
  if (!handler) return false;
  if (!event.defaultPrevented) handler(event);
  event.preventDefault();
  return true;
}

function recordPointer(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target : null;
  pointerOpener = target?.closest<HTMLElement>('button, a[href], [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])') ?? null;
  pointerTime = Date.now();
}

function clearPointer() { pointerOpener = null; }

/** Hand off a menu action to a dialog whose opener must survive menu unmount. */
export function setDialogOpener(opener: HTMLElement) {
  pointerOpener = opener;
  pointerTime = Date.now();
}

export function trackDialogOpeners() {
  if (roots++ === 0) {
    document.addEventListener('pointerdown', recordPointer, true);
    document.addEventListener('keydown', clearPointer, true);
  }
  return () => {
    if (--roots === 0) {
      document.removeEventListener('pointerdown', recordPointer, true);
      document.removeEventListener('keydown', clearPointer, true);
      clearPointer();
    }
  };
}

export function getDialogOpener(): HTMLElement | null {
  if (pointerOpener?.isConnected && Date.now() - pointerTime < 1000) return pointerOpener;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}
