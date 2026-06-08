import { redisGetJSON } from "@/lib/redis";
import type { MintShareData } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const DEPLOYMENT_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
const BASE_URL = process.env.NEXT_PUBLIC_URL || DEPLOYMENT_URL || "https://mini.pixotchi.tech";
const PLANT_IMAGE_BY_STRAIN: Record<number, string> = {
  1: "/icons/plant1.svg",
  2: "/icons/plant2.svg",
  3: "/icons/plant3WithFrame.svg",
  4: "/icons/plant4WithFrame.svg",
  5: "/icons/plant5.png",
};

function getOgImageUrl(data: MintShareData, platform: 'twitter' | 'farcaster' = 'farcaster') {
  const og = new URL("/api/og/mint", BASE_URL);
  og.searchParams.set('platform', platform);
  og.searchParams.set('address', data.address);
  if (data.basename) og.searchParams.set('basename', data.basename);
  if (data.strain) og.searchParams.set('strain', data.strain);
  if (data.name) og.searchParams.set('name', data.name);
  og.searchParams.set('mintedAt', data.mintedAt);
  if (data.tx) og.searchParams.set('tx', data.tx);
  return og.toString();
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  // Resolve params in Next.js 15
  const { id } = await params;
  const shareUrl = `${BASE_URL}/share/m/${id}`;
  
  // Resolve the short ID from Redis
  const data = await redisGetJSON<MintShareData>(`share:mint:${id}`);

  if (!data) {
    // Fallback metadata if share link expired or doesn't exist
    return {
      title: "Pixotchi Mini - Plant & Earn",
      description: "Join Pixotchi Mini – Plant your SEED and climb the leaderboard to earn ETH rewards!",
      alternates: {
        canonical: shareUrl,
      },
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
        splashBackgroundColor: "#1f2d42",
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
    alternates: {
      canonical: shareUrl,
    },
    openGraph: {
      title: `I just minted a ${data.name}!`,
      description: "Join me in Pixotchi Mini – Plant your own SEED and climb the leaderboard to earn ETH rewards!",
      url: shareUrl,
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

  const plantName = data.name || "Plant";
  const strainId = Number(data.strain || 1);
  const plantImage = PLANT_IMAGE_BY_STRAIN[strainId] || PLANT_IMAGE_BY_STRAIN[1];

  // Keep this page stable so social crawlers can render the mint-specific OG image.
  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-gradient-to-b from-background via-background to-muted/60 px-6 py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 text-center">
        <Image
          src={plantImage}
          alt={`${plantName} plant`}
          width={128}
          height={128}
          className="h-32 w-32 object-contain"
        />
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.35em] text-primary/70">Pixotchi Mini</p>
          <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">
            I just minted a {plantName}!
          </h1>
          <p className="mx-auto max-w-xl text-sm text-muted-foreground sm:text-base">
            Join me in Pixotchi Mini, plant your own SEED, and climb the leaderboard to earn ETH rewards.
          </p>
        </div>
        <Button asChild size="lg" className="px-8">
          <a href={BASE_URL}>Play Pixotchi Mini</a>
        </Button>
      </div>
    </main>
  );
}
