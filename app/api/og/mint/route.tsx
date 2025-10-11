import { ImageResponse } from 'next/og';

export const runtime = 'edge';

// Platform-specific dimensions
const DIMENSIONS = {
  twitter: { width: 1200, height: 630, bg: '/twitter-og.png' },
  farcaster: { width: 1200, height: 800, bg: '/farcaster-og.png' },
};

// Strain IDs from contract are 1-indexed
const strainNames: Record<number, string> = {
  1: 'Flora',
  2: 'Taki',
  3: 'Rosa',
  4: 'Zest',
  5: 'TYJ',
};

// Plant images match mint tab: strain.id - 1 = array index
const artMap: Record<number, string> = {
  1: '/icons/plant1.svg',   // Flora
  2: '/icons/plant2.svg',   // Taki
  3: '/icons/plant3WithFrame.svg',  // Rosa
  4: '/icons/plant4WithFrame.svg',  // Zest
  5: '/icons/plant5.png',   // TYJ
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

function formatAddress(address: string): string {
  // Check if it's a basename or ENS (contains a dot)
  if (address.includes('.')) {
    return address;
  }
  // Otherwise format as short address
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);

  try {
    const { searchParams } = new URL(request.url);
    const platform = (searchParams.get('platform') || 'farcaster') as 'twitter' | 'farcaster';
    const address = searchParams.get('address') || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
    const basename = searchParams.get('basename');
    const strain = Number(searchParams.get('strain') || '1');
    const strainName = strainNames[strain] || 'Flora';
    
    const dimensions = DIMENSIONS[platform];
    const bgUrl = new URL(dimensions.bg, baseUrl).toString();
    const plantUrl = new URL(artMap[strain] || artMap[1], baseUrl).toString();
    // Use basename if provided, otherwise format the address
    const displayAddress = basename || formatAddress(address);

    // Load custom fonts
    const pixelFontUrl = new URL('/fonts/pixelmix.ttf', baseUrl).toString();
    const pixelFontData = await fetch(pixelFontUrl).then(res => res.arrayBuffer());
    
    const coinbaseFontUrl = new URL('/fonts/Coinbase-Sans/Coinbase_Sans-Bold-web-1.32.woff2', baseUrl).toString();
    const coinbaseFontData = await fetch(coinbaseFontUrl).then(res => res.arrayBuffer());

    return new ImageResponse(
      <div
        style={{
          display: 'flex',
          width: dimensions.width,
          height: dimensions.height,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundImage: `url(${bgUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          fontFamily: '"Coinbase Sans", sans-serif',
        }}
      >
        {/* Left side - Large plant image */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: dimensions.width * 0.45,
            height: '100%',
            padding: '60px',
          }}
        >
          <img
            src={plantUrl}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        </div>

        {/* Right side - Text content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            width: dimensions.width * 0.55,
            height: '100%',
            padding: '60px 80px 60px 40px',
            gap: 32,
            color: '#ffffff',
          }}
        >
          {/* Main message */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: platform === 'twitter' ? 42 : 52,
              fontWeight: 700,
              lineHeight: 1.2,
              textShadow: '0 2px 10px rgba(0,0,0,0.3)',
              fontFamily: '"Coinbase Sans", sans-serif',
            }}
          >
            <span style={{ display: 'flex', fontFamily: '"DM Sans", "Inter", sans-serif' }}>{displayAddress}</span>
            <span style={{ display: 'flex', fontFamily: '"DM Sans", "Inter", sans-serif' }}>planted SEEDs</span>
            <span style={{ display: 'flex', fontFamily: '"DM Sans", "Inter", sans-serif' }}>on Base to grow a</span>
            <span style={{ display: 'flex', color: '#4ade80', fontFamily: 'Pixelmix' }}>{strainName}</span>
          </div>

          {/* Call to action */}
          <div
            style={{
              display: 'flex',
              fontSize: platform === 'twitter' ? 22 : 26,
              lineHeight: 1.4,
              opacity: 0.95,
              textShadow: '0 2px 8px rgba(0,0,0,0.3)',
              fontFamily: '"Coinbase Sans", sans-serif',
            }}
          >
            Start your onchain farming journey today and earn ETH rewards on Base app!
          </div>

          {/* Footer branding */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginTop: platform === 'twitter' ? 20 : 40,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: platform === 'twitter' ? 32 : 36,
                fontWeight: 700,
                opacity: 1,
                textShadow: '0 2px 8px rgba(0,0,0,0.3)',
                fontFamily: '"Coinbase Sans", sans-serif',
              }}
            >
              mini.pixotchi.tech
            </div>
          </div>
        </div>
      </div>,
      {
        width: dimensions.width,
        height: dimensions.height,
        fonts: [
          {
            name: 'Coinbase Sans',
            data: coinbaseFontData,
            style: 'normal',
            weight: 700,
          },
          {
            name: 'Pixelmix',
            data: pixelFontData,
            style: 'normal',
            weight: 400,
          },
        ],
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
          width: 1200,
          height: 800,
          background: '#0f172a',
          color: '#f8fafc',
          fontFamily: '"Coinbase Sans", sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', fontSize: 60, fontWeight: 700 }}>Pixotchi Mini</div>
        <div style={{ display: 'flex', marginTop: 24, fontSize: 30, opacity: 0.85 }}>Refresh to load the mint preview.</div>
      </div>,
      {
        width: 1200,
        height: 800,
      }
    );
  }
}
