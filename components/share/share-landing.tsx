'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { sdk } from '@farcaster/miniapp-sdk';
import { useAccount } from 'wagmi';
import AddToFarcasterButton from '@/components/share/add-to-farcaster-button';
import { Card, CardContent } from '@/components/ui/card';

const BASE_URL = process.env.NEXT_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://mini.pixotchi.tech');

interface CastShareData {
  author?: {
    fid: number;
    username?: string;
    displayName?: string;
    pfpUrl?: string;
  };
  hash: string;
  text?: string;
  timestamp?: number;
  channelKey?: string;
}

export default function ShareLanding() {
  const searchParams = useSearchParams();
  const { address } = useAccount(); // Get wallet address from wagmi
  const [castData, setCastData] = useState<CastShareData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for cast share context
  useEffect(() => {
    const checkCastShare = async () => {
      try {
        // Check if we're in Mini App
        const inMiniApp = await sdk.isInMiniApp();
        
        if (inMiniApp) {
          // Try to get cast from SDK context (most reliable)
          try {
            const context = await sdk.context;
            if (context?.location?.type === 'cast_share') {
              const castLocation = (context.location as any);
              const cast = castLocation.cast;
              if (cast) {
                const castData = {
                  author: {
                    fid: cast.author.fid,
                    username: cast.author.username,
                    displayName: cast.author.displayName,
                    pfpUrl: cast.author.pfp?.url,
                  },
                  hash: cast.hash,
                  text: cast.text,
                  timestamp: cast.timestamp,
                  channelKey: cast.channel?.key,
                };
                
                setCastData(castData);
                
                // Auto-share to public chat if wallet is connected
                if (address && castData.hash) {
                  try {
                    const response = await fetch('/api/chat/share-cast', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        address: address,
                        castData: castData,
                      }),
                    });
                    
                    if (response.ok) {
                      console.log('✅ Cast shared to public chat');
                    } else {
                      console.warn('Failed to share cast to chat:', await response.text());
                    }
                  } catch (error) {
                    console.warn('Error sharing cast to chat:', error);
                  }
                }
                
                setIsLoading(false);
                return;
              }
            }
          } catch (e) {
            console.warn('Failed to get cast from SDK context:', e);
          }
        }

        // Fallback: Check URL parameters
        const castHash = searchParams.get('castHash');
        const castFid = searchParams.get('castFid');
        
        if (castHash && castFid) {
          // Basic cast data from URL params
          setCastData({
            hash: castHash,
            author: {
              fid: parseInt(castFid, 10),
            },
          });
        }
      } catch (error) {
        console.error('Error checking cast share:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkCastShare();
  }, [searchParams, address]); // Add address to deps since we use it

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading shared content...</p>
        </div>
      </div>
    );
  }

  // Cast share view
  if (castData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl space-y-8 text-center">
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-[0.4em] text-slate-400">Cast Shared to Pixotchi</p>
            <h1 className="text-4xl font-bold">
              {castData.author?.displayName || castData.author?.username || 'A Farcaster user'} shared a cast!
            </h1>
            <p className="text-slate-300">
              Check out this cast and join the conversation in Pixotchi Mini.
            </p>
          </div>

          <Card className="border-white/10 bg-white/5 backdrop-blur-lg">
            <CardContent className="p-6 space-y-4">
              {/* Author info */}
              <div className="flex items-center gap-3">
                {castData.author?.pfpUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img 
                    src={castData.author.pfpUrl} 
                    alt={castData.author.displayName || 'User'} 
                    className="w-12 h-12 rounded-full"
                  />
                )}
                <div className="text-left">
                  <p className="font-semibold">
                    {castData.author?.displayName || castData.author?.username || `FID ${castData.author?.fid}`}
                  </p>
                  {castData.author?.username && (
                    <p className="text-sm text-slate-400">@{castData.author.username}</p>
                  )}
                </div>
              </div>

              {/* Cast text */}
              {castData.text && (
                <p className="text-left text-slate-200 whitespace-pre-wrap">
                  {castData.text}
                </p>
              )}

              {/* Channel info */}
              {castData.channelKey && (
                <p className="text-sm text-slate-400 text-left">
                  Posted in /{castData.channelKey}
                </p>
              )}

              {/* Cast hash */}
              <p className="text-xs text-slate-500 text-left font-mono">
                {castData.hash.slice(0, 10)}...{castData.hash.slice(-8)}
              </p>
            </CardContent>
          </Card>

          <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-lg shadow-xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BASE_URL}/og-image.png`} alt="Pixotchi Mini" className="w-full h-auto" />
            <div className="p-6 space-y-2 text-sm text-left text-slate-300">
              <p>✅ View casts shared by your community</p>
              <p>✅ Engage with content in your onchain garden</p>
              <p>✅ Share your own plants and achievements</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full bg-green-500 px-6 py-3 font-semibold text-slate-900 shadow hover:bg-green-400 transition"
            >
              Open in Pixotchi Mini
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

  // Default landing page (no cast shared)
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
