"use client";

import { openExternalUrl } from "@/lib/open-external";
import type { ReactNode } from "react";

interface AddToFarcasterButtonProps {
  url: string;
  className?: string;
  children: ReactNode;
}

export default function AddToFarcasterButton({ url, className, children }: AddToFarcasterButtonProps) {
  return (
    <button
      type="button"
      onClick={() => openExternalUrl(url)}
      className={className}
    >
      {children}
    </button>
  );
}
