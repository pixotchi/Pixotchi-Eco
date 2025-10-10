import React from 'react';
import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://mini.pixotchi.tech';

const gradients: Record<number, [string, string]> = {
  1: ['#0f172a', '#2563eb'],
  2: ['#14532d', '#22c55e'],
  3: ['#7c2d12', '#f97316'],
  4: ['#4c1d95', '#a855f7'],
  5: ['#1f2937', '#facc15'],
};

const artMap: Record<number, string> = {
  1: '/icons/plant1.svg',
  2: '/icons/plant2.svg',
  3: '/icons/plant3WithFrame.svg',
  4: '/icons/plant4WithFrame.svg',
  5: '/icons/plant5.png',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || 'Pixotchi Plant';
  const strain = Number(searchParams.get('strain') || '1');
  const mintedAt = searchParams.get('mintedAt');
  const [from, to] = gradients[strain] || ['#0f172a', '#2dd4bf'];
  const artUrl = new URL(artMap[strain] || '/icons/plant1.svg', BASE_URL).toString();

  const element = React.createElement(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
        color: '#f8fafc',
        fontFamily: 'sans-serif',
      },
    },
    React.createElement(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      React.createElement('div', { style: { fontSize: 54, fontWeight: 700 } }, 'Pixotchi Mini'),
      React.createElement(
        'div',
        {
          style: {
            borderRadius: 999,
            padding: '12px 24px',
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 24,
          },
        },
        name,
      ),
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 48, alignItems: 'center' } },
      React.createElement(
        'div',
        {
          style: {
            width: 420,
            height: 420,
            borderRadius: 48,
            background: 'rgba(15, 23, 42, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 40px 80px rgba(15,23,42,0.35)',
            border: '1px solid rgba(255,255,255,0.08)',
            overflow: 'hidden',
          },
        },
        React.createElement('img', {
          src: artUrl,
          alt: name,
          width: 320,
          height: 320,
          style: { objectFit: 'contain' },
        }),
      ),
      React.createElement(
        'div',
        { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 32 } },
        React.createElement(
          'div',
          { style: { fontSize: 48, fontWeight: 700, lineHeight: 1.2 } },
          `A new ${name} was just minted on Base.`,
        ),
        React.createElement(
          'div',
          { style: { fontSize: 26, opacity: 0.85 } },
          'Every plant is unique—care for it, grow daily streaks, and climb the leaderboard to earn ETH & SEED rewards.',
        ),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: 24, fontSize: 24, opacity: 0.8 } },
          React.createElement('span', null, `Strain #${strain}`),
          mintedAt ? React.createElement('span', null, `Minted ${new Date(mintedAt).toLocaleString()}`) : null,
        ),
      ),
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', fontSize: 24, opacity: 0.7 } },
      React.createElement('span', null, 'mini.pixotchi.tech'),
      React.createElement('span', null, 'Grow • Compete • Earn'),
    ),
  );

  return new ImageResponse(element, {
    width: 1200,
    height: 630,
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
    },
  });
}
