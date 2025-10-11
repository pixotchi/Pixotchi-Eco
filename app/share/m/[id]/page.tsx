import { notFound } from "next/navigation";
import type { Metadata, ResolvingMetadata } from "next";
import { redisGetJSON } from "@/lib/redis";

export const dynamic = "force-dynamic";

const DEPLOYMENT_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
const BASE_URL = process.env.NEXT_PUBLIC_URL || DEPLOYMENT_URL || "https://mini.pixotchi.tech";

interface MintShareData {
  address: string;
  basename?: string;
  strain: string;
  name: string;
  mintedAt: string;
  tx?: string;
}

function getOgImageUrl(data: MintShareData, platform: 'twitter' | 'farcaster' = 'farcaster') {
  const og = new URL("/api/og/mint", BASE_URL);
  og.searchParams.set('platform', platform);
  og.searchParams.set('address', data.address);
  if (data.basename) og.searchParams.set('basename', data.basename);
  og.searchParams.set('strain', data.strain);
  og.searchParams.set('name', data.name);
  og.searchParams.set('mintedAt', data.mintedAt);
  if (data.tx) og.searchParams.set('tx', data.tx);
  return og.toString();
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  // Resolve params in Next.js 15
  const { id } = await params;
  
  // Resolve the short ID from Redis
  const data = await redisGetJSON<MintShareData>(`share:mint:${id}`);

  if (!data) {
    // Fallback metadata if share link expired or doesn't exist
    return {
      title: "Pixotchi Mini - Plant & Earn",
      description: "Join Pixotchi Mini – Plant your SEED and climb the leaderboard to earn ETH rewards!",
    };
  }

  // Generate platform-specific OG images
  const farcasterImageUrl = getOgImageUrl(data, 'farcaster');
  const twitterImageUrl = getOgImageUrl(data, 'twitter');

  const miniAppEmbed = {
    version: "1",
    imageUrl: farcasterImageUrl,
    button: {
      title: "Play Pixotchi Mini",
      action: {
        type: "launch_miniapp",
        name: "Pixotchi Mini",
        url: BASE_URL,
        splashImageUrl: `${BASE_URL}/splash.png`,
        splashBackgroundColor: "#2d3c53",
      },
    },
  };

  const frameEmbed = {
    ...miniAppEmbed,
    button: {
      ...miniAppEmbed.button,
      action: {
        ...miniAppEmbed.button.action,
        type: "launch_frame",
      },
    },
  };

  return {
    title: `I just minted a ${data.name}!`,
    description: "Join me in Pixotchi Mini – Plant your own SEED and climb the leaderboard to earn ETH rewards!",
    openGraph: {
      title: `I just minted a ${data.name}!`,
      description: "Join me in Pixotchi Mini – Plant your own SEED and climb the leaderboard to earn ETH rewards!",
      url: `${BASE_URL}/share/m/${id}`,
      type: "website",
      images: [{ url: farcasterImageUrl, width: 1200, height: 800, alt: data.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: `I just minted a ${data.name}!`,
      description: "Join me in Pixotchi Mini – Plant your own SEED and climb the leaderboard to earn ETH rewards!",
      images: [twitterImageUrl],
    },
    other: {
      "fc:miniapp": JSON.stringify(miniAppEmbed),
      "fc:frame": JSON.stringify(frameEmbed),
    },
  };
}

export default async function ShortMintSharePage({ params }: { params: Promise<{ id: string }> }) {
  // Resolve params in Next.js 15
  const { id } = await params;
  
  // Resolve the short ID from Redis
  const data = await redisGetJSON<MintShareData>(`share:mint:${id}`);

  if (!data) {
    notFound();
  }

  const redirectUrl = `${BASE_URL}/?utm_source=share&utm_medium=mint&utm_content=${id}`;

  // Return a page with meta refresh for crawlers and immediate JS redirect for users
  return (
    <html>
      <head>
        <meta httpEquiv="refresh" content={`0;url=${redirectUrl}`} />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{
          __html: `window.location.href = ${JSON.stringify(redirectUrl)};`
        }} />
        <noscript>
          <p>Redirecting to Pixotchi Mini...</p>
          <a href={redirectUrl}>Click here if you are not redirected</a>
        </noscript>
      </body>
    </html>
  );
}

