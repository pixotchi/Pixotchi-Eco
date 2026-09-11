"use client";

import { Button } from "@/components/ui/button";
import { CardContent, CardTitle, TabCard } from "@/components/ui/card";
import { navigateToGameTab } from "@/lib/game-navigation";

export default function AboutTab() {
  return (
    <div className="mx-auto w-full max-w-[36rem] tablet:flex tablet:min-h-[60dvh] tablet:items-center">
      <TabCard className="w-full">
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle level="page">About Pixotchi</CardTitle>
            <Button variant="ghost" onClick={() => navigateToGameTab("dashboard")}>Back to Farm</Button>
          </div>
          <div className="space-y-4">
            <p className="leading-relaxed text-foreground/85">
              <span className="font-semibold tracking-tight text-foreground">PIXOTCHI</span> is a tamagotchi-style onchain game on Base. Care for plants, develop lands, and compete on the global leaderboard. Plant points contribute to your share when ETH rewards are distributed; reward amounts vary.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Build Village production buildings to accumulate points and lifetime, then collect and apply those resources to your plants through Warehouse. You can also buy Plant care items or unlock Town features such as quests and the LEAF marketplace.
            </p>
          </div>
        </CardContent>
      </TabCard>
    </div>
  );
}
