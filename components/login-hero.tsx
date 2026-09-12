import Image from "next/image";
import type { ReactNode } from 'react';

/**
 * The hook-free half of the login screen.
 *
 * Deliberately NOT a client component: it is rendered as the `fallback` for the
 * provider tower's readiness gate (app/(game)/layout.tsx), so it is present in the
 * server-rendered HTML. Before this existed the entire prerendered body of `/` was
 * the string "Preparing wallet login..." — that was the LCP element, and the real
 * login screen only appeared once Privy and the host-environment probe had settled.
 *
 * app/(game)/page.tsx renders the same component once connected state is known, so
 * the markup has one source of truth and the swap is visually seamless.
 */
export function LoginHero({ title = "PIXOTCHI" }: { title?: string }) {
  return (
    <div className="login-hero flex flex-col items-center gap-4">
      <Image
        src="/PixotchiKit/Logonotext.svg"
        alt="Pixotchi Mini Logo"
        width={72}
        height={72}
        sizes="72px"
        quality={90}
        preload
        className="h-[72px] w-[72px] [image-rendering:pixelated]"
      />
      <h1 className="text-2xl leading-snug font-pixel text-foreground max-[360px]:text-xl">{title}</h1>
    </div>
  );
}

export function LoginIntro() {
  return (
    <p className="login-intro-copy mt-3 text-sm leading-6 text-muted-foreground">
      Your pixel garden on Base.
    </p>
  );
}

/** Shared geometry keeps the server fallback and ready sign-in screen aligned. */
export function LoginPanel({ title, children }: { title?: string; children: ReactNode }) {
  return <div className="login-safe-area">
    <div className="login-panel">
      <div className="login-hero-copy text-center">
        <LoginHero title={title} />
        <LoginIntro />
      </div>
      {children}
    </div>
  </div>;
}

/** The full centred hero, used as the pre-hydration fallback. */
export function LoginHeroPanel({ title }: { title?: string }) {
  return (
    <div className="login-scene login-fallback-safe-area">
      <LoginPanel title={title}>
        <div className="login-auth-actions-placeholder" aria-hidden="true">
          <div className="h-12 rounded-[0.75rem] bg-primary/10" />
          <div className="h-12 rounded-[0.75rem] border border-[hsl(var(--edge-panel))]" />
        </div>
      </LoginPanel>
    </div>
  );
}
