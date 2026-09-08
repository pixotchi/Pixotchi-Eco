/** Casino surfaces share control sizing and footer chrome; game colors remain explicit. */
export const GAME_ACTION_BUTTON_BASE = 'inline-flex min-h-11 w-full min-w-0 items-center justify-center rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-semibold leading-none shadow-[var(--shadow-control)] transition-[background-color,border-color,color,filter,box-shadow] duration-[var(--motion-quick)]';

const ACTION_TONES = {
  warning: 'border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning))] bg-[image:var(--gradient-warning)] text-[hsl(var(--warning-foreground))] [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.03]',
  primary: 'border border-primary/30 bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.03]',
  neutral: 'border border-white/20 bg-white/10 text-white [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/15',
  special: 'border border-white/20 bg-[image:var(--gradient-special)] text-white [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-105',
} as const;

export function gameActionButtonClass(tone: keyof typeof ACTION_TONES, compact = false): string {
  const base = compact ? GAME_ACTION_BUTTON_BASE.replace('text-sm', 'text-xs').replace('var(--shadow-control)', 'var(--shadow-hairline)') : GAME_ACTION_BUTTON_BASE;
  return `${base} ${ACTION_TONES[tone]}`;
}

export const GAME_ACTION_FOOTER_CLASS = 'surface-footer-divider dialog-footer-surface sticky bottom-0 z-10 mt-auto shrink-0 space-y-3 overflow-visible border-white/15 bg-black bg-[image:linear-gradient(#000,#000)] px-3 pb-[max(0.875rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom),var(--browser-safe-area-bottom))] pt-3 text-white sm:px-4';
export const GAME_INSET_ACTION_FOOTER_CLASS = `${GAME_ACTION_FOOTER_CLASS} -mx-3 sm:-mx-4`;
