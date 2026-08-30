import {
  getBrowserPendingEvmStorage,
  getPendingEvmCompatibility,
  getPendingEvmPhase,
  getPendingEvmSubmissionLeaseExpiresAt,
  listUnacknowledgedPendingEvmRecords,
  subscribePendingEvmChanges,
  type PendingEvmRecord,
  type PendingEvmRegistryIdentity,
} from "@/lib/pending-evm-transaction";

export type PendingEvmCoordinatorSnapshot = {
  feedbackRecord: PendingEvmRecord | null;
  locked: boolean;
};

export type PendingEvmCoordinatorRegistration = {
  callsDigest: `0x${string}`;
  connectorId?: string;
  controllerId: string;
  intentDigest: `0x${string}`;
  onSnapshot: (snapshot: PendingEvmCoordinatorSnapshot) => void;
  recover: (record: PendingEvmRecord, signal: AbortSignal) => Promise<void>;
};

type ActiveAttempt = {
  abortController: AbortController | null;
  attemptId: string;
  ownerId: string;
};

type Coordinator = {
  activeAttempt: ActiveAttempt | null;
  destroyed: boolean;
  reconcileQueued: boolean;
  registrations: Map<string, PendingEvmCoordinatorRegistration>;
  registry: PendingEvmRegistryIdentity;
  unsubscribe: () => void;
};

const coordinators = new Map<string, Coordinator>();

function getCoordinatorKey(registry: PendingEvmRegistryIdentity) {
  return `${registry.chainId}:${registry.accountAddress.toLowerCase()}`;
}

function changeBelongsToCoordinator(key: string, coordinator: Coordinator) {
  return key.includes(
    `:${coordinator.registry.chainId}:${coordinator.registry.accountAddress.toLowerCase()}`,
  );
}

function publish(
  coordinator: Coordinator,
  snapshotFor: (registration: PendingEvmCoordinatorRegistration) => PendingEvmCoordinatorSnapshot,
) {
  for (const registration of coordinator.registrations.values()) {
    registration.onSnapshot(snapshotFor(registration));
  }
}

function destroyCoordinatorIfUnused(coordinator: Coordinator) {
  if (coordinator.registrations.size > 0 || coordinator.activeAttempt) return;
  coordinator.destroyed = true;
  coordinator.unsubscribe();
  coordinators.delete(getCoordinatorKey(coordinator.registry));
}

function reconcileCoordinator(coordinator: Coordinator) {
  if (coordinator.destroyed) return;
  const storage = getBrowserPendingEvmStorage();
  const records = listUnacknowledgedPendingEvmRecords(storage, coordinator.registry);
  const record = records[0] ?? null;
  const submissionLeaseActive = (
    getPendingEvmSubmissionLeaseExpiresAt(storage, coordinator.registry) ?? 0
  ) > Date.now();

  if (!record) {
    if (coordinator.activeAttempt) {
      if (coordinator.activeAttempt.abortController) {
        // Another document (or the current terminal CAS) resolved this proof.
        // Abort a losing monitor immediately instead of leaving stale feedback
        // until its 20-second lease retry expires.
        coordinator.activeAttempt.abortController.abort();
        coordinator.activeAttempt = null;
      } else if (submissionLeaseActive) {
        // A proofless wallet prompt is non-cancellable. Even after a stale
        // acknowledgement, keep every controller locked until its bounded
        // submission lease releases.
        publish(coordinator, () => ({ feedbackRecord: null, locked: true }));
        return;
      } else {
        coordinator.activeAttempt = null;
      }
    }
    publish(coordinator, () => ({
      feedbackRecord: null,
      locked: submissionLeaseActive,
    }));
    destroyCoordinatorIfUnused(coordinator);
    return;
  }

  if (coordinator.activeAttempt?.attemptId === record.attemptId) {
    const activeOwnerId = coordinator.activeAttempt.ownerId;
    if (
      record.proof.kind === "reservation"
      && !coordinator.registrations.has(activeOwnerId)
    ) {
      const registrations = [...coordinator.registrations.values()];
      const feedbackOwner = registrations.find(
        (registration) => registration.intentDigest === record.intentDigest,
      ) ?? registrations[0] ?? null;
      publish(coordinator, (registration) => ({
        feedbackRecord: registration.controllerId === feedbackOwner?.controllerId
          ? record
          : null,
        locked: true,
      }));
      return;
    }
    publish(coordinator, (registration) => ({
      feedbackRecord: null,
      locked: registration.controllerId !== activeOwnerId,
    }));
    return;
  }

  // A terminal/removal event may advance the registry to another immutable
  // attempt. Never let the previous attempt owner suppress its reconciliation.
  coordinator.activeAttempt = null;

  const registrations = [...coordinator.registrations.values()];
  const exactRegistration = record.proof.kind !== "reservation"
    && getPendingEvmPhase(record) === "hard"
    ? registrations.find((registration) => (
      registration.intentDigest === record.intentDigest
      && getPendingEvmCompatibility(record, {
        callsDigest: registration.callsDigest,
        connectorId: registration.connectorId,
      }).canResume
    )) ?? null
    : null;

  if (exactRegistration) {
    const abortController = new AbortController();
    coordinator.activeAttempt = {
      abortController,
      attemptId: record.attemptId,
      ownerId: exactRegistration.controllerId,
    };
    publish(coordinator, (registration) => ({
      feedbackRecord: null,
      locked: registration.controllerId !== exactRegistration.controllerId,
    }));
    void Promise.resolve(exactRegistration.recover(record, abortController.signal)).finally(() => {
      if (
        coordinator.activeAttempt?.attemptId === record.attemptId
        && coordinator.activeAttempt.ownerId === exactRegistration.controllerId
        && coordinator.activeAttempt.abortController === abortController
      ) {
        coordinator.activeAttempt = null;
      }
      queueCoordinatorReconcile(coordinator);
    });
    return;
  }

  // There is exactly one generic presenter per wallet+chain. Prefer a related
  // intent (for stale acknowledgement or connector guidance), then the first
  // registered host. Generic presentation never owns or blocks exact recovery.
  const feedbackOwner = registrations.find(
    (registration) => registration.intentDigest === record.intentDigest,
  ) ?? registrations[0] ?? null;
  publish(coordinator, (registration) => ({
    feedbackRecord: registration.controllerId === feedbackOwner?.controllerId ? record : null,
    locked: true,
  }));
}

