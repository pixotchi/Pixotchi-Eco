import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

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

function resolveBaseUrl(request: Request) {
  const host = request.headers.get('host') ?? 'mini.pixotchi.tech';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);

  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name') || 'Pixotchi Plant';
    const strain = Number(searchParams.get('strain') || '1');
    const mintedAt = formatDate(searchParams.get('mintedAt'));
    const [from, to] = gradients[strain] || ['#0f172a', '#2dd4bf'];
    const artUrl = new URL(artMap[strain] || '/icons/plant1.svg', baseUrl).toString();

    return new ImageResponse(
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: OG_WIDTH,
          height: OG_HEIGHT,
          justifyContent: 'space-between',
          padding: '72px 96px',
          backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
          color: '#f8fafc',
          fontFamily: '"DM Sans", "Inter", sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 60, fontWeight: 700, letterSpacing: 1 }}>Pixotchi Mini</div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              padding: '14px 30px',
              border: '1px solid rgba(255,255,255,0.4)',
              fontSize: 26,
              textTransform: 'uppercase',
              letterSpacing: 3,
              backgroundColor: 'rgba(15,23,42,0.2)',
            }}
          >
            {name}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 48,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 360,
              height: 360,
              borderRadius: 44,
              backgroundColor: 'rgba(15,23,42,0.35)',
              backgroundImage: `url(${artUrl})`,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
              boxShadow: '0 40px 80px rgba(15,23,42,0.35)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
              flex: 1,
            }}
          >
            <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1 }}>
              A new {name} was just minted on Base.
            </div>
            <div style={{ fontSize: 26, opacity: 0.9, lineHeight: 1.35 }}>
              Plant, nurture, and flex your onchain garden. Keep your streak alive to earn SEED & ETH rewards.
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 24,
                fontSize: 24,
                opacity: 0.85,
              }}
            >
              <span>Strain #{strain}</span>
              {mintedAt ? <span>Minted {mintedAt}</span> : null}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 24,
            opacity: 0.75,
          }}
        >
          <span>mini.pixotchi.tech</span>
          <span>Grow • Compete • Earn</span>
        </div>
      </div>,
      {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error) {
    console.error('OG mint image generation failed', error);
    return new ImageResponse(
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: OG_WIDTH,
          height: OG_HEIGHT,
          background: '#0f172a',
          color: '#f8fafc',
          fontFamily: '"DM Sans", "Inter", sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 60, fontWeight: 700 }}>Pixotchi Mini</div>
        <p style={{ marginTop: 24, fontSize: 30, opacity: 0.85 }}>Refresh to load the mint preview.</p>
      </div>,
      {
        width: OG_WIDTH,
        height: OG_HEIGHT,
      }
    );
  }
}
