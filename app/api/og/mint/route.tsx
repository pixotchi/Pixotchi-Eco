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
        tw="flex flex-col w-full h-full justify-between"
        style={{
          padding: '72px 96px',
          backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
          color: '#f8fafc',
          fontFamily: '"DM Sans", "Inter", sans-serif',
        }}
      >
        <div tw="flex items-center justify-between">
          <div tw="text-[60px] font-bold tracking-[1px]">Pixotchi Mini</div>
          <div
            tw="flex items-center uppercase tracking-[3px] rounded-full border border-white/40 px-7 py-3 text-[26px]"
            style={{ backgroundColor: 'rgba(15,23,42,0.15)' }}
          >
            {name}
          </div>
        </div>

        <div tw="flex items-center gap-12">
          <div
            tw="flex items-center justify-center rounded-[44px] border border-white/10 shadow-[0px_40px_80px_rgba(15,23,42,0.35)]"
            style={{
              width: 360,
              height: 360,
              backgroundColor: 'rgba(15, 23, 42, 0.35)',
              backgroundImage: `url(${artUrl})`,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
            }}
          />

          <div tw="flex flex-col gap-7 flex-1">
            <div tw="text-[48px] font-bold leading-[1.1]">A new {name} was just minted on Base.</div>
            <div tw="text-[26px] opacity-90 leading-[1.35]">
              Plant, nurture, and flex your onchain garden. Keep your streak alive to earn SEED & ETH rewards.
            </div>
            <div tw="flex items-center gap-6 text-[24px] opacity-85">
              <span>Strain #{strain}</span>
              {mintedAt ? <span>Minted {mintedAt}</span> : null}
            </div>
          </div>
        </div>

        <div tw="flex items-center justify-between text-[24px] opacity-75">
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
      <div tw="flex flex-col items-center justify-center w-full h-full" style={{ background: '#0f172a', color: '#f8fafc' }}>
        <div tw="text-[60px] font-bold">Pixotchi Mini</div>
        <p tw="text-[30px] opacity-85 mt-6">Refresh to load the mint preview.</p>
      </div>,
      {
        width: OG_WIDTH,
        height: OG_HEIGHT,
      }
    );
  }
}
