import Link from "next/link";
import type { Metadata, ResolvingMetadata } from "next";

type SearchParams = Record<string, string | string[] | undefined>;

const BASE_URL = process.env.NEXT_PUBLIC_URL || "https://mini.pixotchi.tech";

function getOgImageUrl(params: URLSearchParams) {
  const og = new URL("/api/og/mint", BASE_URL);
  params.forEach((value, key) => {
    if (value) og.searchParams.set(key, value);
  });
  return og.toString();
}

export async function generateMetadata(
  { searchParams }: { searchParams?: SearchParams },
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const params = new URLSearchParams();
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value[0]);
    } else if (value) {
      params.set(key, value);
    }
  });

  const name = params.get("name") || "Pixotchi Plant";
  const strain = params.get("strain") || "1";
  const imageUrl = getOgImageUrl(params);

  const miniAppEmbed = {
    version: "1",
    imageUrl,
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
    description: "Join me in Pixotchi Mini – mint, grow, and compete on Base.",
    openGraph: {
      title: `I just minted a ${name}!`,
      description: "Join me in Pixotchi Mini – mint, grow, and compete on Base.",
      url: `${BASE_URL}/share/mint`,
      type: "website",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: name }],
    },
    twitter: {
      card: "summary_large_image",
      title: `I just minted a ${name}!`,
      description: "Join me in Pixotchi Mini – mint, grow, and compete on Base.",
      images: [imageUrl],
    },
    other: {
      "fc:miniapp": JSON.stringify(miniAppEmbed),
      "fc:frame": JSON.stringify(frameEmbed),
    },
  };
}

export default function MintSharePage({ searchParams }: { searchParams?: SearchParams }) {
  const params = new URLSearchParams();
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value[0]);
    } else if (value) {
      params.set(key, value);
    }
  });

  const name = params.get("name") || "Pixotchi Plant";
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
            A new Pixotchi plant was just minted on Base. Adopt your own, grow daily streaks, and climb the leaderboard to earn rewards.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-lg shadow-xl overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={name} className="w-full h-auto" />
          <div className="p-6 space-y-2 text-sm text-left text-slate-300">
            <p><span className="text-slate-400">Strain:</span> #{strain}</p>
            {address ? (
              <p>
                <span className="text-slate-400">Minted by:</span> {address.slice(0, 6)}…{address.slice(-4)}
              </p>
            ) : null}
            {mintedAt ? (
              <p>
                <span className="text-slate-400">Minted on:</span> {new Date(mintedAt).toLocaleString()}
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
          <a
            href={BASE_URL}
            className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-3 font-semibold text-slate-100 hover:bg-white/10 transition"
          >
            Learn more
          </a>
        </div>

        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">mini.pixotchi.tech</p>
      </div>
    </div>
  );
}
