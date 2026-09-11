import Image from "next/image";
import { GardenPreview } from './garden-preview';

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
    <div className="login-hero mb-5 flex w-full flex-col items-center gap-4">
      <div className="flex items-center gap-2.5">
        <Image
          src="/PixotchiKit/Logonotext.svg"
          alt="Pixotchi Mini Logo"
          width={28}
          height={28}
          sizes="28px"
          quality={90}
        />
        <h1 className="text-lg font-pixel text-foreground">{title}</h1>
      </div>
      <GardenPreview />
    </div>
  );
}

export function LoginIntro() {
  return (
    <>
      <h2 className="login-intro-title type-page-title mb-2 text-foreground">A little care. A growing world.</h2>
      <p className="login-intro-copy text-muted-foreground mb-6 max-w-xs md:max-w-md">
        Find your first plant, keep it growing, and build your own farm on Base. Sign in with a wallet or email to begin.
      </p>
    </>
  );
}

/** The full centred hero, used as the pre-hydration fallback. */
export function LoginHeroPanel({ title }: { title?: string }) {
  return (
    <div className="login-fallback-safe-area login-safe-area relative z-10 flex min-h-dvh flex-col items-center overflow-y-auto overscroll-contain p-4 md:p-4 xl:p-5">
      <div className="login-hero-copy flex flex-grow flex-col items-center justify-center text-center md:flex-grow-0 md:w-full md:max-w-[24rem] md:rounded-[var(--radius-panel)] md:border md:border-[hsl(var(--edge-panel))] md:bg-card/80 md:px-5 md:py-5">
        <LoginHero title={title} />
        <LoginIntro />
      </div>
      {/* Reserves the auth-actions block's footprint so the hero doesn't jump up
          by half that height when hydration mounts the real buttons (the alert +
          two sign-in buttons measure ~19rem). aria-hidden: it is pure spacing. */}
      <div className="login-auth-actions-placeholder h-[19rem] w-full max-w-xs shrink-0 md:max-w-[24rem]" aria-hidden="true" />
    </div>
  );
}
