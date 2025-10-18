"use client";

import React from "react";
import UniversalTransaction from "./universal-transaction";
import { landAbi } from "@/public/abi/pixotchi-v3-abi";
import { LAND_CONTRACT_ADDRESS } from "@/lib/constants";

type ApplyMode = "points" | "lifetime";

interface WarehouseApplyTransactionProps {
  landId: bigint;
  plantId: number;
  amount: string; // human-friendly input
  mode: ApplyMode; // points (PTS) or lifetime (TOD)
  onSuccess?: () => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function WarehouseApplyTransaction({
  landId,
  plantId,
  amount,
  mode,
  onSuccess,
  onError,
  buttonText,
  buttonClassName = "h-9 px-3 text-sm w-auto",
  disabled = false,
}: WarehouseApplyTransactionProps) {
  // Contract expects:
  // - Points: 1e12 scaling (addedPoints)
  // - Lifetime: minutes (integer)

  const parsedAmount = (() => {
    if (!amount || !/^\d*(?:\.\d+)?$/.test(amount)) return null;
    try {
      if (mode === "points") {
        // Scale by 1e12 as bigint
        const [whole, dec = ""] = amount.split(".");
        const padded = (dec + "0".repeat(12)).slice(0, 12);
        const combined = `${whole || "0"}${padded ? padded.padStart(12, "0") : ""}`;
        return BigInt(combined || "0");
      } else {
        // Contract expects SECONDS. User inputs MINUTES → convert to seconds.
        const minutes = Math.floor(Number(amount));
        if (!Number.isFinite(minutes) || minutes <= 0) return null;
        return BigInt(minutes) * BigInt(60);
      }
    } catch {
      return null;
    }
  })();

  const functionName = mode === "points" ? "wareHouseAssignPlantPoints" : "wareHouseAssignLifeTime";
  const args = mode === "points"
    ? [landId, BigInt(plantId), parsedAmount ?? BigInt(0)]
    : [landId, BigInt(plantId), parsedAmount ?? BigInt(0)];

  const calls = [
    {
      address: LAND_CONTRACT_ADDRESS as `0x${string}`,
      abi: landAbi,
      functionName,
      args,
    },
  ];

  return (
    <UniversalTransaction
      calls={calls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText || (mode === "points" ? "Apply PTS" : "Apply TOD")}
      buttonClassName={buttonClassName}
      disabled={disabled || !parsedAmount || parsedAmount <= BigInt(0)}
    />
  );
}


