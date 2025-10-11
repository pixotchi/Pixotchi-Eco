import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Compass, Leaf, Sparkles } from "lucide-react";

const guideCards = [
  {
    title: "Tend your plants",
    description:
      "Jump back in to water, feed, and shield your plants before they start missing you.",
    icon: Leaf,
  },
  {
    title: "Track the leaderboard",
    description:
      "See how your garden stacks up and plan your next move to climb the ranks.",
    icon: Sparkles,
  },
  {
    title: "Explore the Base frontier",
    description:
      "New lands, quests, and rewards are waiting just a click away.",
    icon: Compass,
  },
];

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-gradient-to-b from-background via-background to-muted/60 px-6 py-12">
      <div className="absolute inset-0 -z-10 overflow-hidden opacity-60">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(163,230,53,0.18),transparent_45%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(56,189,248,0.18),transparent_50%)]" />
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-10 text-center">
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
              Your Pixotchi wandered off the map
            </h1>
            <p className="mx-auto max-w-2xl text-sm text-muted-foreground sm:text-base">
              The path you tried to follow doesn&apos;t exist. Let&apos;s head back to the farm so you can keep
              growing, harvesting, and defending your plants with the rest of the Pixotchi crew.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="px-8">
              <Link href="/">Return to the farm</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="px-8">
              <Link href="/" scroll={false}>
                Check dashboard status
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid w-full gap-4 md:grid-cols-3">
          {guideCards.map(({ title, description, icon: Icon }) => (
            <Card key={title} className="border-primary/10 bg-card/80 backdrop-blur">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-left text-base font-semibold">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-left text-sm leading-relaxed">
                  {description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

