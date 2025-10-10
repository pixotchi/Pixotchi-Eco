import type { Metadata } from "next";
import ShareLanding from '@/components/share/share-landing';

const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://mini.pixotchi.tech';

const miniAppEmbed = {
  version: '1',
  imageUrl: `${BASE_URL}/og-image.png`,
  button: {
    title: 'Play Pixotchi Mini',
    action: {
      type: 'launch_miniapp',
      name: 'Pixotchi Mini',
      url: BASE_URL,
      splashImageUrl: `${BASE_URL}/splash.png`,
      splashBackgroundColor: '#2d3c53',
    },
  },
};

const frameEmbed = {
  ...miniAppEmbed,
  button: {
    ...miniAppEmbed.button,
    action: {
      ...miniAppEmbed.button.action,
      type: 'launch_frame',
    },
  },
};

export const metadata: Metadata = {
  title: 'Pixotchi Mini – Share',
  description: 'Pixotchi Mini is your pocket farm on Base. Mint plants, grow lands, and compete with friends.',
  openGraph: {
    title: 'Pixotchi Mini – Share',
    description: 'Pixotchi Mini is your pocket farm on Base. Mint plants, grow lands, and compete with friends.',
    url: `${BASE_URL}/share`,
    type: 'website',
    images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630, alt: 'Pixotchi Mini' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pixotchi Mini – Share',
    description: 'Pixotchi Mini is your pocket farm on Base. Mint plants, grow lands, and compete with friends.',
    images: [`${BASE_URL}/og-image.png`],
  },
  other: {
    'fc:miniapp': JSON.stringify(miniAppEmbed),
    'fc:frame': JSON.stringify(frameEmbed),
  },
};

export default ShareLanding;
