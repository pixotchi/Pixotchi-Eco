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

// Client-side theme management
export function getClientTheme(): Theme {
  if (typeof window === 'undefined') return 'light';

  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme;
    return stored && THEMES[stored] ? stored : 'light';
  } catch (error) {
    console.warn('Error getting client theme:', error);
    return 'light';
  }
}

export function setClientTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    // Also set as cookie for server-side consistency
    document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax`;

    // Apply theme immediately
    applyTheme(theme);
  } catch (error) {
    console.warn('Error setting client theme:', error);
  }
}

// Apply theme to document
export function applyTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;

  try {
    const root = document.documentElement;

    // Remove all theme classes
    Object.values(THEMES).forEach(themeName => {
      root.classList.remove(themeName);
    });

    // Add the new theme class
    root.classList.add(theme);

    // Update meta theme-color
    updateMetaThemeColor(theme);
  } catch (error) {
    console.warn('Error applying theme:', error);
  }
}

// Update meta theme-color based on theme
function updateMetaThemeColor(theme: Theme): void {
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) return;

  const themeColors = {
    light: '#a7c7e7',
    dark: '#2d3c53',
    green: '#22c55e',
    yellow: '#eab308',
    red: '#ef4444',
    pink: '#ec4899',
    blue: '#3b82f6',
    violet: '#8b5cf6'
  };

  metaThemeColor.setAttribute('content', themeColors[theme] || themeColors.light);
}

// Get theme color values for CSS custom properties
export function getThemeColors(theme: Theme) {
  const themeColors = {
    light: {
      background: '212 56% 81%', // #a7c7e7
      foreground: '224 71.4% 4.1%',
      card: '212 56% 75%',
      'card-foreground': '224 71.4% 4.1%',
      primary: '212 86.2% 36.3%',
      'primary-foreground': '0 0% 98%',
      secondary: '212 56% 88%',
      'secondary-foreground': '220.9 39.3% 11%',
      muted: '212 56% 88%',
      'muted-foreground': '225 8% 35%',
      accent: '212 56% 92%',
      'accent-foreground': '220.9 39.3% 11%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '212 56% 70%',
      input: '212 56% 70%',
      ring: '212 86.2% 36.3%'
    },
    dark: {
      background: '218 28% 25%', // #2d3c53
      foreground: '210 40% 98%',
      card: '218 28% 20%',
      'card-foreground': '210 40% 98%',
      primary: '212 86.2% 50%',
      'primary-foreground': '0 0% 98%',
      secondary: '218 28% 30%',
      'secondary-foreground': '210 40% 98%',
      muted: '218 28% 30%',
      'muted-foreground': '215 16% 65%',
      accent: '218 28% 35%',
      'accent-foreground': '210 40% 98%',
      destructive: '0 62.8% 30.6%',
      'destructive-foreground': '0 0% 98%',
      border: '218 28% 30%',
      input: '218 28% 30%',
      ring: '212 86.2% 50%'
    },
    green: {
      background: '120 100% 95%',
      foreground: '120 100% 12%',
      card: '120 80% 88%',
      'card-foreground': '120 100% 12%',
      primary: '120 100% 25%',
      'primary-foreground': '0 0% 98%',
      secondary: '120 70% 82%',
      'secondary-foreground': '120 100% 18%',
      muted: '120 60% 85%',
      'muted-foreground': '120 50% 30%',
      accent: '120 90% 78%',
      'accent-foreground': '120 100% 22%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '120 70% 70%',
      input: '120 70% 70%',
      ring: '120 100% 25%'
    },
    yellow: {
      background: '50 100% 94%',
      foreground: '45 100% 15%',
      card: '50 100% 85%',
      'card-foreground': '45 100% 15%',
      primary: '50 100% 40%',
      'primary-foreground': '45 100% 10%',
      secondary: '50 80% 78%',
      'secondary-foreground': '45 100% 20%',
      muted: '50 60% 82%',
      'muted-foreground': '45 80% 25%',
      accent: '50 100% 75%',
      'accent-foreground': '45 100% 22%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '50 80% 65%',
      input: '50 80% 65%',
      ring: '50 100% 40%'
    },
    red: {
      background: '0 100% 95%',
      foreground: '0 100% 15%',
      card: '0 80% 88%',
      'card-foreground': '0 100% 15%',
      primary: '0 100% 40%',
      'primary-foreground': '0 0% 98%',
      secondary: '0 70% 82%',
      'secondary-foreground': '0 100% 20%',
      muted: '0 60% 85%',
      'muted-foreground': '0 50% 30%',
      accent: '0 90% 78%',
      'accent-foreground': '0 100% 22%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '0 70% 70%',
      input: '0 70% 70%',
      ring: '0 100% 40%'
    },
    pink: {
      background: '320 100% 95%',
      foreground: '320 100% 15%',
      card: '320 80% 88%',
      'card-foreground': '320 100% 15%',
      primary: '320 100% 40%',
      'primary-foreground': '0 0% 98%',
      secondary: '320 70% 82%',
      'secondary-foreground': '320 100% 20%',
      muted: '320 60% 85%',
      'muted-foreground': '320 50% 30%',
      accent: '320 90% 78%',
      'accent-foreground': '320 100% 22%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '320 70% 70%',
      input: '320 70% 70%',
      ring: '320 100% 40%'
    },
    blue: {
      background: '217 90% 75%',
      foreground: '217 100% 10%',
      card: '217 90% 70%',
      'card-foreground': '217 100% 10%',
      primary: '217 100% 62%',
      'primary-foreground': '0 0% 98%',
      secondary: '217 95% 80%',
      'secondary-foreground': '217 100% 10%',
      muted: '217 80% 80%',
      'muted-foreground': '217 40% 35%',
      accent: '217 95% 85%',
      'accent-foreground': '217 100% 10%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '217 95% 65%',
      input: '217 95% 80%',
      ring: '217 100% 62%'
    },
    violet: {
      background: '268 100% 96%',
      foreground: '268 80% 12%',
      card: '268 60% 92%',
      'card-foreground': '268 80% 12%',
      primary: '268 88% 55%',
      'primary-foreground': '0 0% 98%',
      secondary: '268 60% 82%',
      'secondary-foreground': '268 80% 14%',
      muted: '268 50% 88%',
      'muted-foreground': '268 35% 32%',
      accent: '275 80% 80%',
      'accent-foreground': '270 80% 14%',
      destructive: '0 84.2% 60.2%',
      'destructive-foreground': '0 0% 98%',
      border: '268 45% 72%',
      input: '268 45% 72%',
      ring: '268 88% 55%'
    }
  };

  return themeColors[theme] || themeColors.light;
}
