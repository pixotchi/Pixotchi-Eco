"use client";

import type { BuildingData, BuildingType, Land } from "@/lib/types";
import { cn, getBuildingName } from "@/lib/utils";
import React, { useMemo, useState } from "react";
import { preload } from "react-dom";
import { Button } from "@/components/ui/button";

interface LandImageProps {
  selectedLand: Land | null;
  buildingType?: BuildingType;
  villageBuildings?: BuildingData[];
  townBuildings?: BuildingData[];
  className?: string;
  priority?: boolean;
}

// First layer is drawn on top, matching the original CSS background ordering.
const BUILDING_LAYERS = {
  "Solar Panels": "solar-layer.webp",
  "Soil Factory": "soil-layer.webp",
  "Bee Farm": "bee-layer.webp",
  "Farmer House": "farmerhouse-layer.webp",
  Marketplace: "marketplace-layer.webp",
  Casino: "casino-layer.webp",
  Barracks: "barrackslayer.webp",
} as const;

function LandScene({
  base,
  layers,
  label,
  priority,
}: {
  base: string;
  layers: string[];
  label: string;
  priority: boolean;
}) {
  const [status, setStatus] = useState<Record<string, "loaded" | "error">>({});
  const [attempt, setAttempt] = useState(0);
  const baseLoaded = status[base] === "loaded";
  const baseFailed = status[base] === "error";
  const incomplete = layers.some((url) => status[url] === "error");
  const urls = [base, ...layers.slice().reverse()];
  const retry = () => {
    setStatus((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, value]) => value === "loaded"),
      ),
    );
    setAttempt((current) => current + 1);
  };

  if (priority)
    urls.forEach((url) => preload(url, { as: "image", fetchPriority: "high" }));

  return (
    <>
      <div
        role="img"
        aria-label={
          incomplete ? `${label}, some building artwork unavailable` : label
        }
        aria-busy={!baseLoaded && !baseFailed}
        className="absolute inset-0"
      >
        {urls.map((url) => (
          // These same-size transparent layers must share exact source geometry.
          // Native load/error events let the scene omit a failed optional layer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${url}:${attempt}`}
            src={url}
            alt=""
            draggable={false}
            fetchPriority={priority ? "high" : "auto"}
            onLoad={() =>
              setStatus((current) => ({ ...current, [url]: "loaded" }))
            }
            onError={() =>
              setStatus((current) => ({ ...current, [url]: "error" }))
            }
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            style={{
              visibility:
                baseLoaded && status[url] === "loaded" ? "visible" : "hidden",
            }}
          />
        ))}
      </div>
      {!baseLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[var(--radius-panel)] bg-muted/70 p-4 text-center">
          <p role="status" className="text-sm text-muted-foreground">
            {baseFailed ? "Land artwork unavailable" : "Loading land artwork…"}
          </p>
          {baseFailed && (
            <Button variant="outline" onClick={retry}>
              Retry land artwork
            </Button>
          )}
        </div>
      )}
      {baseLoaded && incomplete && (
        <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-center gap-x-3 rounded-[var(--radius-control)] border border-border bg-card/95 px-3 py-1 text-center">
          <p role="status" className="text-xs text-muted-foreground">
            Some building artwork is unavailable.
          </p>
          <Button variant="link" onClick={retry} className="px-0 text-xs">
            Retry artwork
          </Button>
        </div>
      )}
    </>
  );
}

const LandImage = ({
  selectedLand,
  buildingType = "village",
  villageBuildings = [],
  townBuildings = [],
  className = "",
  priority = false,
}: LandImageProps) => {
  const layers = useMemo(() => {
    // lands-view owns the complete building snapshot, including the Casino's
    // synthesized level; the artwork never performs its own contract reads.
    const buildings =
      buildingType === "village" ? villageBuildings : townBuildings;
    return buildings
      .filter(
        (building) =>
          building.level > 1 || (building.level === 1 && !building.isUpgrading),
      )
      .map(
        (building) =>
          BUILDING_LAYERS[
            getBuildingName(
              building.id,
              buildingType === "town",
            ) as keyof typeof BUILDING_LAYERS
          ],
      )
      .filter(
        (
          file,
        ): file is (typeof BUILDING_LAYERS)[keyof typeof BUILDING_LAYERS] =>
          Boolean(file),
      )
      .map((file) => `/icons/${file}`);
  }, [buildingType, villageBuildings, townBuildings]);
  if (!selectedLand) return null;
  const base =
    buildingType === "village"
      ? "/icons/village-start.png"
      : "/icons/town-small.png";
  return (
    <div className={cn("relative h-full w-full", className)}>
      <LandScene
        key={[selectedLand.tokenId, base, ...layers].join(":")}
        base={base}
        layers={layers}
        label={selectedLand.name || `Land #${selectedLand.tokenId}`}
        priority={priority}
      />
    </div>
  );
};

export default React.memo(LandImage);
