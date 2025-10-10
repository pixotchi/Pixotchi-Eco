import Link from 'next/link';
import AddToFarcasterButton from '@/components/share/add-to-farcaster-button';

const BASE_URL = process.env.NEXT_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://mini.pixotchi.tech');

export default function ShareLanding() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl space-y-8 text-center">
        <div className="space-y-4">
          <p className="text-sm uppercase tracking-[0.4em] text-slate-400">Shared from Farcaster</p>
          <h1 className="text-4xl font-bold">Welcome to Pixotchi Mini</h1>
          <p className="text-slate-300">
            Pixotchi Mini is a Farcaster Mini App that lets you mint plants, build lands, and compete with friends.
            Join thousands of players caring for their onchain gardens and earning rewards.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-lg shadow-xl overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE_URL}/og-image.png`} alt="Pixotchi Mini" className="w-full h-auto" />
          <div className="p-6 space-y-2 text-sm text-left text-slate-300">
            <p>✅ Mint unique plant NFTs on Base.</p>
            <p>✅ Grow lands, unlock buildings, and climb the leaderboard.</p>
            <p>✅ Battle friends, share achievements, and earn SEED & ETH rewards.</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-green-500 px-6 py-3 font-semibold text-slate-900 shadow hover:bg-green-400 transition"
          >
            Launch Pixotchi Mini
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
