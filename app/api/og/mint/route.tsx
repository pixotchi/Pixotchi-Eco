import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const OG_WIDTH = 1200;
const OG_HEIGHT = 800;
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

const pixelmixBuffer = readFileSync(path.join(process.cwd(), 'public', 'fonts', 'pixelmix.ttf'));

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || 'Pixotchi Plant';
  const strain = Number(searchParams.get('strain') || '1');
  const mintedAt = formatDate(searchParams.get('mintedAt'));
  const [from, to] = gradients[strain] || ['#0f172a', '#2dd4bf'];
  const artUrl = new URL(artMap[strain] || '/icons/plant1.svg', BASE_URL).toString();

  return new ImageResponse(
    <div
      style={{
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '80px 96px',
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
        color: '#f8fafc',
        fontFamily: 'Pixelmix, sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: 2 }}>Pixotchi Mini</div>
        <div
          style={{
            borderRadius: 999,
            padding: '16px 32px',
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 28,
            textTransform: 'uppercase',
            letterSpacing: 4,
          }}
        >
          {name}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 56, alignItems: 'center' }}>
        <div
          style={{
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
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artUrl} alt={name} width={320} height={320} style={{ objectFit: 'contain' }} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 36 }}>
          <div style={{ fontSize: 54, fontWeight: 700, lineHeight: 1.1 }}>
            A new {name} was just minted on Base.
          </div>
          <div style={{ fontSize: 28, opacity: 0.9, lineHeight: 1.3 }}>
            Plant, nurture, and flex your onchain garden. Keep your streak alive to earn SEED & ETH rewards.
          </div>
          <div style={{ display: 'flex', gap: 28, fontSize: 26, opacity: 0.85 }}>
            <span>Strain #{strain}</span>
            {mintedAt ? <span>Minted {mintedAt}</span> : null}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, opacity: 0.75 }}>
        <span>mini.pixotchi.tech</span>
        <span>Grow • Compete • Earn</span>
      </div>
    </div>,
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: {
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate',
      },
      fonts: [
        {
          name: 'Pixelmix',
          data: pixelmixBuffer,
          weight: 400,
          style: 'normal',
        },
      ],
    }
  );
}
