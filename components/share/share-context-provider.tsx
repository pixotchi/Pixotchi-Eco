"use client";

import { ReactNode, useEffect, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import Link from "next/link";

interface ShareContextProviderProps {
  shareData?: unknown;
  clearShareData?: () => void;
  children: ReactNode;
}

export default function ShareContextProvider({ children }: ShareContextProviderProps) {
  const [castShare, setCastShare] = useState<any>(null);

  useEffect(() => {
    try {
      const location = (sdk as any)?.context?.location;
      if (location?.type === "cast_share") {
        setCastShare(location);
      }
    } catch (error) {
      console.warn("Unable to read miniapp share context", error);
    }
  }, []);

  if (castShare?.type === "cast_share") {
    const cast = castShare.cast;
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6 py-12">
        <div className="max-w-xl space-y-4 text-center">
          <h1 className="text-3xl font-bold">Cast shared to Pixotchi Mini</h1>
          <p className="text-sm text-slate-300">
            @{cast?.author?.username || cast?.author?.fid} shared a cast with us:
          </p>
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-left space-y-2">
            <p className="text-sm whitespace-pre-wrap">{cast?.text}</p>
            {Array.isArray(cast?.embeds) && cast.embeds.length > 0 ? (
              <div className="text-xs text-slate-400">
                Embeds:
                <ul className="list-disc pl-4">
                  {cast.embeds.map((embed: string, idx: number) => (
                    <li key={idx}>{embed}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-green-500 px-6 py-3 font-semibold text-slate-900 shadow hover:bg-green-400 transition"
          >
            Open Pixotchi Mini
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
