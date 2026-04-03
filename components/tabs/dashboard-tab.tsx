"use client";

import { ToggleGroup } from "@/components/ui/toggle-group";
import { Leaf, LandPlot } from "lucide-react";
import { useFrameContext } from "@/lib/frame-context";
import { useWebQueryState } from "@/hooks/useWebQueryState";
import PlantsView from "./plants-view";
import LandsView from "./lands-view";

export default function DashboardTab() {
  const frame = useFrameContext();
  const isMiniApp = Boolean(frame?.isInMiniApp);
  const [dashboardView, setDashboardView] = useWebQueryState<'plants' | 'lands'>({
    key: 'dashboardView',
    defaultValue: 'plants',
    enabled: !isMiniApp,
    parse: (rawValue) => (rawValue === 'plants' || rawValue === 'lands' ? rawValue : null),
    serialize: (value) => (value === 'plants' ? null : value),
  });

  return (
    <div className="space-y-4">
      {/* Switch Toggle */}
      <div className="flex justify-center">
        <ToggleGroup
          value={dashboardView}
          onValueChange={(v) => setDashboardView(v as 'plants' | 'lands')}
          options={[
            { value: 'plants', label: (<span className="flex items-center gap-1"><Leaf className="w-4 h-4" /> Plants</span>) },
            { value: 'lands', label: (<span className="flex items-center gap-1"><LandPlot className="w-4 h-4" /> Lands</span>) },
          ]}
        />
      </div>

      {/* Conditional Content */}
      {dashboardView === 'plants' && <PlantsView />}
      {dashboardView === 'lands' && <LandsView />}
    </div>
  );
} 
