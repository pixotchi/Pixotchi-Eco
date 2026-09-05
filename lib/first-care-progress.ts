export type FirstCareStep = 'care' | 'tasks';
export const FIRST_CARE_PROGRESS_EVENT = 'pixotchi:first-care-progress';
const keyFor = (owner: string) => `pixotchi:first-care:v1:${owner.toLowerCase()}`;
const memory = new Map<string, string>();

export function readFirstCareProgress(owner?: string | null): string {
  if (!owner || typeof window === 'undefined') return '';
  try { return memory.get(keyFor(owner)) ?? localStorage.getItem(keyFor(owner)) ?? ''; }
  catch { return memory.get(keyFor(owner)) ?? ''; }
}

export function parseFirstCareProgress(value: string): Record<FirstCareStep, boolean> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      const data = parsed as Record<string, unknown>;
      return { care: data.care === true, tasks: data.tasks === true };
    }
  } catch { /* A missing or old record starts an empty checklist. */ }
  return { care: false, tasks: false };
}

export function completeFirstCareStep(owner: string | null | undefined, step: FirstCareStep) {
  if (!owner || typeof window === 'undefined') return;
  const value = JSON.stringify({ ...parseFirstCareProgress(readFirstCareProgress(owner)), [step]: true });
  try {
    localStorage.setItem(keyFor(owner), value);
    memory.delete(keyFor(owner));
  } catch {
    // A readable but full store can contain an older value. Prefer this session's
    // latest progress until a later write succeeds.
    memory.set(keyFor(owner), value);
  }
  window.dispatchEvent(new Event(FIRST_CARE_PROGRESS_EVENT));
}

export function subscribeFirstCareProgress(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(FIRST_CARE_PROGRESS_EVENT, callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener(FIRST_CARE_PROGRESS_EVENT, callback); };
}
