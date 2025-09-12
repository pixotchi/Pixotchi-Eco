"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Leaf, LandPlot } from "lucide-react";
import PlantsView from "./plants-view";
import LandsView from "./lands-view";

export default function DashboardTab() {
  const [dashboardView, setDashboardView] = useState<'plants' | 'lands'>('plants');

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