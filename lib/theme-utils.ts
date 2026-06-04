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
    light: '#a7c7e7',
    dark: '#2d3c53',
    green: '#d6ebdb',
    yellow: '#f7eabf',
    red: '#eed8da',
    pink: '#eed8e4',
    blue: '#d4e0f2',
    violet: '#e3dcef'
  } satisfies Record<Theme, string>;

  return themeColors[theme] || themeColors.light;
}

export function updateMetaThemeColor(theme: Theme): void {
  if (typeof document === 'undefined') return;

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) return;

  metaThemeColor.setAttribute('content', getThemeMetaColor(theme));
}

// Get theme color values for CSS custom properties
export function getThemeColors(theme: Theme) {
  const lightBase = {
    foreground: '240 10% 4%',
    'card-foreground': '240 10% 4%',
    'secondary-foreground': '240 10% 4%',
    'muted-foreground': '240 4% 38%',
    destructive: '0 72% 51%',
    'destructive-foreground': '0 0% 98%',
    success: '142 72% 36%',
    'success-foreground': '0 0% 98%',
    warning: '38 92% 50%',
    'warning-foreground': '32 70% 12%'
  };

  const darkBase = {
    background: '216 30% 25%',
    foreground: '210 40% 98%',
    card: '217 27% 19%',
    'card-foreground': '210 40% 98%',
    secondary: '216 24% 31%',
    'secondary-foreground': '210 40% 98%',
    muted: '216 22% 32%',
    'muted-foreground': '214 18% 72%',
    destructive: '0 72% 56%',
    'destructive-foreground': '0 0% 98%',
    success: '142 68% 48%',
    'success-foreground': '144 70% 8%',
    warning: '38 92% 56%',
    'warning-foreground': '35 70% 10%',
    border: '216 18% 39%',
    input: '216 18% 39%'
  };

  const themeColors = {
    light: {
      ...lightBase,
      background: '210 57% 78%',
      foreground: '218 42% 14%',
      card: '210 74% 96%',
      'card-foreground': '218 42% 14%',
      secondary: '210 50% 88%',
      'secondary-foreground': '218 42% 14%',
      muted: '210 48% 91%',
      'muted-foreground': '216 18% 32%',
      primary: '212 66% 38%',
      'primary-foreground': '0 0% 98%',
      accent: '168 36% 88%',
      'accent-foreground': '184 38% 18%',
      border: '210 32% 68%',
      input: '210 32% 68%',
      ring: '212 66% 38%',
      value: '212 66% 38%'
    },
    dark: {
      ...darkBase,
      primary: '207 85% 74%',
      'primary-foreground': '218 35% 14%',
      accent: '216 24% 31%',
      'accent-foreground': '207 85% 78%',
      ring: '207 85% 74%',
      value: '207 85% 74%'
    },
    green: {
      ...lightBase,
      background: '134 34% 88%',
      card: '126 44% 94%',
      'card-foreground': '240 10% 4%',
      secondary: '138 34% 82%',
      muted: '132 28% 84%',
      primary: '142 30% 46%',
      'primary-foreground': '150 34% 13%',
      destructive: '356 28% 58%',
      'destructive-foreground': '356 34% 16%',
      warning: '38 46% 58%',
      'warning-foreground': '34 50% 13%',
      accent: '88 42% 82%',
      'accent-foreground': '142 72% 24%',
      border: '137 22% 63%',
      input: '137 20% 59%',
      ring: '142 34% 38%',
      value: '142 34% 38%'
    },
    yellow: {
      ...lightBase,
      background: '46 78% 86%',
      card: '45 72% 94%',
      'card-foreground': '240 10% 4%',
      secondary: '43 58% 80%',
      muted: '44 50% 83%',
      primary: '38 42% 56%',
      'primary-foreground': '36 52% 13%',
      destructive: '356 28% 58%',
      'destructive-foreground': '356 34% 16%',
      warning: '38 46% 58%',
      'warning-foreground': '34 50% 13%',
      accent: '38 72% 86%',
      'accent-foreground': '38 92% 22%',
      border: '41 32% 62%',
      input: '41 30% 58%',
      ring: '38 46% 42%',
      value: '38 46% 42%'
    },
    red: {
      ...lightBase,
      background: '356 38% 89%',
      card: '0 48% 95%',
      'card-foreground': '240 10% 4%',
      secondary: '356 34% 84%',
      muted: '356 30% 86%',
      primary: '356 24% 56%',
      'primary-foreground': '356 34% 16%',
      destructive: '356 26% 58%',
      'destructive-foreground': '356 34% 16%',
      warning: '38 46% 58%',
      'warning-foreground': '34 50% 13%',
      accent: '18 48% 84%',
      'accent-foreground': '0 72% 28%',
      border: '356 24% 65%',
      input: '356 22% 60%',
      ring: '356 30% 42%',
      value: '356 30% 42%'
    },
    pink: {
      ...lightBase,
      background: '326 40% 89%',
      card: '328 52% 95%',
      'card-foreground': '240 10% 4%',
      secondary: '326 36% 84%',
      muted: '326 32% 86%',
      primary: '330 30% 58%',
      'primary-foreground': '330 34% 16%',
      destructive: '344 28% 56%',
      'destructive-foreground': '344 34% 16%',
      warning: '38 46% 58%',
      'warning-foreground': '34 50% 13%',
      accent: '280 42% 85%',
      'accent-foreground': '330 81% 32%',
      border: '326 26% 65%',
      input: '326 24% 60%',
      ring: '330 34% 44%',
      value: '330 34% 44%'
    },
    blue: {
      ...lightBase,
      background: '215 55% 89%',
      card: '213 68% 95%',
      'card-foreground': '240 10% 4%',
      secondary: '214 47% 84%',
      muted: '215 40% 86%',
      primary: '218 30% 56%',
      'primary-foreground': '220 42% 16%',
      destructive: '356 28% 58%',
      'destructive-foreground': '356 34% 16%',
      warning: '38 46% 58%',
      'warning-foreground': '34 50% 13%',
      accent: '203 72% 84%',
      'accent-foreground': '221 83% 30%',
      border: '218 25% 66%',
      input: '218 23% 62%',
      ring: '218 32% 48%',
      value: '218 32% 48%'
    },
    violet: {
      ...lightBase,
      background: '262 38% 90%',
      card: '260 50% 96%',
      'card-foreground': '240 10% 4%',
      secondary: '262 34% 85%',
      muted: '260 30% 87%',
      primary: '262 30% 58%',
      'primary-foreground': '262 34% 17%',
      destructive: '350 28% 56%',
      'destructive-foreground': '350 34% 16%',
      warning: '38 46% 58%',
      'warning-foreground': '34 50% 13%',
      accent: '294 38% 86%',
      'accent-foreground': '262 83% 34%',
      border: '262 24% 66%',
      input: '262 22% 62%',
      ring: '262 34% 46%',
      value: '262 34% 46%'
    }
  };

  return themeColors[theme] || themeColors.light;
}
