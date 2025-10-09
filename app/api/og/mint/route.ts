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

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '60px',
          background: `linear-gradient(135deg, ${visual.gradient[0]}, ${visual.gradient[1]})`,
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '60%' }}>
          <div style={{
            fontSize: '24px',
            textTransform: 'uppercase',
            letterSpacing: '6px',
            opacity: 0.8,
          }}>
            Pixotchi Mini • Base Network
          </div>
          <div style={{ fontSize: '64px', fontWeight: 700, lineHeight: 1.1, marginTop: '20px' }}>
            {title}
          </div>
          <div style={{ fontSize: '28px', marginTop: '20px', opacity: 0.85 }}>
            {subtitle}
          </div>
          <div style={{ fontSize: '24px', marginTop: '32px', opacity: 0.9 }}>
            {visual.tagline}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '320px',
            height: '320px',
            borderRadius: '48px',
            backgroundColor: 'rgba(255,255,255,0.18)',
            border: '2px solid rgba(255,255,255,0.35)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.2)',
            overflow: 'hidden',
          }}
        >
          <img
            src={`${visual.image.startsWith('http') ? visual.image : `${process.env.NEXT_PUBLIC_URL || 'https://mini.pixotchi.tech'}${visual.image}`}`}
            alt={visual.displayName}
            style={{
              width: '80%',
              height: '80%',
              objectFit: 'contain',
              filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.35))',
            }}
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


