export type TransferPlanStep =
  | { kind: "router"; landIds: string[]; plantIds: number[] }
  | { kind: "plant"; plantId: number }
  | { kind: "land"; landId: string };

export const getStepAssetIds = (step: TransferPlanStep) => {
  if (step.kind === "plant") return { plantIds: [step.plantId], landIds: [] as string[] };
  if (step.kind === "land") return { plantIds: [] as number[], landIds: [step.landId] };
  return { plantIds: step.plantIds, landIds: step.landIds };
};

export type TransferReviewPlan = {
  targetAddress: `0x${string}`;
  chainId: number;
  steps: TransferPlanStep[];
  nextStepIndex: number;
  successfulLandIds: string[];
  successfulPlantIds: number[];
  failedLandIds: string[];
  failedPlantIds: number[];
};

/** Review and execution derive from the same committed plan, never form drafts. */
export function getTransferReview(plan: TransferReviewPlan) {
  const currentStep = plan.steps[plan.nextStepIndex];
  const remaining = plan.steps.slice(plan.nextStepIndex).map(getStepAssetIds);
  return {
    current: currentStep ? getStepAssetIds(currentStep) : { plantIds: [], landIds: [] },
    remaining: {
      plantIds: remaining.flatMap((step) => step.plantIds),
      landIds: remaining.flatMap((step) => step.landIds),
    },
    completed: { plantIds: plan.successfulPlantIds, landIds: plan.successfulLandIds },
    failed: { plantIds: plan.failedPlantIds, landIds: plan.failedLandIds },
  };
}
