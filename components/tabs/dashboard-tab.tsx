"use client";

import { ToggleGroup } from "@/components/ui/toggle-group";
import { Leaf, LandPlot } from "lucide-react";
import { useFarmView } from "@/lib/farm-view-context";
import dynamic from "next/dynamic";
import PlantsView from "./plants-view";

const LandsView = dynamic(() => import("./lands-view"), {
  ssr: false,
});

export default function DashboardTab() {
  // Shared with the app-shell toggle via FarmViewProvider. Do not re-declare a
  // local useWebQueryState here — in the Mini App the two instances cannot sync.
  const { dashboardView, setDashboardView } = useFarmView();

  return (
    <div className="space-y-4">
      {/* Switch Toggle */}
      <div className="hidden justify-center min-[54rem]:flex">
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

      {/* Conditional Content */}
      {dashboardView === 'plants' && <PlantsView />}
      {dashboardView === 'lands' && <LandsView />}
    </div>
  );
} 
