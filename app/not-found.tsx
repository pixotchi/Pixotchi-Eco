import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-gradient-to-b from-background via-background to-muted/60 px-6 py-12">
      <div className="absolute inset-0 -z-10 overflow-hidden opacity-60">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(163,230,53,0.18),transparent_45%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(56,189,248,0.18),transparent_50%)]" />
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-6">
          <Image
            src="/PixotchiKit/Logonotext.svg"
            alt="Pixotchi Mini logo"
            width={96}
            height={96}
            priority
            className="opacity-80 drop-shadow-lg"
          />
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.35em] text-primary/70">Lost in the garden</p>
            <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">
              You're wandering off the map!
            </h1>
            <p className="mx-auto max-w-2xl text-sm text-muted-foreground sm:text-base">
              The path you tried to follow doesn&apos;t exist. Let&apos;s head back to the farm so you can keep
              growing, harvesting, and defending your plants with the rest of the Pixotchi farmers.
            </p>
          </div>
          <Button asChild size="lg" className="px-8">
            <Link href="/">Return to the farm</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

