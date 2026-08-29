export const THEME_COOKIE_NAME = 'pixotchi-theme';
export const THEME_STORAGE_KEY = 'pixotchi-theme';

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

// Mirrors the final visual-refresh theme tokens in app/globals.css.
const THEME_COLORS = {
  light: {
    ...LIGHT_BASE_COLORS,
    background: '210 55% 78%',
    card: '210 48% 90%',
    popover: '210 50% 91%',
    secondary: '210 46% 82%',
    muted: '210 48% 85%',
    primary: '211 82% 34%',
    accent: '166 55% 84%',
    'accent-foreground': '181 56% 16%',
    value: '188 90% 20%',
    border: '208 34% 56%',
    'border-strong': '208 32% 42%',
    divider: '208 30% 48%',
    input: '208 32% 50%',
    ring: '211 82% 34%',
    'scene-glow': '190 84% 86%',
    'scene-floor': '166 58% 90%',
    'chromatic-layer-surface': '210 62% 92%',
    'chromatic-layer-highlight': '210 72% 95%'
  },
  dark: {
    background: '216 30% 25%',
    foreground: '210 45% 96%',
    card: '216 30% 31%',
    'card-foreground': '210 45% 96%',
    popover: '216 31% 32%',
    'popover-foreground': '210 45% 96%',
    secondary: '216 28% 28%',
    'secondary-foreground': '210 45% 96%',
    muted: '216 26% 29%',
    'muted-foreground': '214 22% 78%',
    primary: '204 92% 74%',
    'primary-foreground': '218 45% 10%',
    accent: '170 32% 32%',
    'accent-foreground': '174 76% 86%',
    destructive: '356 72% 50%',
    'destructive-foreground': '0 0% 98%',
    success: '148 68% 48%',
    'success-strong': '148 72% 60%',
    'success-foreground': '150 58% 8%',
    warning: '38 94% 58%',
    'warning-foreground': '35 70% 10%',
    info: '198 92% 66%',
    'info-foreground': '218 45% 10%',
    value: '188 88% 72%',
    border: '216 20% 47%',
    'border-strong': '216 20% 58%',
    divider: '216 20% 52%',
    input: '216 20% 50%',
    ring: '204 92% 74%',
    'scene-glow': '204 92% 62%',
    'scene-floor': '216 30% 29%',
    'chromatic-layer-surface': '216 28% 40%',
    'chromatic-layer-highlight': '216 34% 47%'
  },
  green: {
    ...COLORFUL_BASE_COLORS,
    background: '137 44% 83%',
    card: '112 30% 93%',
    popover: '112 34% 94%',
    secondary: '139 34% 79%',
    muted: '126 26% 86%',
    primary: '151 78% 24%',
    accent: '82 56% 78%',
    'accent-foreground': '142 74% 18%',
    info: '180 72% 28%',
    value: '36 88% 25%',
    border: '137 26% 52%',
    'border-strong': '137 26% 40%',
    divider: '137 24% 45%',
    input: '137 24% 48%',
    ring: '151 78% 24%',
    'scene-glow': '88 72% 82%',
    'scene-floor': '151 52% 86%',
    'chromatic-layer-surface': '116 30% 90%',
    'chromatic-layer-highlight': '112 34% 92%'
  },
  yellow: {
    ...COLORFUL_BASE_COLORS,
    background: '45 90% 82%',
    card: '46 46% 93%',
    popover: '46 50% 94%',
    secondary: '42 68% 75%',
    muted: '43 44% 84%',
    primary: '33 86% 29%',
    accent: '190 52% 82%',
    'accent-foreground': '194 62% 18%',
    warning: '38 94% 46%',
    'warning-foreground': '35 74% 12%',
    info: '190 72% 30%',
    value: '188 86% 24%',
    border: '39 38% 50%',
    'border-strong': '39 40% 38%',
    divider: '39 38% 43%',
    input: '39 34% 46%',
    ring: '33 86% 29%',
    'scene-glow': '38 92% 80%',
    'scene-floor': '48 78% 88%',
    'chromatic-layer-surface': '46 56% 90%',
    'chromatic-layer-highlight': '48 64% 92%'
  },
  red: {
    ...COLORFUL_BASE_COLORS,
    background: '356 42% 86%',
    card: '14 34% 93%',
    popover: '14 38% 94%',
    secondary: '354 30% 80%',
    muted: '356 26% 86%',
    primary: '348 62% 36%',
    accent: '24 62% 79%',
    'accent-foreground': '356 64% 18%',
    destructive: '356 76% 46%',
    'destructive-foreground': '0 0% 98%',
    info: '198 74% 32%',
    value: '198 80% 25%',
    border: '352 26% 52%',
    'border-strong': '352 28% 40%',
    divider: '352 26% 45%',
    input: '352 26% 48%',
    ring: '348 62% 36%',
    'scene-glow': '24 74% 82%',
    'scene-floor': '354 48% 89%',
    'chromatic-layer-surface': '12 32% 91%',
    'chromatic-layer-highlight': '8 38% 93%'
  },
  pink: {
    ...COLORFUL_BASE_COLORS,
    background: '326 54% 85%',
    card: '326 32% 94%',
    popover: '326 36% 95%',
    secondary: '326 36% 81%',
    muted: '326 28% 87%',
    primary: '328 68% 36%',
    accent: '276 48% 83%',
    'accent-foreground': '326 70% 20%',
    info: '276 70% 44%',
    value: '266 68% 36%',
    border: '326 28% 53%',
    'border-strong': '326 30% 40%',
    divider: '326 28% 45%',
    input: '326 28% 49%',
    ring: '328 68% 36%',
    'scene-glow': '276 66% 84%',
    'scene-floor': '326 56% 90%',
    'chromatic-layer-surface': '326 34% 91%',
    'chromatic-layer-highlight': '326 44% 93%'
  },
  blue: {
    ...COLORFUL_BASE_COLORS,
    background: '213 66% 84%',
    card: '212 44% 94%',
    popover: '212 48% 95%',
    secondary: '213 52% 78%',
    muted: '213 34% 87%',
    primary: '219 78% 36%',
    accent: '188 62% 82%',
    'accent-foreground': '219 70% 20%',
    info: '198 84% 34%',
    value: '188 86% 23%',
    border: '216 32% 52%',
    'border-strong': '216 34% 40%',
    divider: '216 32% 45%',
    input: '216 30% 48%',
    ring: '219 78% 36%',
    'scene-glow': '188 76% 84%',
    'scene-floor': '216 60% 90%',
    'chromatic-layer-surface': '212 40% 91%',
    'chromatic-layer-highlight': '210 52% 93%'
  },
  violet: {
    ...COLORFUL_BASE_COLORS,
    background: '260 44% 88%',
    card: '256 32% 94%',
    popover: '256 36% 95%',
    secondary: '260 36% 82%',
    muted: '260 28% 88%',
    primary: '263 72% 38%',
    accent: '294 54% 82%',
    'accent-foreground': '263 74% 20%',
    info: '292 68% 44%',
    value: '198 80% 25%',
    border: '260 28% 53%',
    'border-strong': '260 30% 40%',
    divider: '260 28% 45%',
    input: '260 28% 49%',
    ring: '263 72% 38%',
    'scene-glow': '294 62% 86%',
    'scene-floor': '258 54% 91%',
    'chromatic-layer-surface': '260 34% 91%',
    'chromatic-layer-highlight': '260 44% 93%'
  }
} satisfies Record<Theme, ThemeColorMap>;

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

export function syncThemeCookie(theme: Theme): void {
  if (typeof window === 'undefined') return;

  try {
    document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  } catch (error) {
    console.warn('Error syncing theme cookie:', error);
  }
}

export function getThemeMetaColor(theme: Theme): string {
  return hslTokenToHex((THEME_COLORS[theme] ?? THEME_COLORS.light).background);
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

export function getThemeColors(theme: Theme) {
  return THEME_COLORS[theme] ?? THEME_COLORS.light;
}
