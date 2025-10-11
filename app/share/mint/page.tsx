import Link from "next/link";
import type { Metadata, ResolvingMetadata } from "next";
import AddToFarcasterButton from "@/components/share/add-to-farcaster-button";

export const dynamic = "force-dynamic";

const DEPLOYMENT_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
const BASE_URL = process.env.NEXT_PUBLIC_URL || DEPLOYMENT_URL || "https://mini.pixotchi.tech";

function getOgImageUrl(params: URLSearchParams, platform: 'twitter' | 'farcaster' = 'farcaster') {
  const og = new URL("/api/og/mint", BASE_URL);
  og.searchParams.set('platform', platform);
  params.forEach((value, key) => {
    if (value) og.searchParams.set(key, value);
  });
  return og.toString();
}

export async function generateMetadata(
  { searchParams }: { searchParams: Promise<any> },
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  // Resolve searchParams in Next.js 15
  const resolvedSearchParams = await searchParams;
  
  const params = new URLSearchParams();
  Object.entries(resolvedSearchParams || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value[0] ?? "");
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  });

  const name = params.get("name") || "Pixotchi Plant";
  const strain = params.get("strain") || "1";
  
  // Generate platform-specific OG images
  const farcasterImageUrl = getOgImageUrl(params, 'farcaster');
  const twitterImageUrl = getOgImageUrl(params, 'twitter');

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
    title: `I just minted a ${name}!`,
    description: "Join me in Pixotchi Mini – Plant your own SEED and climb the leaderboard to earn ETH rewards!",
    openGraph: {
      title: `I just minted a ${name}!`,
      description: "Join me in Pixotchi Mini – Plant your own SEED and climb the leaderboard to earn ETH rewards!",
      url: `${BASE_URL}/share/mint`,
      type: "website",
      images: [{ url: farcasterImageUrl, width: 1200, height: 800, alt: name }],
    },
    twitter: {
      card: "summary_large_image",
      title: `I just minted a ${name}!`,
      description: "Join me in Pixotchi Mini – Plant your own SEED and climb the leaderboard to earn ETH rewards!",
      images: [twitterImageUrl],
    },
    other: {
      "fc:miniapp": JSON.stringify(miniAppEmbed),
      "fc:frame": JSON.stringify(frameEmbed),
    },
  };
}

export default async function MintSharePage({ searchParams }: { searchParams: Promise<any> }) {
  // Resolve searchParams in Next.js 15
  const resolvedSearchParams = await searchParams;
  
  const params = new URLSearchParams();
  Object.entries(resolvedSearchParams || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value[0] ?? "");
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  });

  const name = params.get("name") || "Plant";
  const strain = params.get("strain") || "1";
  const mintedAt = params.get("mintedAt");
  const address = params.get("address");
  const imageUrl = getOgImageUrl(params);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl space-y-8 text-center">
        <div className="space-y-4">
          <p className="text-sm uppercase tracking-[0.4em] text-slate-400">Mint Spotlight</p>
          <h1 className="text-4xl font-bold">{name} has sprouted!</h1>
          <p className="text-slate-300">
            A new plant was just minted on Base. Join us and Plant your own SEED, grow daily streaks, and climb the leaderboard to earn ETH rewards!
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-lg shadow-xl overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={name} className="w-full h-auto" />
          <div className="p-6 space-y-2 text-sm text-left text-slate-300">
            <p><span className="text-slate-400">Strain:</span> #{strain}</p>
            {address ? (
              <p>
                <span className="text-slate-400">Planted by:</span> {address.slice(0, 6)}…{address.slice(-4)}
              </p>
            ) : null}
            {mintedAt ? (
              <p>
                <span className="text-slate-400">Planted on:</span> {new Date(mintedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-green-500 px-6 py-3 font-semibold text-slate-900 shadow hover:bg-green-400 transition"
          >
            Start playing Pixotchi Mini
          </Link>
          <AddToFarcasterButton
            url={`https://warpcast.com/~/add-miniapp?url=${encodeURIComponent(BASE_URL)}`}
            className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-3 font-semibold text-slate-100 hover:bg-white/10 transition"
          >
            Add to Farcaster
          </AddToFarcasterButton>
        </div>

        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">mini.pixotchi.tech</p>
      </div>
    </div>
  );
}
