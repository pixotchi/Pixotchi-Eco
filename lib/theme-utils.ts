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
    green: '#dceee0',
    yellow: '#fff6d6',
    red: '#f2dfe1',
    pink: '#f1e4ec',
    blue: '#dbe6f2',
    violet: '#e9e3f1'
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
  const themeColors = {
    light: {
      background: '210 57% 78%',
      foreground: '218 42% 14%',
      card: '210 74% 96%',
      'card-foreground': '218 42% 14%',
      primary: '212 66% 38%',
      'primary-foreground': '0 0% 98%',
      secondary: '210 50% 88%',
      'secondary-foreground': '218 42% 14%',
      muted: '210 48% 91%',
      'muted-foreground': '216 18% 32%',
      accent: '168 36% 88%',
      'accent-foreground': '184 38% 18%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '210 32% 68%',
      input: '210 32% 68%',
      ring: '212 66% 38%'
    },
    dark: {
      background: '216 30% 25%',
      foreground: '210 40% 98%',
      card: '217 27% 19%',
      'card-foreground': '210 40% 98%',
      primary: '207 85% 74%',
      'primary-foreground': '218 35% 14%',
      secondary: '216 24% 31%',
      'secondary-foreground': '210 40% 98%',
      muted: '216 22% 32%',
      'muted-foreground': '214 18% 72%',
      accent: '174 20% 34%',
      'accent-foreground': '210 40% 98%',
      destructive: '0 62.8% 30.6%',
      'destructive-foreground': '0 0% 98%',
      border: '216 18% 39%',
      input: '216 18% 39%',
      ring: '207 85% 74%'
    },
    green: {
      background: '138 32% 90%',
      foreground: '150 34% 12%',
      card: '128 38% 97%',
      'card-foreground': '150 34% 12%',
      primary: '150 58% 32%',
      'primary-foreground': '0 0% 98%',
      secondary: '134 29% 84%',
      'secondary-foreground': '150 34% 12%',
      muted: '138 24% 88%',
      'muted-foreground': '142 17% 34%',
      accent: '83 38% 87%',
      'accent-foreground': '104 34% 18%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '137 20% 72%',
      input: '137 20% 72%',
      ring: '150 58% 32%'
    },
    yellow: {
      background: '52 100% 92%',
      foreground: '42 42% 14%',
      card: '54 100% 98%',
      'card-foreground': '42 42% 14%',
      primary: '37 86% 42%',
      'primary-foreground': '40 48% 10%',
      secondary: '51 100% 88%',
      'secondary-foreground': '42 42% 14%',
      muted: '52 85% 91%',
      'muted-foreground': '39 28% 32%',
      accent: '188 48% 90%',
      'accent-foreground': '190 46% 18%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '47 46% 76%',
      input: '47 46% 76%',
      ring: '37 86% 42%'
    },
    red: {
      background: '357 42% 91%',
      foreground: '355 36% 14%',
      card: '0 48% 97%',
      'card-foreground': '355 36% 14%',
      primary: '355 66% 44%',
      'primary-foreground': '0 0% 98%',
      secondary: '358 31% 86%',
      'secondary-foreground': '355 36% 14%',
      muted: '358 28% 90%',
      'muted-foreground': '354 21% 35%',
      accent: '24 36% 88%',
      'accent-foreground': '18 38% 18%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '357 23% 74%',
      input: '357 23% 74%',
      ring: '355 66% 44%'
    },
    pink: {
      background: '327 38% 92%',
      foreground: '326 34% 14%',
      card: '328 48% 98%',
      'card-foreground': '326 34% 14%',
      primary: '327 66% 45%',
      'primary-foreground': '0 0% 98%',
      secondary: '326 32% 87%',
      'secondary-foreground': '326 34% 14%',
      muted: '326 30% 91%',
      'muted-foreground': '326 18% 36%',
      accent: '266 30% 90%',
      'accent-foreground': '266 34% 18%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '326 22% 75%',
      input: '326 22% 75%',
      ring: '327 66% 45%'
    },
    blue: {
      background: '217 56% 89%',
      foreground: '219 50% 13%',
      card: '214 62% 97%',
      'card-foreground': '219 50% 13%',
      primary: '221 78% 50%',
      'primary-foreground': '0 0% 98%',
      secondary: '214 46% 84%',
      'secondary-foreground': '219 50% 13%',
      muted: '214 36% 89%',
      'muted-foreground': '217 22% 36%',
      accent: '184 42% 88%',
      'accent-foreground': '192 44% 18%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '217 28% 72%',
      input: '217 28% 72%',
      ring: '221 78% 50%'
    },
    violet: {
      background: '262 38% 92%',
      foreground: '263 36% 14%',
      card: '260 42% 98%',
      'card-foreground': '263 36% 14%',
      primary: '263 58% 51%',
      'primary-foreground': '0 0% 98%',
      secondary: '260 32% 87%',
      'secondary-foreground': '263 36% 14%',
      muted: '260 28% 91%',
      'muted-foreground': '263 18% 36%',
      accent: '316 32% 90%',
      'accent-foreground': '312 34% 18%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '260 22% 75%',
      input: '260 22% 75%',
      ring: '263 58% 51%'
    }
  };

  return themeColors[theme] || themeColors.light;
}
