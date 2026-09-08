
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
export const THEME_NAMES = Object.values(THEMES);


// CSS is the only palette source. Browser chrome reads its computed token.
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



export function updateMetaThemeColor(): void {
  if (typeof document === 'undefined') return;
  const token = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  if (!token) return;
  const color = hslTokenToHex(token);
  let metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (!metas.length) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
    metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  }
  metas.forEach(meta => { if (meta.content !== color) meta.content = color; });
}
