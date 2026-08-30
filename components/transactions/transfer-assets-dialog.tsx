"use client";

import { Button } from "@/components/ui/button";
import { Dialog,DialogBody,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu,DropdownMenuCheckboxItem,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import GlobalTransactionToast from "@/components/transactions/global-transaction-toast";
import { Transaction,TransactionButton,TransactionStatus,type LifecycleStatus } from "@/components/transactions/transaction-kit";
import { useDebounce } from "@/hooks/useDebounce";
import { getBaseReadClient } from "@/lib/base-rpc";
import {
BATCH_ROUTER_ADDRESS,
createLandTransferCall,
createNftOperatorApprovalCall,
createPlantTransferCall,
createRouterBatchTransferCall,
getLandsByOwner,
getPlantsByOwner,
LAND_CONTRACT_ADDRESS,
PIXOTCHI_NFT_ADDRESS,
} from "@/lib/contracts";
import { Land,Plant } from "@/lib/types";
import {
invalidateOwnerResources,
onOwnerResourceInvalidation,
ownerInvalidationMatches,
} from "@/lib/owner-resource-invalidation";
import { ChevronDown } from "lucide-react";
import { useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState } from "react";
import { toast } from "react-hot-toast";
import { getAddress,isAddress } from "viem";
import { base } from "viem/chains";
import { useAccount,useWalletClient } from "wagmi";

interface TransferAssetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TRANSFER_PLAN_STORAGE_PREFIX = "pixotchi:transfer-assets:v1";
const TRANSFER_PLAN_MAX_ASSETS = 1_000;

type TransferPlanStep =
  | { kind: "router"; landIds: string[]; plantIds: number[] }
  | { kind: "plant"; plantId: number }
  | { kind: "land"; landId: string };

type TransferPlan = {
  accountAddress: `0x${string}`;
  chainId: number;
  createdAt: number;
  failedLandIds: string[];
  failedPlantIds: number[];
  nextStepIndex: number;
  phase: "ready" | "submission-started";
  planId: string;
  steps: TransferPlanStep[];
  successfulLandIds: string[];
  successfulPlantIds: number[];
  targetAddress: `0x${string}`;
  version: 1;
};

const planStorageKey = (accountAddress: string, chainId: number) =>
  `${TRANSFER_PLAN_STORAGE_PREFIX}:${chainId}:${accountAddress.toLowerCase()}`;

const isCanonicalLandId = (value: UntypedValue): value is string =>
  typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);

const isPlantId = (value: UntypedValue): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const hasUniqueValues = <T extends string | number>(values: readonly T[]) =>
  new Set(values).size === values.length;

const parseTransferPlan = (
  value: UntypedValue,
  accountAddress: string,
  chainId: number,
): TransferPlan | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TransferPlan>;
  if (
    candidate.version !== 1
    || typeof candidate.planId !== "string"
    || candidate.planId.length < 8
    || candidate.planId.length > 128
    || candidate.accountAddress?.toLowerCase() !== accountAddress.toLowerCase()
    || candidate.chainId !== chainId
    || typeof candidate.createdAt !== "number"
    || !Number.isFinite(candidate.createdAt)
    || candidate.createdAt > Date.now() + 60_000
    || (candidate.phase !== "ready" && candidate.phase !== "submission-started")
    || !Array.isArray(candidate.steps)
    || candidate.steps.length === 0
    || candidate.steps.length > TRANSFER_PLAN_MAX_ASSETS
    || !Number.isInteger(candidate.nextStepIndex)
    || candidate.nextStepIndex! < 0
    || candidate.nextStepIndex! > candidate.steps.length
    || !candidate.targetAddress
    || !isAddress(candidate.targetAddress)
  ) {
    return null;
  }

  const stepsValid = candidate.steps.every((step) => {
    if (!step || typeof step !== "object") return false;
    if (step.kind === "plant") return isPlantId(step.plantId);
    if (step.kind === "land") return isCanonicalLandId(step.landId);
    return step.kind === "router"
      && Array.isArray(step.plantIds)
      && Array.isArray(step.landIds)
      && step.plantIds.length + step.landIds.length > 0
      && step.plantIds.length + step.landIds.length <= TRANSFER_PLAN_MAX_ASSETS
      && step.plantIds.every(isPlantId)
      && step.landIds.every(isCanonicalLandId)
      && hasUniqueValues(step.plantIds)
      && hasUniqueValues(step.landIds);
  });
  if (!stepsValid) return null;

  const successfulPlantIds = candidate.successfulPlantIds;
  const successfulLandIds = candidate.successfulLandIds;
  const failedPlantIds = candidate.failedPlantIds;
  const failedLandIds = candidate.failedLandIds;
  if (
    !Array.isArray(successfulPlantIds)
    || !successfulPlantIds.every(isPlantId)
    || !hasUniqueValues(successfulPlantIds)
    || !Array.isArray(successfulLandIds)
    || !successfulLandIds.every(isCanonicalLandId)
    || !hasUniqueValues(successfulLandIds)
    || !Array.isArray(failedPlantIds)
    || !failedPlantIds.every(isPlantId)
    || !hasUniqueValues(failedPlantIds)
    || !Array.isArray(failedLandIds)
    || !failedLandIds.every(isCanonicalLandId)
    || !hasUniqueValues(failedLandIds)
  ) {
    return null;
  }

  return {
    ...candidate,
    accountAddress: getAddress(candidate.accountAddress!) as `0x${string}`,
    targetAddress: getAddress(candidate.targetAddress) as `0x${string}`,
  } as TransferPlan;
};

const readTransferPlan = (accountAddress: string, chainId: number): TransferPlan | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(planStorageKey(accountAddress, chainId));
    return raw ? parseTransferPlan(JSON.parse(raw), accountAddress, chainId) : null;
  } catch {
    return null;
  }
};

const writeTransferPlan = (
  nextPlan: TransferPlan,
  expectedPlan: TransferPlan | null,
): boolean => {
  if (typeof window === "undefined") return false;
  const key = planStorageKey(nextPlan.accountAddress, nextPlan.chainId);
  const nextRaw = JSON.stringify(nextPlan);
  const expectedRaw = expectedPlan ? JSON.stringify(expectedPlan) : null;
  try {
    if (window.localStorage.getItem(key) !== expectedRaw) return false;
    window.localStorage.setItem(key, nextRaw);
    return window.localStorage.getItem(key) === nextRaw;
  } catch {
    return false;
  }
};

