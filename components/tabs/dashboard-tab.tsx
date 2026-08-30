"use client";

import { Activity, useState } from "react";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { TabCard, CardContent } from "@/components/ui/card";
import { Leaf, LandPlot } from "lucide-react";
import { useFarmView } from "@/lib/farm-view-context";
import dynamic from "next/dynamic";
import PlantsView from "./plants-view";

// A shaped fallback: with no `loading` component the tab collapsed to zero
// height while the Lands chunk fetched, scrolling the pane to the top and then
// popping a full card in.
const LandsView = dynamic(() => import("./lands-view"), {
  loading: () => (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading Lands...</span>
      <TabCard>
        <CardContent className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="aspect-square w-full rounded-[var(--radius-panel)]" />
          <Skeleton className="mx-auto h-6 w-40" />
        </CardContent>
      </TabCard>
    </div>
  ),
  ssr: false,
});

export default function DashboardTab() {
  // Shared with the app-shell toggle via FarmViewProvider. Do not re-declare a
  // local useWebQueryState here — in the Mini App the two instances cannot sync.
  const { dashboardView, setDashboardView } = useFarmView();

  return (
    <div className="space-y-4">
      {/* Switch Toggle */}
      <div className="hidden justify-center tablet:flex">
        <ToggleGroup
          ariaLabel="Farm view"
          value={dashboardView}
          onValueChange={(v) => setDashboardView(v as 'plants' | 'lands')}
          options={[
            { value: 'plants', ariaLabel: 'Plants', label: (<span className="flex items-center gap-1"><Leaf className="w-4 h-4" /> Plants</span>) },
            { value: 'lands', ariaLabel: 'Lands', label: (<span className="flex items-center gap-1"><LandPlot className="w-4 h-4" /> Lands</span>) },
          ]}
        />
      </div>

      {/* <Activity>, matching the top-level tabs: plain conditional rendering
          destroyed the hidden view's entire state (selected plant/land, panels,
          inputs) and refetched from scratch on every Plants<->Lands press. */}
      <Activity mode={dashboardView === 'plants' ? 'visible' : 'hidden'}>
        <div className={dashboardView === 'plants' ? 'block' : 'hidden'}>
          <PlantsView />
        </div>
      </Activity>
      <Activity mode={dashboardView === 'lands' ? 'visible' : 'hidden'}>
        <div className={dashboardView === 'lands' ? 'block' : 'hidden'}>
          {/* Mount lazily on first visit, then keep alive. */}
          <LandsVisitGate visible={dashboardView === 'lands'} />
        </div>
      </Activity>
    </div>
  );
}

function LandsVisitGate({ visible }: { visible: boolean }) {
  const [visited, setVisited] = useState(visible);
  if (visible && !visited) {
    setVisited(true);
  }
  return visited ? <LandsView /> : null;
}
