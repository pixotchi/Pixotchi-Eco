import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://mini.pixotchi.tech';

function getGradient(strainId: number) {
  const gradients: Record<number, [string, string]> = {
    1: ['#0f172a', '#2563eb'],
    2: ['#14532d', '#22c55e'],
    3: ['#7c2d12', '#f97316'],
    4: ['#4c1d95', '#a855f7'],
    5: ['#1f2937', '#facc15'],
  };
  return gradients[strainId] || ['#0f172a', '#2dd4bf'];
}

function getPlantArt(strainId: number) {
  const artMap: Record<number, string> = {
    1: '/icons/plant1.svg',
    2: '/icons/plant2.svg',
    3: '/icons/plant3WithFrame.svg',
    4: '/icons/plant4WithFrame.svg',
    5: '/icons/plant5.png',
  };
  const path = artMap[strainId] || '/icons/plant1.svg';
  return new URL(path, BASE_URL).toString();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || 'Pixotchi Plant';
  const strain = Number(searchParams.get('strain') || '1');
  const mintedAt = searchParams.get('mintedAt');
  const [from, to] = getGradient(strain);
  const plantImageUrl = getPlantArt(strain);

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
          color: '#f8fafc',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 54, fontWeight: 700 }}>Pixotchi Mini</div>
          <div
            style={{
              borderRadius: '999px',
              padding: '12px 24px',
              border: '1px solid rgba(255,255,255,0.4)',
              fontSize: 24,
            }}
          >
            {name}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 48, alignItems: 'center' }}>
          <div
            style={{
              width: 420,
              height: 420,
              borderRadius: '48px',
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
            <img
              src={plantImageUrl}
              width={320}
              height={320}
              style={{ objectFit: 'contain' }}
              alt={name}
            />
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 32 }}>
            <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.2 }}>
              A new {name} was just minted on Base.
            </div>
            <div style={{ fontSize: 26, opacity: 0.85 }}>
              Every plant is unique—care for it, grow daily streaks, and climb the leaderboard to earn ETH & SEED rewards.
            </div>
            <div
              style={{
                display: 'flex',
                gap: 24,
                fontSize: 24,
                opacity: 0.8,
              }}
            >
              <span>Strain #{strain}</span>
              {mintedAt ? <span>Minted {new Date(mintedAt).toLocaleString()}</span> : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, opacity: 0.7 }}>
          <span>mini.pixotchi.tech</span>
          <span>Grow • Compete • Earn</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
      },
    }
  );
}