const removeTransferPlan = (plan: TransferPlan): boolean => {
  if (typeof window === "undefined") return false;
  const key = planStorageKey(plan.accountAddress, plan.chainId);
  try {
    if (window.localStorage.getItem(key) !== JSON.stringify(plan)) return false;
    window.localStorage.removeItem(key);
    return window.localStorage.getItem(key) === null;
  } catch {
    return false;
  }
};

const createTransferPlanId = () =>
  globalThis.crypto?.randomUUID?.()
  ?? `transfer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const getStepAssetIds = (step: TransferPlanStep) => {
  if (step.kind === "plant") return { plantIds: [step.plantId], landIds: [] as string[] };
  if (step.kind === "land") return { plantIds: [] as number[], landIds: [step.landId] };
  return { plantIds: step.plantIds, landIds: step.landIds };
};

const getTransferStepIntentKey = (plan: TransferPlan, step: TransferPlanStep) => {
  const target = plan.targetAddress.toLowerCase();
  if (step.kind === "plant") return `transfer-assets:v1:plant:${target}:${step.plantId}`;
  if (step.kind === "land") return `transfer-assets:v1:land:${target}:${step.landId}`;
  return `transfer-assets:v1:router:${target}:plants=${step.plantIds.join(",")}:lands=${step.landIds.join(",")}`;
};

const formatSelectedLabel = (count: number) => `${count} selected`;

export default function TransferAssetsDialog({ open, onOpenChange }: TransferAssetsDialogProps) {
  const { address } = useAccount();
  const ownerKey = address?.toLowerCase() ?? null;
  const { data: walletClient } = useWalletClient();
  const operationChainId = walletClient?.chain?.id ?? base.id;
  const basePublicClient = useMemo(() => getBaseReadClient(), []);
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<{ plants: number; lands: number }>({ plants: 0, lands: 0 });
  const [fetchingCounts, setFetchingCounts] = useState(false);
  const [assetLoadError, setAssetLoadError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);
  const [ack, setAck] = useState(false);
  const [approvals, setApprovals] = useState<{ plants: boolean; lands: boolean }>({ plants: false, lands: false });
  const [approvalLoadErrors, setApprovalLoadErrors] = useState<{
    lands: string | null;
    plants: string | null;
  }>({ lands: null, plants: null });
  const [approvalStatusLoaded, setApprovalStatusLoaded] = useState({
    lands: false,
    plants: false,
  });
  const routerAvailable = Boolean(BATCH_ROUTER_ADDRESS);
  const [plantsList, setPlantsList] = useState<Plant[]>([]);
  const [landsList, setLandsList] = useState<Land[]>([]);
  const [selectedPlantIds, setSelectedPlantIds] = useState<number[]>([]);
  const [selectedLandIds, setSelectedLandIds] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [activePlan, setActivePlan] = useState<TransferPlan | null>(null);
  const [planOwnershipVerified, setPlanOwnershipVerified] = useState(false);
  const [uncertainPlanStep, setUncertainPlanStep] = useState(false);

  // Request deduplication ref to prevent multiple simultaneous calls
  const loadCountsPendingRef = useRef<string | null>(null);
  const ownerKeyRef = useRef<string | null>(ownerKey);
  const activePlanRef = useRef<TransferPlan | null>(null);
  const planRegistryKeyRef = useRef<string | null>(null);

  // ENS resolution state
  const debouncedDest = useDebounce(destination, 400);
  const [resolvingEns, setResolvingEns] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string>("");
  const [ensError, setEnsError] = useState<string>("");
  const destinationStatusId = useId();
  const ensRequestRef = useRef(0);

  useLayoutEffect(() => {
    const nextRegistryKey = ownerKey ? planStorageKey(ownerKey, operationChainId) : null;
    if (planRegistryKeyRef.current === nextRegistryKey) return;
    planRegistryKeyRef.current = nextRegistryKey;
    ownerKeyRef.current = ownerKey;
    loadCountsPendingRef.current = null;
    setCounts({ plants: 0, lands: 0 });
    setPlantsList([]);
    setLandsList([]);
    setSelectedPlantIds([]);
    setSelectedLandIds([]);
    setApprovals({ plants: false, lands: false });
    setApprovalLoadErrors({ lands: null, plants: null });
    setApprovalStatusLoaded({ lands: false, plants: false });
    setAssetLoadError(null);
    setFetchingCounts(Boolean(open && ownerKey));
    setConfirmStep(false);
    setAck(false);
    setLoading(false);
    setDestination("");
    setResolvedAddress("");
    setEnsError("");
    setPlanOwnershipVerified(false);
    setUncertainPlanStep(false);

    const storedPlan = ownerKey
      ? readTransferPlan(ownerKey, operationChainId)
      : null;
    if (storedPlan && storedPlan.nextStepIndex < storedPlan.steps.length) {
      activePlanRef.current = storedPlan;
      setActivePlan(storedPlan);
      setDestination(storedPlan.targetAddress);
      const remaining = storedPlan.steps
        .slice(storedPlan.nextStepIndex)
        .map(getStepAssetIds);
      setSelectedPlantIds(remaining.flatMap((entry) => entry.plantIds));
      setSelectedLandIds(remaining.flatMap((entry) => entry.landIds));
      setConfirmStep(true);
      setUncertainPlanStep(storedPlan.phase === "submission-started");
    } else {
      activePlanRef.current = null;
      setActivePlan(null);
      if (storedPlan) removeTransferPlan(storedPlan);
    }
  }, [open, operationChainId, ownerKey]);

  useEffect(() => onOwnerResourceInvalidation((detail) => {
    const matchesOwnerAssets =
      ownerInvalidationMatches(detail, ownerKey, "plants") ||
      ownerInvalidationMatches(detail, ownerKey, "lands");
    if (!matchesOwnerAssets) return;
    if (detail.clear) {
      loadCountsPendingRef.current = null;
      setCounts({ plants: 0, lands: 0 });
      setPlantsList([]);
      setLandsList([]);
      setSelectedPlantIds([]);
      setSelectedLandIds([]);
      setConfirmStep(false);
      setAck(false);
      setFetchingCounts(false);
      setAssetLoadError(null);
      setApprovalLoadErrors({ lands: null, plants: null });
      setApprovalStatusLoaded({ lands: false, plants: false });
      activePlanRef.current = null;
      setActivePlan(null);
      setPlanOwnershipVerified(false);
      setUncertainPlanStep(false);
      return;
    }
    setRefreshNonce((value) => value + 1);
  }), [ownerKey]);

  useEffect(() => {
    if (!open || !address) return;
    const reconcile = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        setRefreshNonce((value) => value + 1);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [address, open]);

  useEffect(() => {
    let active = true;
    const loadCounts = async () => {
      if (!open || !address) {
        if (active) {
          setCounts({ plants: 0, lands: 0 });
          setPlantsList([]);
          setLandsList([]);
          setSelectedPlantIds([]);
          setSelectedLandIds([]);
        }
        loadCountsPendingRef.current = null;
        return;
      }

      // Prevent duplicate calls for the same address
      if (loadCountsPendingRef.current === address) {
        return;
      }

      loadCountsPendingRef.current = address;
      setFetchingCounts(true);
      setAssetLoadError(null);

      try {
        const [plants, lands] = await Promise.all([
          getPlantsByOwner(address),
          getLandsByOwner(address),
        ]);
        if (!active) return;
        // Only update if address hasn't changed during the fetch
        if (loadCountsPendingRef.current === address) {
          setCounts({ plants: plants.length, lands: lands.length });
          setPlantsList(plants);
          setLandsList(lands);
          const availablePlantIds = new Set(plants.map((plant) => plant.id));
          const availableLandIds = new Set(lands.map((land) => land.tokenId.toString()));
          const storedPlan = activePlanRef.current;
          if (storedPlan && storedPlan.nextStepIndex < storedPlan.steps.length) {
            const stepIds = getStepAssetIds(storedPlan.steps[storedPlan.nextStepIndex]!);
            setPlanOwnershipVerified(
              stepIds.plantIds.every((id) => availablePlantIds.has(id))
              && stepIds.landIds.every((id) => availableLandIds.has(id)),
            );
          } else {
            setPlanOwnershipVerified(false);
          }
          setSelectedPlantIds((current) => confirmStep
            ? current.filter((id) => availablePlantIds.has(id))
            : plants.map((plant) => plant.id));
          setSelectedLandIds((current) => confirmStep
            ? current.filter((id) => availableLandIds.has(id))
            : lands.map((land) => land.tokenId.toString()));
          // Check router approvals when available
          if (routerAvailable) {
            const [plantsApproval, landsApproval] = await Promise.allSettled([
                basePublicClient.readContract({
                  address: PIXOTCHI_NFT_ADDRESS,
                  abi: [{ inputs: [{name:'owner',type:'address'},{name:'operator',type:'address'}], name:'isApprovedForAll', outputs:[{name:'',type:'bool'}], stateMutability:'view', type:'function' }],
                  functionName: 'isApprovedForAll',
                  args: [address as `0x${string}`, BATCH_ROUTER_ADDRESS],
                }) as Promise<boolean>,
                basePublicClient.readContract({
                  address: LAND_CONTRACT_ADDRESS,
                  abi: [{ inputs: [{name:'owner',type:'address'},{name:'operator',type:'address'}], name:'isApprovedForAll', outputs:[{name:'',type:'bool'}], stateMutability:'view', type:'function' }],
                  functionName: 'isApprovedForAll',
                  args: [address as `0x${string}`, BATCH_ROUTER_ADDRESS],
                }) as Promise<boolean>,
              ]);
            if (active && loadCountsPendingRef.current === address) {
              setApprovals({
                lands: landsApproval.status === "fulfilled" ? landsApproval.value : false,
                plants: plantsApproval.status === "fulfilled" ? plantsApproval.value : false,
              });
              setApprovalLoadErrors({
                lands: landsApproval.status === "rejected"
                  ? "Land router approval could not be verified."
                  : null,
                plants: plantsApproval.status === "rejected"
                  ? "Plant router approval could not be verified."
                  : null,
              });
              setApprovalStatusLoaded({
                lands: landsApproval.status === "fulfilled",
                plants: plantsApproval.status === "fulfilled",
              });
            }
          } else {
            setApprovalLoadErrors({ lands: null, plants: null });
            setApprovalStatusLoaded({ lands: false, plants: false });
          }
        }
      } catch (e) {
        if (!active) return;
        console.error("Failed to refresh transferable assets:", e);
        setAssetLoadError("Your transferable assets could not be loaded.");
        setPlanOwnershipVerified(false);
      } finally {
        if (active) {
          // Clear pending flag only if address hasn't changed
          if (loadCountsPendingRef.current === address) {
            setFetchingCounts(false);
            loadCountsPendingRef.current = null;
          }
        }
      }
    };
    loadCounts();
    return () => { 
      active = false;
      // Clear pending flag on cleanup
      if (loadCountsPendingRef.current === address) {
        loadCountsPendingRef.current = null;
      }
    };
  }, [open, address, routerAvailable, basePublicClient, refreshNonce, confirmStep]);

  const isValidAddress = useMemo(() => {
    try {
      return destination && isAddress(destination as `0x${string}`);
    } catch { return false; }
  }, [destination]);

  const targetAddress = useMemo(() => {
    if (isValidAddress) return getAddress(destination as `0x${string}`);
    if (resolvedAddress && isAddress(resolvedAddress as `0x${string}`)) return getAddress(resolvedAddress as `0x${string}`);
    return "";
  }, [isValidAddress, destination, resolvedAddress]);

  const isValidRecipient = useMemo(() => {
    return Boolean(isValidAddress || (resolvedAddress && isAddress(resolvedAddress as `0x${string}`)));
  }, [isValidAddress, resolvedAddress]);
  const destinationIsEnsCandidate = !isValidAddress && destination.includes('.');
  const destinationLookupPending = destinationIsEnsCandidate && !resolvedAddress && !ensError;
  const destinationHasSettledError = Boolean(
    destination
    && !isValidRecipient
    && (destinationIsEnsCandidate ? ensError : true),
  );

  const hasAnythingToTransfer = counts.plants + counts.lands > 0;
  const selectedPlantsCount = selectedPlantIds.length;
  const selectedLandsCount = selectedLandIds.length;
  const hasSelectedAnything = selectedPlantsCount + selectedLandsCount > 0;
  const allPlantsSelected = plantsList.length > 0 && selectedPlantsCount === plantsList.length;
  const allLandsSelected = landsList.length > 0 && selectedLandsCount === landsList.length;

  // If router is configured, require approvals for any collection that has items
  const needsApprovals = useMemo(() => {
    if (!routerAvailable) return false;
    const needPlants = selectedPlantIds.length > 0 && !approvals.plants;
    const needLands = selectedLandIds.length > 0 && !approvals.lands;
    return needPlants || needLands;
  }, [routerAvailable, selectedPlantIds, selectedLandIds, approvals]);

  // Invalidate a previous name immediately. Waiting for the debounce here could
  // briefly pair a newly typed name with the old name's resolved address.
  useEffect(() => {
    ensRequestRef.current += 1;
    setEnsError("");
    setResolvedAddress("");
    setResolvingEns(false);
  }, [destination]);

  // Resolve ENS names (simple public API fallback)
  useEffect(() => {
    if (!debouncedDest || isValidAddress) return;
    // Heuristic: attempt ENS if it contains a dot
    if (!debouncedDest.includes('.')) return;
    if (debouncedDest !== destination) return;
    let cancelled = false;
    const requestId = ++ensRequestRef.current;
    const isCurrentRequest = () => !cancelled && ensRequestRef.current === requestId;
    const run = async () => {
      try {
        if (!isCurrentRequest()) return;
        setResolvingEns(true);
        // Public resolver API (no key). Returns { address, name, display }
        const resp = await fetch(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(debouncedDest)}`);
        if (!isCurrentRequest()) return;
        if (!resp.ok) throw new Error('ENS lookup failed');
        const data = await resp.json();
        if (!isCurrentRequest()) return;
        const addr = data?.address as string | undefined;
        if (addr && isAddress(addr as `0x${string}`)) {
          setResolvedAddress(getAddress(addr as `0x${string}`));
        } else {
          setEnsError('Name not found');
        }
      } catch {
        if (isCurrentRequest()) setEnsError('Unable to resolve ENS');
      } finally {
        if (isCurrentRequest()) setResolvingEns(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [debouncedDest, destination, isValidAddress]);

  const onTransfer = async () => {
    if (!address) return;
    if (!isValidAddress) {
      if (!resolvedAddress) {
        toast.error("Enter a valid address or ENS name");
        return;
      }
    }
    if (!targetAddress) {
      toast.error("Destination unresolved");
      return;
    }
    if (!hasSelectedAnything) {
      toast.error("Select at least one asset to transfer");
      return;
    }
    if (needsApprovals) {
      toast("Approve collections first", { icon: '⚠️' });
      return;
    }

    const operationOwner = address.toLowerCase();
    const operationRegistryKey = planStorageKey(operationOwner, operationChainId);
    const operationTarget = getAddress(targetAddress);
    setLoading(true);
    try {
      const existingPlan = readTransferPlan(operationOwner, operationChainId);
      if (existingPlan && existingPlan.nextStepIndex < existingPlan.steps.length) {
        activePlanRef.current = existingPlan;
        setActivePlan(existingPlan);
        setDestination(existingPlan.targetAddress);
        setConfirmStep(true);
        setAck(false);
        setPlanOwnershipVerified(false);
        setUncertainPlanStep(existingPlan.phase === "submission-started");
        toast("Finish or cancel the existing transfer first", { icon: "⚠️" });
        return;
      }

      const [plants, lands] = await Promise.all([
        getPlantsByOwner(address),
        getLandsByOwner(address),
      ]);
      if (
        ownerKeyRef.current !== operationOwner
        || planRegistryKeyRef.current !== operationRegistryKey
      ) {
        return;
      }

      const selectedPlantSet = new Set(selectedPlantIds);
      const selectedLandSet = new Set(selectedLandIds);
      const plantIds = plants
        .filter((plant) => selectedPlantSet.has(plant.id))
        .map((plant) => plant.id)
        .sort((left, right) => left - right);
      const landIds = lands
        .filter((land) => selectedLandSet.has(land.tokenId.toString()))
        .map((land) => land.tokenId.toString())
        .sort((left, right) => {
          const leftId = BigInt(left);
          const rightId = BigInt(right);
          return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
        });
      if (plantIds.length + landIds.length === 0) {
        toast.error("The selected assets are no longer in this wallet");
        setRefreshNonce((value) => value + 1);
        return;
      }

      const canUseRouter = routerAvailable
        && (plantIds.length === 0 || approvals.plants)
        && (landIds.length === 0 || approvals.lands);
      const steps: TransferPlanStep[] = canUseRouter
        ? [{ kind: "router", plantIds, landIds }]
        : [
            ...plantIds.map((plantId): TransferPlanStep => ({ kind: "plant", plantId })),
            ...landIds.map((landId): TransferPlanStep => ({ kind: "land", landId })),
          ];
      const plan: TransferPlan = {
        accountAddress: getAddress(address),
        chainId: operationChainId,
        createdAt: Date.now(),
        failedLandIds: [],
        failedPlantIds: [],
        nextStepIndex: 0,
        phase: "ready",
        planId: createTransferPlanId(),
        steps,
        successfulLandIds: [],
        successfulPlantIds: [],
        targetAddress: operationTarget,
        version: 1,
      };
      if (!writeTransferPlan(plan, null)) {
        toast.error("Safe transfers require browser storage. Enable site storage, then try again.");
        return;
      }

      activePlanRef.current = plan;
      setActivePlan(plan);
      setPlantsList(plants);
      setLandsList(lands);
      setCounts({ plants: plants.length, lands: lands.length });
      setSelectedPlantIds(plantIds);
      setSelectedLandIds(landIds);
      setPlanOwnershipVerified(true);
      setUncertainPlanStep(false);
      setConfirmStep(true);
      setAck(false);
    } catch (error) {
      console.error("Failed to prepare asset transfer:", error);
      toast.error("Unable to prepare a safe transfer. Try again.");
    } finally {
      if (ownerKeyRef.current === operationOwner) setLoading(false);
    }
  };

  const setPlantSelected = (plantId: number, selected: boolean) => {
    setSelectedPlantIds((prev) => {
      if (selected) {
        if (prev.includes(plantId)) return prev;
        return [...prev, plantId];
      }
      return prev.filter((id) => id !== plantId);
    });
  };

  const setLandSelected = (landId: string, selected: boolean) => {
    setSelectedLandIds((prev) => {
      if (selected) {
        if (prev.includes(landId)) return prev;
        return [...prev, landId];
      }
      return prev.filter((id) => id !== landId);
    });
  };

  const plantApprovalCall = useMemo(() => (
    BATCH_ROUTER_ADDRESS
      ? createNftOperatorApprovalCall(PIXOTCHI_NFT_ADDRESS, BATCH_ROUTER_ADDRESS)
      : null
  ), []);
  const landApprovalCall = useMemo(() => (
    BATCH_ROUTER_ADDRESS
      ? createNftOperatorApprovalCall(LAND_CONTRACT_ADDRESS, BATCH_ROUTER_ADDRESS)
      : null
  ), []);

  const onApprovalStatus = useCallback((
    collection: "plants" | "lands",
    expectedOwner: string | null,
    expectedChainId: number,
    status: LifecycleStatus,
  ) => {
    if (
      !expectedOwner
      || ownerKeyRef.current !== expectedOwner
      || planRegistryKeyRef.current !== planStorageKey(expectedOwner, expectedChainId)
    ) {
      return;
    }
    if (status.statusName === "success") {
      setApprovals((current) => ({ ...current, [collection]: true }));
      setApprovalStatusLoaded((current) => ({ ...current, [collection]: true }));
      setRefreshNonce((value) => value + 1);
      toast.success(collection === "plants" ? "Plants approved" : "Lands approved");
      return;
    }
    if (status.statusName === "transactionRejected") {
      toast("Approval cancelled", { icon: "✖️" });
      return;
    }
    if (["error", "failed", "reverted", "buildError"].includes(status.statusName)) {
      toast.error(collection === "plants" ? "Plant approval failed" : "Land approval failed");
    }
  }, []);

  const activeStep = activePlan?.steps[activePlan.nextStepIndex] ?? null;
  const activeStepIntentKey = useMemo(() => (
    activePlan && activeStep ? getTransferStepIntentKey(activePlan, activeStep) : null
  ), [activePlan, activeStep]);
  const activeStepCall = useMemo(() => {
    if (!activePlan || !activeStep) return null;
    try {
      if (activeStep.kind === "plant") {
        return createPlantTransferCall(
          activePlan.accountAddress,
          activePlan.targetAddress,
          activeStep.plantId,
        );
      }
      if (activeStep.kind === "land") {
        return createLandTransferCall(
          activePlan.accountAddress,
          activePlan.targetAddress,
          BigInt(activeStep.landId),
        );
      }
      return createRouterBatchTransferCall(
        activePlan.targetAddress,
        activeStep.plantIds,
        activeStep.landIds.map((id) => BigInt(id)),
      );
    } catch (error) {
      console.error("Failed to rebuild persisted asset transfer:", error);
      return null;
    }
  }, [activePlan, activeStep]);

  const onTransferStatus = useCallback((
    expectedPlanId: string,
    expectedStepIndex: number,
    status: LifecycleStatus,
  ) => {
    const currentPlan = activePlanRef.current;
    if (
      !currentPlan
      || currentPlan.planId !== expectedPlanId
      || currentPlan.nextStepIndex !== expectedStepIndex
    ) {
      return;
    }

    const retryableTerminal = [
      "buildError",
      "cancelled",
      "canceled",
      "error",
      "failed",
      "rejected",
      "transactionRejected",
      "userRejected",
    ].includes(status.statusName);
    if (retryableTerminal) {
      if (currentPlan.phase === "submission-started") {
        const retryPlan: TransferPlan = { ...currentPlan, phase: "ready" };
        if (writeTransferPlan(retryPlan, currentPlan)) {
          activePlanRef.current = retryPlan;
          setActivePlan(retryPlan);
          setUncertainPlanStep(false);
          setAck(false);
        }
      }
      return;
    }
    if (status.statusName !== "success" && status.statusName !== "reverted") return;

    const completedStep = currentPlan.steps[currentPlan.nextStepIndex];
    if (!completedStep) return;
    const completedIds = getStepAssetIds(completedStep);
    const succeeded = status.statusName === "success";
    const nextPlan: TransferPlan = {
      ...currentPlan,
      failedLandIds: succeeded
        ? currentPlan.failedLandIds
        : [...new Set([...currentPlan.failedLandIds, ...completedIds.landIds])],
      failedPlantIds: succeeded
        ? currentPlan.failedPlantIds
        : [...new Set([...currentPlan.failedPlantIds, ...completedIds.plantIds])],
      nextStepIndex: currentPlan.nextStepIndex + 1,
      phase: "ready",
      successfulLandIds: succeeded
        ? [...new Set([...currentPlan.successfulLandIds, ...completedIds.landIds])]
        : currentPlan.successfulLandIds,
      successfulPlantIds: succeeded
        ? [...new Set([...currentPlan.successfulPlantIds, ...completedIds.plantIds])]
        : currentPlan.successfulPlantIds,
    };
    const progressPersisted = writeTransferPlan(nextPlan, currentPlan);

    if (succeeded) {
      const successfulPlantSet = new Set(completedIds.plantIds);
      const successfulLandSet = new Set(completedIds.landIds);
      setPlantsList((current) => current.filter((plant) => !successfulPlantSet.has(plant.id)));
      setLandsList((current) => current.filter((land) => !successfulLandSet.has(land.tokenId.toString())));
      setCounts((current) => ({
        lands: Math.max(0, current.lands - completedIds.landIds.length),
        plants: Math.max(0, current.plants - completedIds.plantIds.length),
      }));

      const transactionHash = status.statusData.transactionHash;
      const transactionId = status.statusData.transactionId;
      const proof = transactionHash ?? transactionId;
      invalidateOwnerResources({
        address: currentPlan.accountAddress,
        domains: [
          ...(completedIds.plantIds.length ? ["plants" as const] : []),
          ...(completedIds.landIds.length ? ["lands" as const] : []),
          "balances",
        ],
        eventId: proof ? `transfer-assets:${proof.toLowerCase()}` : undefined,
        expected: {
          plantIdsAbsent: completedIds.plantIds,
          landIdsAbsent: completedIds.landIds,
        },
        source: "transfer-assets",
        transactionHash,
        transactionId,
      });
    }

    if (!progressPersisted) {
      setUncertainPlanStep(true);
      toast.error(
        succeeded
          ? "Transfer confirmed, but local progress could not be saved. Do not resend it."
          : "Transfer result recorded onchain, but local progress could not be saved.",
      );
      return;
    }

    activePlanRef.current = nextPlan;
    setActivePlan(nextPlan);
    setUncertainPlanStep(false);
    setAck(false);

    const remaining = nextPlan.steps.slice(nextPlan.nextStepIndex).map(getStepAssetIds);
    setSelectedPlantIds(remaining.flatMap((entry) => entry.plantIds));
    setSelectedLandIds(remaining.flatMap((entry) => entry.landIds));
    setPlanOwnershipVerified(true);

    if (nextPlan.nextStepIndex < nextPlan.steps.length) {
      const remainingCount = nextPlan.steps.length - nextPlan.nextStepIndex;
      if (succeeded) {
        toast.success(`Transfer confirmed. ${remainingCount} transaction${remainingCount === 1 ? "" : "s"} remaining.`);
      } else {
        toast.error(`Transfer reverted. ${remainingCount} transaction${remainingCount === 1 ? "" : "s"} remaining.`);
      }
      return;
    }

    removeTransferPlan(nextPlan);
    activePlanRef.current = null;
    setActivePlan(null);
    setPlanOwnershipVerified(false);
    setSelectedPlantIds(nextPlan.failedPlantIds);
    setSelectedLandIds(nextPlan.failedLandIds);
    setConfirmStep(false);

    const totalSuccess = nextPlan.successfulPlantIds.length + nextPlan.successfulLandIds.length;
    const totalFailed = nextPlan.failedPlantIds.length + nextPlan.failedLandIds.length;
    if (totalFailed === 0) {
      toast.success(totalSuccess === 1 ? "Asset transferred" : "Assets transferred");
      onOpenChange(false);
    } else if (totalSuccess === 0) {
      toast.error("No assets were transferred. Failed assets remain selected.");
    } else {
      toast("Some transfers succeeded. Failed assets remain selected.", { icon: "⚠️" });
    }
  }, [onOpenChange]);

  const cancelPreparedPlan = () => {
    const plan = activePlanRef.current;
    if (!plan || plan.phase !== "ready") return;
    if (!removeTransferPlan(plan)) {
      toast.error("Could not safely cancel the stored transfer plan");
      return;
    }
    activePlanRef.current = null;
    setActivePlan(null);
    setPlanOwnershipVerified(false);
    setUncertainPlanStep(false);
    setConfirmStep(false);
    setAck(false);
  };

  const acknowledgeUnsubmittedPlan = () => {
    const plan = activePlanRef.current;
    if (!plan || plan.phase !== "submission-started") return;
    const retryPlan: TransferPlan = { ...plan, phase: "ready" };
    if (!writeTransferPlan(retryPlan, plan)) {
      toast.error("Could not safely update the stored transfer plan");
      return;
    }
    activePlanRef.current = retryPlan;
    setActivePlan(retryPlan);
    setUncertainPlanStep(false);
    setAck(false);
  };

  const dialog = (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        if (!activePlanRef.current) setConfirmStep(false);
        setAck(false);
      }
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{confirmStep ? 'Confirm Transfer' : 'Transfer Assets'}</DialogTitle>
          <DialogDescription>
            {confirmStep ? 'You are about to transfer your assets to:' : 'Send your Pixotchi plants and land NFTs to another wallet.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pr-1">
        {!confirmStep ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="dest">Destination Address</label>
            <Input
              id="dest"
              placeholder="0x... or ENS name"
              value={destination}
              onChange={(e) => setDestination(e.target.value.trim())}
              autoComplete="off"
              aria-describedby={destination ? destinationStatusId : undefined}
              aria-invalid={destinationHasSettledError}
            />
            {destination && (
              <div id={destinationStatusId} aria-live="polite" className="text-xs">
                {destinationLookupPending || resolvingEns ? (
                  <span className="text-muted-foreground">Resolving ENS…</span>
                ) : resolvedAddress ? (
                  <span className="text-muted-foreground">
                    Resolved to <span className="font-mono break-all text-foreground">{resolvedAddress}</span>
                  </span>
                ) : destinationHasSettledError ? (
                  <span className="text-destructive">{ensError || 'Invalid address or ENS name'}</span>
                ) : isValidAddress ? (
                  <span className="text-muted-foreground">Valid wallet address</span>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Plants</span>
              {fetchingCounts ? <Skeleton className="h-4 w-10"/> : <span className="font-medium">{counts.plants}</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Lands</span>
              {fetchingCounts ? <Skeleton className="h-4 w-10"/> : <span className="font-medium">{counts.lands}</span>}
            </div>
          </div>

          {assetLoadError && (
            <div className="space-y-2 rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2" role="alert">
              <p className="text-xs text-destructive">{assetLoadError}</p>
              <Button
                className="min-h-11 w-full"
                onClick={() => {
                  loadCountsPendingRef.current = null;
                  setRefreshNonce((value) => value + 1);
                }}
                variant="outline"
              >
                Retry asset loading
              </Button>
            </div>
          )}

          {routerAvailable && (approvalLoadErrors.plants || approvalLoadErrors.lands) && (
            <div className="space-y-2 rounded-[var(--radius-control)] border border-amber-500/40 bg-amber-500/10 px-3 py-2" role="alert">
              <div className="space-y-1 text-xs text-amber-950 dark:text-amber-100">
                {approvalLoadErrors.plants && <p>{approvalLoadErrors.plants}</p>}
                {approvalLoadErrors.lands && <p>{approvalLoadErrors.lands}</p>}
              </div>
              <Button
                className="min-h-11 w-full"
                onClick={() => {
                  loadCountsPendingRef.current = null;
                  setRefreshNonce((value) => value + 1);
                }}
                variant="outline"
              >
                Retry approval check
              </Button>
            </div>
          )}

          {(plantsList.length > 0 || landsList.length > 0) && (
            <div className="space-y-3 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
              <p className="text-xs text-muted-foreground">Choose which assets to send.</p>
              {plantsList.length > 0 && (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Plants selected</span>
                    <span className="text-xs text-muted-foreground">{selectedPlantsCount}/{plantsList.length}</span>
                  </div>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-14 w-full justify-between px-4 text-base font-semibold"
                      >
                        <span>{formatSelectedLabel(selectedPlantsCount)}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="z-[var(--z-modal-nested)] w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-1 p-1">
                        <DropdownMenuItem
                          className="justify-center"
                          disabled={allPlantsSelected}
                          onSelect={(event) => {
                            event.preventDefault();
                            setSelectedPlantIds(plantsList.map((plant) => plant.id));
                          }}
                        >
                          Select all
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="justify-center"
                          disabled={selectedPlantsCount === 0}
                          onSelect={(event) => {
                            event.preventDefault();
                            setSelectedPlantIds([]);
                          }}
                        >
                          Clear
                        </DropdownMenuItem>
                      </div>
                      <DropdownMenuSeparator />
                      {plantsList.map((plant) => {
                        const checked = selectedPlantIds.includes(plant.id);
                        return (
                          <DropdownMenuCheckboxItem
                            key={plant.id}
                            checked={checked}
                            onCheckedChange={(nextChecked) => setPlantSelected(plant.id, nextChecked === true)}
                            onSelect={(event) => event.preventDefault()}
                          >
                            <span className="min-w-0 flex-1 truncate font-pixel">{plant.name || `Plant #${plant.id}`}</span>
                            {plant.name && <span className="ml-2 shrink-0 text-xs text-muted-foreground">#{plant.id}</span>}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {landsList.length > 0 && (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Lands selected</span>
                    <span className="text-xs text-muted-foreground">{selectedLandsCount}/{landsList.length}</span>
                  </div>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-14 w-full justify-between px-4 text-base font-semibold"
                      >
                        <span>{formatSelectedLabel(selectedLandsCount)}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="z-[var(--z-modal-nested)] w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-1 p-1">
                        <DropdownMenuItem
                          className="justify-center"
                          disabled={allLandsSelected}
                          onSelect={(event) => {
                            event.preventDefault();
                            setSelectedLandIds(landsList.map((land) => land.tokenId.toString()));
                          }}
                        >
                          Select all
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="justify-center"
                          disabled={selectedLandsCount === 0}
                          onSelect={(event) => {
                            event.preventDefault();
                            setSelectedLandIds([]);
                          }}
                        >
                          Clear
                        </DropdownMenuItem>
                      </div>
                      <DropdownMenuSeparator />
                      {landsList.map((land) => {
                        const id = land.tokenId.toString();
                        const checked = selectedLandIds.includes(id);
                        return (
                          <DropdownMenuCheckboxItem
                            key={id}
                            checked={checked}
                            onCheckedChange={(nextChecked) => setLandSelected(id, nextChecked === true)}
                            onSelect={(event) => event.preventDefault()}
                          >
                            <span className="min-w-0 flex-1 truncate font-pixel">{land.name || `Land #${id}`}</span>
                            {land.name && <span className="ml-2 shrink-0 text-xs text-muted-foreground">#{id}</span>}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          )}

          {routerAvailable && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Using batch router to transfer multiple NFTs in one tx.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0 space-y-1">
                  {approvals.plants ? (
                    <Button className="w-full" variant="outline" disabled>
                      Plants Approved
                    </Button>
                  ) : approvalLoadErrors.plants ? (
                    <Button className="h-auto min-h-11 w-full whitespace-normal text-xs" variant="outline" disabled>
                      Approval status unavailable — retry check
                    </Button>
                  ) : !approvalStatusLoaded.plants || !plantApprovalCall ? (
                    <Button className="w-full" variant="outline" disabled>
                      Checking approval…
                    </Button>
                  ) : (
                    <Transaction
                      calls={[plantApprovalCall]}
                      intentKey={`transfer-assets:v1:approval:${PIXOTCHI_NFT_ADDRESS.toLowerCase()}:${BATCH_ROUTER_ADDRESS.toLowerCase()}`}
                      onStatus={(status) => onApprovalStatus("plants", ownerKey, operationChainId, status)}
                    >
                      <TransactionButton disabled={loading} text="Approve Plants" />
                      <TransactionStatus className="mt-1 text-xs" />
                      <GlobalTransactionToast />
                    </Transaction>
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  {approvals.lands ? (
                    <Button className="w-full" variant="outline" disabled>
                      Lands Approved
                    </Button>
                  ) : approvalLoadErrors.lands ? (
                    <Button className="h-auto min-h-11 w-full whitespace-normal text-xs" variant="outline" disabled>
                      Approval status unavailable — retry check
                    </Button>
                  ) : !approvalStatusLoaded.lands || !landApprovalCall ? (
                    <Button className="w-full" variant="outline" disabled>
                      Checking approval…
                    </Button>
                  ) : (
                    <Transaction
                      calls={[landApprovalCall]}
                      intentKey={`transfer-assets:v1:approval:${LAND_CONTRACT_ADDRESS.toLowerCase()}:${BATCH_ROUTER_ADDRESS.toLowerCase()}`}
                      onStatus={(status) => onApprovalStatus("lands", ownerKey, operationChainId, status)}
                    >
                      <TransactionButton disabled={loading} text="Approve Lands" />
                      <TransactionStatus className="mt-1 text-xs" />
                      <GlobalTransactionToast />
                    </Transaction>
                  )}
                </div>
              </div>
            </div>
          )}

          <Button
            className="w-full"
            onClick={onTransfer}
            disabled={loading || Boolean(assetLoadError) || !isValidRecipient || !hasSelectedAnything || needsApprovals}
          >
            Continue
          </Button>

          {!fetchingCounts && !assetLoadError && !hasAnythingToTransfer && (
            <p className="text-xs text-muted-foreground text-center">No assets found to transfer.</p>
          )}
        </div>
        ) : (
        <div className="space-y-4">
          <div className="text-sm break-all bg-muted p-2 rounded-md">
            {resolvedAddress ? (
              <>
                <div className="font-mono">{resolvedAddress}</div>
                <div className="text-xs text-muted-foreground">({destination})</div>
              </>
            ) : (
              <div className="font-mono">{destination}</div>
            )}
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Plants</span>
              <span className="font-medium">{selectedPlantsCount} / {counts.plants}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Lands</span>
              <span className="font-medium">{selectedLandsCount} / {counts.lands}</span>
            </div>
          </div>
          {activePlan && activePlan.steps.length > 1 && (
            <div className="rounded-[var(--radius-control)] border border-border/60 bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Fallback mode sends one NFT per confirmed transaction. Step {activePlan.nextStepIndex + 1} of {activePlan.steps.length}.
            </div>
          )}
          {uncertainPlanStep && (
            <div className="rounded-[var(--radius-control)] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100" role="alert">
              This transfer may already have reached your wallet. It will not be resent automatically. Check wallet activity before allowing a retry.
            </div>
          )}
          {activePlan && !activeStepCall && (
            <div className="rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
              This stored transfer cannot be reconstructed safely. It has been blocked to prevent an accidental resend.
            </div>
          )}
          {activePlan?.phase === "ready" && !planOwnershipVerified && (
            <p className="text-xs text-muted-foreground" role="status">
              Verifying that the selected assets are still in this wallet…
            </p>
          )}
          <label className="flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] border border-border/60 bg-card/70 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <input
              type="checkbox"
              className="h-5 w-5 rounded accent-primary"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              disabled={loading || uncertainPlanStep || !activeStepCall}
            />
            <span>I understand this action is irreversible.</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={cancelPreparedPlan}
              disabled={loading || !activePlan || activePlan.phase !== "ready"}
            >
              Back
            </Button>
            {activePlan && activeStepCall && activeStepIntentKey ? (
              <TransactionButton
                disabled={
                  !ack
                  || !planOwnershipVerified
                  || uncertainPlanStep
                  || activePlan.phase !== "ready"
                }
                text={activePlan.steps.length > 1
                  ? `Send ${activePlan.nextStepIndex + 1} of ${activePlan.steps.length}`
                  : "Confirm & Send"}
                render={({ context, isDisabled, onSubmit, status }) => {
                  const statusName = context.status.statusName;
                  const isCheckOnly = statusName === "transactionUnresolved" || statusName === "transactionStale";
                  if (uncertainPlanStep && statusName === "idle") {
                    return (
                      <Button
                        className="h-auto min-h-11 whitespace-normal text-xs"
                        onClick={acknowledgeUnsubmittedPlan}
                        disabled={context.isExecuting || context.isSubmissionLocked}
                        variant="secondary"
                      >
                        I verified it was not submitted
                      </Button>
                    );
                  }

                  const buttonLabel = status === "success"
                    ? "View transaction"
                    : isCheckOnly
                      ? "Check transaction"
                      : statusName === "submissionAmbiguous"
                        ? "Check wallet activity"
                        : status === "error"
                          ? "Try again"
                          : context.isExecuting
                            ? "Transferring..."
                            : activePlan.steps.length > 1
                              ? `Send ${activePlan.nextStepIndex + 1} of ${activePlan.steps.length}`
                              : "Confirm & Send";

                  return (
                    <Button
                      onClick={() => {
                        if (status === "success" || isCheckOnly) {
                          onSubmit();
                          return;
                        }
                        const plan = activePlanRef.current;
                        if (
                          !plan
                          || plan.planId !== activePlan.planId
                          || plan.nextStepIndex !== activePlan.nextStepIndex
                          || plan.phase !== "ready"
                        ) {
                          return;
                        }
                        const startedPlan: TransferPlan = {
                          ...plan,
                          phase: "submission-started",
                        };
                        if (!writeTransferPlan(startedPlan, plan)) {
                          toast.error("Safe transfer tracking could not be committed. Nothing was sent.");
                          return;
                        }
                        activePlanRef.current = startedPlan;
                        setActivePlan(startedPlan);
                        setUncertainPlanStep(false);
                        onSubmit();
                      }}
                      disabled={isDisabled}
                      loading={context.isExecuting}
                      loadingText="Transferring..."
                    >
                      {buttonLabel}
                    </Button>
                  );
                }}
              />
            ) : (
              <Button disabled>Transfer blocked</Button>
            )}
          </div>
          {activePlan && activeStepCall && activeStepIntentKey && (
            <TransactionStatus className="text-xs" />
          )}
        </div>
        )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );

  const closedApprovalRecoveryControllers = !open && !activePlan && ownerKey ? (
    <>
      {!approvals.plants && plantApprovalCall && BATCH_ROUTER_ADDRESS && (
        <Transaction
          calls={[plantApprovalCall]}
          intentKey={`transfer-assets:v1:approval:${PIXOTCHI_NFT_ADDRESS.toLowerCase()}:${BATCH_ROUTER_ADDRESS.toLowerCase()}`}
          onStatus={(status) => onApprovalStatus("plants", ownerKey, operationChainId, status)}
          resetAfter={0}
        >
          <GlobalTransactionToast />
        </Transaction>
      )}
      {!approvals.lands && landApprovalCall && BATCH_ROUTER_ADDRESS && (
        <Transaction
          calls={[landApprovalCall]}
          intentKey={`transfer-assets:v1:approval:${LAND_CONTRACT_ADDRESS.toLowerCase()}:${BATCH_ROUTER_ADDRESS.toLowerCase()}`}
          onStatus={(status) => onApprovalStatus("lands", ownerKey, operationChainId, status)}
          resetAfter={0}
        >
          <GlobalTransactionToast />
        </Transaction>
      )}
    </>
  ) : null;

  if (!activePlan || !activeStep || !activeStepCall || !activeStepIntentKey) {
    return (
      <>
        {dialog}
        {closedApprovalRecoveryControllers}
      </>
    );
  }

  return (
    <Transaction
      key={`${activePlan.planId}:${activePlan.nextStepIndex}`}
      calls={[activeStepCall]}
      intentKey={activeStepIntentKey}
      onStatus={(status) => onTransferStatus(
        activePlan.planId,
        activePlan.nextStepIndex,
        status,
      )}
      resetAfter={0}
    >
      {dialog}
      <GlobalTransactionToast />
    </Transaction>
  );
}
