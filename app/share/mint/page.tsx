import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getStrainVisual } from '@/lib/strains';

type PageProps = {
  searchParams: {
    tokenId?: string;
    strain?: string;
  };
};

const BASE_URL = (process.env.NEXT_PUBLIC_URL || 'https://mini.pixotchi.tech').replace(/\/$/, '');

function buildOgImage(searchParams: PageProps['searchParams']) {
  const qp = new URLSearchParams();
  if (searchParams.tokenId) qp.set('tokenId', searchParams.tokenId);
  if (searchParams.strain) qp.set('strain', searchParams.strain);
  const query = qp.toString();
  return `${BASE_URL}/api/og/mint${query ? `?${query}` : ''}`;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const strainId = Number.parseInt(searchParams.strain ?? '', 10);
  const visual = getStrainVisual(Number.isNaN(strainId) ? undefined : strainId);
  const tokenLabel = searchParams.tokenId ? ` #${searchParams.tokenId}` : '';
  const title = `${visual.emoji} Minted ${visual.displayName}${tokenLabel} | Pixotchi Mini`;
  const description = visual.shareDescription;
  const imageUrl = buildOgImage(searchParams);

  const miniAppEmbed = {
    version: '1',
    imageUrl,
    button: {
      title: 'Play Pixotchi Mini',
      action: {
        type: 'launch_miniapp' as const,
        name: 'Pixotchi Mini',
        url: BASE_URL,
        splashImageUrl: `${BASE_URL}/splash.png`,
        splashBackgroundColor: '#2d3c53',
      },
    },
  };

  const frameEmbed = {
    ...miniAppEmbed,
    button: {
      ...miniAppEmbed.button,
      action: {
        ...miniAppEmbed.button.action,
        type: 'launch_frame' as const,
      },
    },
  };

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/share/mint`,
      type: 'website',
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
    other: {
      'fc:miniapp': JSON.stringify(miniAppEmbed),
      'fc:frame': JSON.stringify(frameEmbed),
    },
  };
}

export default function MintSharePage({ searchParams }: PageProps) {
  const strainId = Number.parseInt(searchParams.strain ?? '', 10);
  const visual = getStrainVisual(Number.isNaN(strainId) ? undefined : strainId);
  const tokenLabel = searchParams.tokenId ? `#${searchParams.tokenId}` : 'Fresh Mint';
  const pixelFont = 'font-pixel';

  return (
    <main className="min-h-screen bg-gradient-to-b from-background via-background/95 to-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
        <section
          className="relative overflow-hidden rounded-3xl border border-border/40 bg-background/80 shadow-xl"
        >
          <div
            className="absolute inset-0 opacity-60"
            style={{
              background: `linear-gradient(135deg, ${visual.gradient[0]}, ${visual.gradient[1]})`,
            }}
          />
          <div className="relative grid gap-6 p-8 md:grid-cols-[1.5fr_1fr]">
            <div className="space-y-4">
              <span className="inline-flex items-center rounded-full bg-black/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
                {tokenLabel}
              </span>
              <h1 className={`text-3xl font-semibold text-white md:text-4xl ${pixelFont}`}>
                {visual.emoji} {visual.displayName}
              </h1>
              <p className="max-w-xl text-white/80">
                {visual.tagline}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={BASE_URL}
                  className="inline-flex items-center rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
                >
                  Open Pixotchi Mini
                </Link>
                <a
                  href={`${BASE_URL}/?surface=privy`}
                  className="inline-flex items-center rounded-lg border border-white/0 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
                >
                  Play in browser
                </a>
              </div>
            </div>
            <div className="relative flex items-center justify-center">
              <div className="relative h-48 w-48 rounded-3xl border border-white/30 bg-white/20 backdrop-blur">
                <Image
                  src={visual.image}
                  alt={visual.displayName}
                  fill
                  className="object-contain p-6"
                  sizes="192px"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-border/50 bg-card/80 p-6">
            <h2 className="text-lg font-semibold">Grow your own</h2>
            <p className="text-sm text-muted-foreground">
              Pixotchi Mini is a Farcaster-ready onchain garden. Mint plants, nurture them daily, and compete on the Base network leaderboard.
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• Daily care loop keeps your plant thriving.</li>
              <li>• Earn SEED rewards and unlock unique land upgrades.</li>
              <li>• Battle, trade items, and climb community rankings.</li>
            </ul>
          </div>
          <div className="space-y-3 rounded-2xl border border-border/50 bg-card/80 p-6">
            <h2 className="text-lg font-semibold">Share this moment</h2>
            <p className="text-sm text-muted-foreground">
              Use the share buttons inside Pixotchi Mini to post your progress directly to Farcaster or X with rich preview cards.
            </p>
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
              <div className="text-xs uppercase tracking-wide text-muted-foreground/80">Suggested cast text</div>
              <p className="mt-2 font-medium text-foreground">
                {buildMintShareText(visual.displayName, visual.emoji)}
              </p>
              <code className="mt-2 block break-all rounded bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                {buildOgImage(searchParams)}
              </code>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}


