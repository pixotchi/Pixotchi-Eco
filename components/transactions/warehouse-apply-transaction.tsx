"use client";

import React from "react";
import UniversalTransaction from "./universal-transaction";
import { landAbi } from "@/public/abi/pixotchi-v3-abi";
import { LAND_CONTRACT_ADDRESS } from "@/lib/contracts";

type ApplyMode = "points" | "lifetime";

interface WarehouseApplyTransactionProps {
  landId: bigint;
  plantId: number;
  amount: string; // human-friendly input
  mode: ApplyMode; // points (PTS) or lifetime (TOD)
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
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
  buttonClassName = "h-11 min-h-11 px-3 text-sm w-auto",
  disabled = false,
}: WarehouseApplyTransactionProps) {
  // Contract expects:
  // - Points: 1e12 scaling (addedPoints)
  // - Lifetime: minutes (integer)

  const parsedAmount = (() => {
    const normalizedAmount = amount.trim();
    if (!normalizedAmount) return null;
    try {
      if (mode === "points") {
        if (!/^(?:\d+(?:\.\d{0,12})?|\.\d{1,12})$/.test(normalizedAmount)) return null;
        // Scale by 1e12 as bigint
        const [whole, dec = ""] = normalizedAmount.split(".");
        const padded = dec.padEnd(12, "0");
        const combined = `${whole || "0"}${padded ? padded.padStart(12, "0") : ""}`;
        return BigInt(combined || "0");
      } else {
        // Contract expects SECONDS. User inputs MINUTES → convert to seconds.
        if (!/^\d+$/.test(normalizedAmount)) return null;
        const minutes = BigInt(normalizedAmount);
        if (minutes <= BigInt(0)) return null;
        return minutes * BigInt(60);
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
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName,
      args,
    },
  ];

  return (
    <UniversalTransaction
      intentKey={`warehouse:apply:${mode}:${landId}:${plantId}:${parsedAmount ?? BigInt(0)}`}
      calls={calls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText || (mode === "points" ? "Apply PTS" : "Apply TOD")}
      buttonClassName={buttonClassName}
      disabled={disabled || !parsedAmount || parsedAmount <= BigInt(0)}
    />
  );
}
