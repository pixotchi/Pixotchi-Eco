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

export function syncThemeCookie(theme: Theme): void {
  if (typeof window === 'undefined') return;

  try {
    document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  } catch (error) {
    console.warn('Error syncing theme cookie:', error);
  }
}

export function getThemeMetaColor(theme: Theme): string {
  const themeColors = {
    light: '#a8d0f0',
    dark: '#1f2d42',
    green: '#c1e7cb',
    yellow: '#fae6a8',
    red: '#ebc2c6',
    pink: '#edc4dc',
    blue: '#bbd4f1',
    violet: '#d5c9ed'
  } satisfies Record<Theme, string>;

  return themeColors[theme] || themeColors.light;
}

export function updateMetaThemeColor(theme: Theme): void {
  if (typeof document === 'undefined') return;

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) return;

  metaThemeColor.setAttribute('content', getThemeMetaColor(theme));
}

// Mirrors the core theme tokens in app/globals.css for non-CSS consumers.
export function getThemeColors(theme: Theme) {
  const lightBase = {
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

  const darkBase = {
    background: '216 36% 19%',
    foreground: '210 45% 96%',
    card: '218 34% 15%',
    'card-foreground': '210 45% 96%',
    popover: '218 34% 14%',
    'popover-foreground': '210 45% 96%',
    secondary: '216 30% 25%',
    'secondary-foreground': '210 45% 96%',
    muted: '216 26% 28%',
    'muted-foreground': '214 20% 74%',
    primary: '204 92% 72%',
    'primary-foreground': '218 45% 10%',
    accent: '170 36% 30%',
    'accent-foreground': '174 76% 84%',
    destructive: '356 72% 50%',
    'destructive-foreground': '0 0% 98%',
    success: '148 68% 48%',
    'success-strong': '148 72% 60%',
    'success-foreground': '150 58% 8%',
    warning: '38 94% 58%',
    'warning-foreground': '35 70% 10%',
    info: '198 92% 66%',
    'info-foreground': '218 45% 10%',
    value: '204 92% 72%',
    border: '216 20% 36%',
    input: '216 20% 38%',
    ring: '204 92% 72%',
    'scene-glow': '204 92% 58%',
    'scene-floor': '216 38% 24%'
  };

  const themeColors = {
    light: {
      ...lightBase,
      background: '207 70% 80%',
      card: '205 70% 94%',
      popover: '205 72% 95%',
      secondary: '205 62% 88%',
      muted: '204 56% 91%',
      primary: '211 82% 34%',
      accent: '166 55% 84%',
      'accent-foreground': '181 56% 16%',
      value: '211 82% 34%',
      border: '208 36% 62%',
      input: '208 34% 60%',
      ring: '211 82% 34%',
      'scene-glow': '190 84% 86%',
      'scene-floor': '166 58% 90%'
    },
    dark: {
      ...darkBase
    },
    green: {
      ...lightBase,
      background: '137 44% 83%',
      card: '126 42% 91%',
      popover: '126 44% 92%',
      secondary: '139 38% 78%',
      muted: '132 34% 84%',
      primary: '151 78% 24%',
      accent: '82 56% 78%',
      'accent-foreground': '142 74% 18%',
      info: '180 72% 28%',
      value: '151 78% 24%',
      border: '137 26% 58%',
      input: '137 24% 54%',
      ring: '151 78% 24%',
      'scene-glow': '88 72% 82%',
      'scene-floor': '151 52% 86%'
    },
    yellow: {
      ...lightBase,
      background: '45 90% 82%',
      card: '44 76% 91%',
      popover: '44 78% 92%',
      secondary: '42 68% 75%',
      muted: '43 62% 82%',
      primary: '33 86% 29%',
      accent: '190 52% 82%',
      'accent-foreground': '194 62% 18%',
      warning: '38 94% 46%',
      info: '190 72% 30%',
      value: '33 86% 29%',
      border: '39 38% 56%',
      input: '39 34% 52%',
      ring: '33 86% 29%',
      'scene-glow': '38 92% 80%',
      'scene-floor': '48 78% 88%'
    },
    red: {
      ...lightBase,
      background: '354 50% 84%',
      card: '0 44% 91%',
      popover: '0 46% 92%',
      secondary: '354 42% 78%',
      muted: '354 36% 84%',
      primary: '350 76% 34%',
      accent: '24 62% 79%',
      'accent-foreground': '356 64% 18%',
      destructive: '356 76% 46%',
      info: '24 76% 39%',
      value: '350 76% 34%',
      border: '354 30% 58%',
      input: '354 28% 54%',
      ring: '350 76% 34%',
      'scene-glow': '24 74% 82%',
      'scene-floor': '354 48% 89%'
    },
    pink: {
      ...lightBase,
      background: '326 54% 85%',
      card: '326 48% 92%',
      popover: '326 50% 93%',
      secondary: '326 44% 79%',
      muted: '326 38% 85%',
      primary: '328 74% 36%',
      accent: '276 56% 82%',
      'accent-foreground': '326 70% 20%',
      info: '276 70% 44%',
      value: '328 74% 36%',
      border: '326 32% 59%',
      input: '326 30% 55%',
      ring: '328 74% 36%',
      'scene-glow': '276 66% 84%',
      'scene-floor': '326 56% 90%'
    },
    blue: {
      ...lightBase,
      background: '213 66% 84%',
      card: '212 58% 92%',
      popover: '212 60% 93%',
      secondary: '213 52% 78%',
      muted: '213 44% 85%',
      primary: '219 78% 36%',
      accent: '188 62% 82%',
      'accent-foreground': '219 70% 20%',
      info: '198 84% 34%',
      value: '219 78% 36%',
      border: '216 32% 58%',
      input: '216 30% 54%',
      ring: '219 78% 36%',
      'scene-glow': '188 76% 84%',
      'scene-floor': '216 60% 90%'
    },
    violet: {
      ...lightBase,
      background: '260 50% 86%',
      card: '260 50% 93%',
      popover: '260 52% 94%',
      secondary: '260 42% 80%',
      muted: '260 36% 86%',
      primary: '263 76% 38%',
      accent: '294 54% 82%',
      'accent-foreground': '263 74% 20%',
      info: '292 68% 44%',
      value: '263 76% 38%',
      border: '260 30% 59%',
      input: '260 28% 55%',
      ring: '263 76% 38%',
      'scene-glow': '294 62% 86%',
      'scene-floor': '258 54% 91%'
    }
  };

  return themeColors[theme] || themeColors.light;
}
