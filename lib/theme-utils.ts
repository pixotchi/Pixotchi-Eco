
export const THEMES = {
  light: 'light',
  dark: 'dark',
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  pink: 'pink',
  blue: 'blue',
  violet: 'violet'
} as const;

export type Theme = keyof typeof THEMES;

const LIGHT_BASE_COLORS = {
  foreground: '218 50% 12%',
  'card-foreground': '218 50% 12%',
  'popover-foreground': '218 50% 12%',
  'secondary-foreground': '218 50% 12%',
  'muted-foreground': '216 30% 22%',
  'primary-foreground': '0 0% 98%',
  destructive: '356 76% 44%',
  'destructive-foreground': '0 0% 98%',
  success: '148 76% 24%',
  'success-strong': '148 78% 20%',
  'success-foreground': '0 0% 98%',
  warning: '38 92% 49%',
  'warning-foreground': '35 70% 12%',
  info: '196 82% 34%',
  'info-foreground': '0 0% 98%'
};

const COLORFUL_BASE_COLORS = {
  foreground: '240 10% 4%',
  'card-foreground': '240 10% 4%',
  'popover-foreground': '240 10% 4%',
  'secondary-foreground': '240 10% 4%',
  'muted-foreground': '240 4% 38%',
  'primary-foreground': '0 0% 98%',
  destructive: '356 28% 58%',
  'destructive-foreground': '356 34% 16%',
  success: '142 72% 36%',
  'success-strong': '142 76% 28%',
  'success-foreground': '0 0% 98%',
  warning: '38 46% 58%',
  'warning-foreground': '34 50% 13%',
  'info-foreground': '0 0% 98%'
};

type ThemeColorMap = typeof LIGHT_BASE_COLORS & {
  background: string;
  card: string;
  popover: string;
  secondary: string;
  muted: string;
  primary: string;
  accent: string;
  'accent-foreground': string;
  value: string;
  border: string;
  'border-strong': string;
  divider: string;
  input: string;
  ring: string;
  'scene-glow': string;
  'scene-floor': string;
  'chromatic-layer-surface'?: string;
  'chromatic-layer-highlight'?: string;
};

/*
 * ONLY the background token per theme — the single value the meta theme-color
 * needs. This used to be a full ~250-line JS copy of the CSS palette, which had
 * already drifted from globals.css (it still held two values the CSS comments
 * explicitly rejected for AA contrast). globals.css is the palette's single
 * source of truth; never mirror more of it here.
 */
const THEME_BACKGROUNDS: Record<Theme, string> = {
  light: '210 55% 78%',
  dark: '216 30% 25%',
  green: '137 44% 83%',
  yellow: '45 90% 82%',
  red: '356 42% 86%',
  pink: '326 54% 85%',
  blue: '213 66% 84%',
  violet: '260 44% 88%',
};

function clampChannel(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hslTokenToHex(token: string): string {
  const match = token.match(/^\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/);
  if (!match) return '#000000';

  const hue = ((((Number(match[1]) % 360) + 360) % 360) / 360);
  const saturation = clampChannel(Number(match[2]) / 100);
  const lightness = clampChannel(Number(match[3]) / 100);

  const hueToRgb = (p: number, q: number, t: number) => {
    let nextT = t;
    if (nextT < 0) nextT += 1;
    if (nextT > 1) nextT -= 1;
    if (nextT < 1 / 6) return p + (q - p) * 6 * nextT;
    if (nextT < 1 / 2) return q;
    if (nextT < 2 / 3) return p + (q - p) * (2 / 3 - nextT) * 6;
    return p;
  };

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  const channels = saturation === 0
    ? [lightness, lightness, lightness]
    : [
        hueToRgb(p, q, hue + 1 / 3),
        hueToRgb(p, q, hue),
        hueToRgb(p, q, hue - 1 / 3),
      ];

  return `#${channels
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}



export function getThemeMetaColor(theme: Theme): string {
  return hslTokenToHex(THEME_BACKGROUNDS[theme] ?? THEME_BACKGROUNDS.light);
}

export function updateMetaThemeColor(theme: Theme): void {
  if (typeof document === 'undefined') return;

  // Update every theme-color meta, not just the first match. The layout used to
  // emit three (a light-media pair from the Viewport API plus a bare one), and a
  // single querySelector hit the media-scoped light tag — which a device in OS
  // dark mode never resolves, so the selected theme's colour never applied.
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (metas.length === 0) return;

  const color = getThemeMetaColor(theme);
  metas.forEach((meta) => meta.setAttribute('content', color));
}