function queueCoordinatorReconcile(coordinator: Coordinator) {
  if (coordinator.destroyed || coordinator.reconcileQueued) return;
  coordinator.reconcileQueued = true;
  queueMicrotask(() => {
    coordinator.reconcileQueued = false;
    reconcileCoordinator(coordinator);
  });
}

function getOrCreateCoordinator(registry: PendingEvmRegistryIdentity) {
  const key = getCoordinatorKey(registry);
  const existing = coordinators.get(key);
  if (existing) return existing;

  const coordinator: Coordinator = {
    activeAttempt: null,
    destroyed: false,
    reconcileQueued: false,
    registrations: new Map(),
    registry: {
      accountAddress: registry.accountAddress.toLowerCase(),
      chainId: registry.chainId,
    },
    unsubscribe: () => {},
  };
  coordinator.unsubscribe = subscribePendingEvmChanges((change) => {
    if (changeBelongsToCoordinator(change.key, coordinator)) {
      queueCoordinatorReconcile(coordinator);
    }
  });
  coordinators.set(key, coordinator);
  return coordinator;
}

export function registerPendingEvmController(
  registry: PendingEvmRegistryIdentity,
  registration: PendingEvmCoordinatorRegistration,
) {
  const coordinator = getOrCreateCoordinator(registry);
  coordinator.registrations.set(registration.controllerId, registration);
  queueCoordinatorReconcile(coordinator);
  return () => {
    coordinator.registrations.delete(registration.controllerId);
    if (
      coordinator.activeAttempt?.ownerId === registration.controllerId
      && coordinator.activeAttempt.abortController
    ) {
      coordinator.activeAttempt.abortController.abort();
      coordinator.activeAttempt = null;
    }
    queueCoordinatorReconcile(coordinator);
    destroyCoordinatorIfUnused(coordinator);
  };
}

export function claimPendingEvmCoordinatorAttempt(
  registry: PendingEvmRegistryIdentity,
  record: PendingEvmRecord,
  controllerId: string,
) {
  const coordinator = getOrCreateCoordinator(registry);
  const activeAttempt = coordinator.activeAttempt;
  if (
    activeAttempt
    && (
      activeAttempt.attemptId !== record.attemptId
      || activeAttempt.ownerId !== controllerId
    )
  ) {
    return false;
  }
  coordinator.activeAttempt = {
    abortController: null,
    attemptId: record.attemptId,
    ownerId: controllerId,
  };
  queueCoordinatorReconcile(coordinator);
  return true;
}

export function releasePendingEvmCoordinatorAttempt(
  registry: PendingEvmRegistryIdentity,
  record: PendingEvmRecord,
  controllerId: string,
) {
  const coordinator = coordinators.get(getCoordinatorKey(registry));
  if (
    !coordinator
    || coordinator.activeAttempt?.attemptId !== record.attemptId
    || coordinator.activeAttempt.ownerId !== controllerId
  ) {
    return;
  }
  coordinator.activeAttempt = null;
  queueCoordinatorReconcile(coordinator);
  destroyCoordinatorIfUnused(coordinator);
}

export function promotePendingEvmCoordinatorAttemptToMonitor(
  registry: PendingEvmRegistryIdentity,
  record: PendingEvmRecord,
  controllerId: string,
) {
  const coordinator = getOrCreateCoordinator(registry);
  if (
    coordinator.activeAttempt?.attemptId !== record.attemptId
    || coordinator.activeAttempt.ownerId !== controllerId
  ) {
    return null;
  }
  const abortController = new AbortController();
  coordinator.activeAttempt = {
    abortController,
    attemptId: record.attemptId,
    ownerId: controllerId,
  };
  if (!coordinator.registrations.has(controllerId)) {
    abortController.abort();
    coordinator.activeAttempt = null;
    queueCoordinatorReconcile(coordinator);
  }
  return abortController.signal;
}

export function requestPendingEvmCoordinatorReconcile(registry: PendingEvmRegistryIdentity) {
  const coordinator = coordinators.get(getCoordinatorKey(registry));
  if (coordinator) queueCoordinatorReconcile(coordinator);
}
