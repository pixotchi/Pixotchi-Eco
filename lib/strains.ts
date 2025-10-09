export type StrainVisual = {
  id: number;
  code: string;
  displayName: string;
  image: string;
  gradient: [string, string];
  accent: string;
  emoji: string;
  tagline: string;
  shareDescription: string;
};

const defaultVisual: StrainVisual = {
  id: 4,
  code: 'ZEST',
  displayName: 'ZEST',
  image: '/icons/plant5.png',
  gradient: ['#F6D365', '#FDA085'],
  accent: '#F97316',
  emoji: '🌼',
  tagline: 'High-energy blossom that thrives in any farm.',
  shareDescription: 'Bright, energetic plants cultivated on Base with Pixotchi Mini.'
};

const STRAIN_VISUALS: Record<number, StrainVisual> = {
  1: {
    id: 1,
    code: 'OG',
    displayName: 'OG',
    image: '/icons/plant1.svg',
    gradient: ['#7BD88F', '#1B5E20'],
    accent: '#2F855A',
    emoji: '🌱',
    tagline: 'Classic cultivar with balanced growth and solid roots.',
    shareDescription: 'A dependable OG sprouted on Pixotchi Mini—care for yours on Base.'
  },
  2: {
    id: 2,
    code: 'FLORA',
    displayName: 'FLORA',
    image: '/icons/plant2.svg',
    gradient: ['#A5C0FF', '#3451B2'],
    accent: '#2563EB',
    emoji: '🌸',
    tagline: 'Bloom-focused strain that loves attention and careful care.',
    shareDescription: 'Blooming FLORA freshly minted in Pixotchi Mini—come grow yours.'
  },
  3: {
    id: 3,
    code: 'TAKI',
    displayName: 'TAKI',
    image: '/icons/plant3WithFrame.svg',
    gradient: ['#FEE3A0', '#F59E0B'],
    accent: '#D97706',
    emoji: '🔥',
    tagline: 'Fiery cultivar with fast growth and bold personality.',
    shareDescription: 'TAKI ignited on Pixotchi Mini—stoke your own farm on Base.'
  },
  4: defaultVisual,
  5: {
    id: 5,
    code: 'TYJ',
    displayName: 'TYJ',
    image: '/icons/plant4WithFrame.svg',
    gradient: ['#B794F4', '#6B21A8'],
    accent: '#7C3AED',
    emoji: '💎',
    tagline: 'Mythic-class strain prized for rarity and resilience.',
    shareDescription: 'Mythic TYJ blossomed in Pixotchi Mini—claim your legendary seedling.'
  },
};

export function getStrainVisual(id?: number | null): StrainVisual {
  if (!id) return defaultVisual;
  return STRAIN_VISUALS[id] ?? defaultVisual;
}

export function buildMintShareText(strainName?: string, emoji?: string): string {
  const safeEmoji = emoji || '🌱';
  const safeName = strainName || 'Pixotchi plant';
  return `${safeEmoji} Just minted a ${safeName} on Pixotchi Mini!`;
}



