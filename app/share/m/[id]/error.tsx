"use client";

import { Button } from "@/components/ui/button";

export default function MintShareError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-center">
      <div className="w-full max-w-lg space-y-4 rounded-[var(--radius-panel)] border border-border bg-card p-6 shadow-[var(--shadow-panel)]">
        <h1 className="font-pixel text-2xl text-foreground">Share temporarily unavailable</h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t reach this share&apos;s data. Try again in a moment.
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
