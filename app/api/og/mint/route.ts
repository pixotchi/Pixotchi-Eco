import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getStrainVisual, buildMintShareText } from '@/lib/strains';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenId = searchParams.get('tokenId');
  const strainParam = searchParams.get('strain');
  const strainId = strainParam ? Number.parseInt(strainParam, 10) : undefined;
  const visual = getStrainVisual(Number.isNaN(strainId) ? undefined : strainId);

  const title = buildMintShareText(visual.displayName, visual.emoji);
  const subtitle = tokenId ? `Token #${tokenId}` : 'Freshly minted on Pixotchi Mini';

  const baseImageUrl = visual.image.startsWith('http')
    ? visual.image
    : `${process.env.NEXT_PUBLIC_URL || 'https://mini.pixotchi.tech'}${visual.image}`;

  return new ImageResponse(
    (
      <div
        tw="flex h-[630px] w-[1200px] items-center justify-between px-16"
        style={{
          background: `linear-gradient(135deg, ${visual.gradient[0]}, ${visual.gradient[1]})`,
          color: '#ffffff',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div tw="flex h-full w-[60%] flex-col justify-center">
          <div tw="text-[24px] uppercase tracking-[6px] opacity-80">
            Pixotchi Mini • Base Network
          </div>
          <div tw="mt-5 text-[64px] font-bold leading-[1.1]">
            {title}
          </div>
          <div tw="mt-5 text-[28px] opacity-90">{subtitle}</div>
          <div tw="mt-8 text-[24px] opacity-90">{visual.tagline}</div>
        </div>
        <div tw="flex h-[320px] w-[320px] items-center justify-center rounded-[48px] bg-[rgba(255,255,255,0.18)] border-[2px] border-[rgba(255,255,255,0.35)] shadow-[0_24px_60px_rgba(0,0,0,0.2)]">
          <img
            src={baseImageUrl}
            alt={visual.displayName}
            tw="h-[80%] w-[80%] object-contain"
            style={{ filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.35))' }}
          />
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}


