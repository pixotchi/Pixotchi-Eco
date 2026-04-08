/* eslint-disable @next/next/no-img-element */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { PLANT_STRAINS, PLANT_ART_MAP } from '@/lib/constants';

export const runtime = 'nodejs';

type Platform = 'twitter' | 'farcaster';

type BundledAsset = {
  publicPath: string;
  mimeType: string;
  width: number;
  height: number;
};

// Platform-specific dimensions
const DIMENSIONS = {
  twitter: { width: 1200, height: 630, bg: '/twitter-og.png' },
  farcaster: { width: 1200, height: 800, bg: '/farcaster-og.png' },
};

// Create strain names map from centralized constants
const strainNames: Record<number, string> = Object.fromEntries(
  PLANT_STRAINS.map(s => [s.id, s.name])
);

// Use plant art map from centralized constants
const artMap = PLANT_ART_MAP;

const BACKGROUND_ASSETS: Record<Platform, BundledAsset> = {
  twitter: {
    publicPath: 'twitter-og.png',
    mimeType: 'image/png',
    width: 1200,
    height: 630,
  },
  farcaster: {
    publicPath: 'farcaster-og.png',
    mimeType: 'image/png',
    width: 1200,
    height: 800,
  },
};

const PLANT_ASSETS: Record<number, BundledAsset> = Object.fromEntries(
  Object.entries(artMap).map(([key, publicPath]) => [
    Number(key),
    {
      publicPath: publicPath.replace(/^\//, ''),
      mimeType: publicPath.endsWith('.png') ? 'image/png' : 'image/svg+xml',
      width: publicPath.endsWith('.png') ? 1500 : 600,
      height: publicPath.endsWith('.png') ? 1500 : 600,
    },
  ])
) as Record<number, BundledAsset>;

const binaryAssetCache = new Map<string, Promise<Buffer>>();
const dataUrlCache = new Map<string, Promise<string>>();

async function loadPublicAssetBinary(publicPath: string): Promise<Buffer> {
  let pending = binaryAssetCache.get(publicPath);

  if (!pending) {
    pending = readFile(join(process.cwd(), 'public', publicPath));

    binaryAssetCache.set(publicPath, pending);
  }

  try {
    return await pending;
  } catch (error) {
    binaryAssetCache.delete(publicPath);
    throw error;
  }
}

async function loadBundledDataUrl(asset: BundledAsset): Promise<string> {
  const cacheKey = `${asset.publicPath}:${asset.mimeType}`;
  let pending = dataUrlCache.get(cacheKey);

  if (!pending) {
    pending = loadPublicAssetBinary(asset.publicPath).then(
      (buffer) => `data:${asset.mimeType};base64,${buffer.toString('base64')}`
    );
    dataUrlCache.set(cacheKey, pending);
  }

  try {
    return await pending;
  } catch (error) {
    dataUrlCache.delete(cacheKey);
    throw error;
  }
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
  try {
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform') === 'twitter' ? 'twitter' : 'farcaster';
    const address = searchParams.get('address') || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
    const basename = searchParams.get('basename');
    const strain = Number(searchParams.get('strain') || '1');
    const strainName = strainNames[strain] || 'Flora';

    const dimensions = DIMENSIONS[platform];
    const backgroundAsset = BACKGROUND_ASSETS[platform];
    const plantAsset = PLANT_ASSETS[strain] || PLANT_ASSETS[1];
    // Use basename if provided, otherwise format the address
    const displayAddress = basename || formatAddress(address);

    // Load OG assets from the bundle instead of self-fetching over HTTP.
    const [bgUrl, plantUrl, pixelFontData, mainFontData] = await Promise.all([
      loadBundledDataUrl(backgroundAsset),
      loadBundledDataUrl(plantAsset),
      loadPublicAssetBinary('fonts/pixelmix.ttf'),
      loadPublicAssetBinary('fonts/AdelleSans-Semibold.woff'),
    ]);

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
          fontFamily: 'AdelleSans, sans-serif',
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
            alt=""
            width={plantAsset.width}
            height={plantAsset.height}
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
              fontFamily: 'AdelleSans, sans-serif',
            }}
          >
            <span style={{ display: 'flex', fontFamily: 'AdelleSans, sans-serif' }}>{displayAddress}</span>
            <span style={{ display: 'flex', fontFamily: 'AdelleSans, sans-serif' }}>planted SEEDs</span>
            <span style={{ display: 'flex', fontFamily: 'AdelleSans, sans-serif' }}>on Base to grow a</span>
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
              fontFamily: 'AdelleSans, sans-serif',
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
                fontFamily: 'AdelleSans, sans-serif',
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
            name: 'AdelleSans',
            data: mainFontData,
            style: 'normal',
            weight: 600,
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
          fontFamily: 'AdelleSans, sans-serif',
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
