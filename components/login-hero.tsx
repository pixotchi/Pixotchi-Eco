import Image from "next/image";

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
    <div className="flex flex-col items-center space-y-3 mb-8">
      <Image
        src="/PixotchiKit/Logonotext.svg"
        alt="Pixotchi Mini Logo"
        width={80}
        height={80}
        preload
        sizes="80px"
        quality={90}
      />
      <h1 className="text-2xl font-pixel text-foreground">{title}</h1>
    </div>
  );
}

export function LoginIntro() {
  return (
    <>
      <h2 className="text-xl font-semibold text-foreground mb-2">Welcome!</h2>
      <p className="text-muted-foreground mb-6 max-w-xs md:max-w-md">
        Connect your wallet, mint a plant and begin your farming journey on Base.
      </p>
    </>
  );
}

/** The full centred hero, used as the pre-hydration fallback. */
export function LoginHeroPanel({ title }: { title?: string }) {
  return (
    <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center overflow-y-auto overscroll-contain p-4 safe-area-bottom md:p-4 xl:p-5">
      <div className="flex flex-grow flex-col items-center justify-center text-center md:flex-grow-0 md:w-full md:max-w-[24rem] md:rounded-[var(--radius-panel)] md:border md:border-[hsl(var(--edge-panel))] md:bg-card/80 md:px-5 md:py-5">
        <LoginHero title={title} />
        <LoginIntro />
      </div>
      {/* Reserves the auth-actions block's footprint so the hero doesn't jump up
          by half that height when hydration mounts the real buttons (the alert +
          two sign-in buttons measure ~19rem). aria-hidden: it is pure spacing. */}
      <div className="h-[19rem] w-full max-w-xs shrink-0 md:max-w-[24rem]" aria-hidden="true" />
    </div>
  );
}
