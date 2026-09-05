export type StatusLevel = 'operational' | 'degraded' | 'outage' | 'unknown';

export interface StatusService {
  id: string;
  label: string;
  status: StatusLevel;
  latencyMs?: number;
  details?: string;
  metrics?: Record<string, UntypedValue>;
}

export interface StatusSnapshot {
  generatedAt: string;
  overall: StatusLevel;
  services: StatusService[];
}

const STATUS_LEVELS = new Set<StatusLevel>([
  'operational',
  'degraded',
  'outage',
  'unknown',
]);

function isRecord(value: unknown): value is Record<string, UntypedValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatusLevel(value: unknown): value is StatusLevel {
  return typeof value === 'string' && STATUS_LEVELS.has(value as StatusLevel);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function parseStatusService(value: unknown): StatusService | null {
  if (!isRecord(value)) return null;
  if (!isBoundedString(value.id, 128)) return null;
  if (!isBoundedString(value.label, 256)) return null;
  if (!isStatusLevel(value.status)) return null;
  if (
    value.latencyMs !== undefined
    && (
      typeof value.latencyMs !== 'number'
      || !Number.isFinite(value.latencyMs)
      || value.latencyMs < 0
    )
  ) return null;
  if (value.details !== undefined && !isBoundedString(value.details, 2_000)) return null;
  if (value.metrics !== undefined && !isRecord(value.metrics)) return null;

  return {
    id: value.id,
    label: value.label,
    status: value.status,
    ...(value.latencyMs !== undefined ? { latencyMs: value.latencyMs } : {}),
    ...(value.details !== undefined ? { details: value.details } : {}),
    ...(value.metrics !== undefined ? { metrics: { ...value.metrics } } : {}),
  };
}

/**
 * Treat Redis snapshots as untrusted serialized data. Older deployments share
 * the same store, so TypeScript's StatusSnapshot annotation is not a runtime
 * guarantee after a schema or redaction change.
 */
export function parseStatusSnapshot(value: unknown): StatusSnapshot | null {
  if (!isRecord(value)) return null;
  if (!isBoundedString(value.generatedAt, 64) || !Number.isFinite(Date.parse(value.generatedAt))) {
    return null;
  }
  if (!isStatusLevel(value.overall)) return null;
  if (!Array.isArray(value.services) || value.services.length === 0 || value.services.length > 64) {
    return null;
  }

  const services: StatusService[] = [];
  for (const service of value.services) {
    const parsed = parseStatusService(service);
    if (!parsed) return null;
    services.push(parsed);
  }

  return {
    generatedAt: value.generatedAt,
    overall: value.overall,
    services,
  };
}

function publicRpcMetrics(metrics: Record<string, UntypedValue> | undefined) {
  if (!metrics) return undefined;
  const healthyCount = metrics.healthyCount;
  const totalCount = metrics.totalCount;
  if (
    typeof healthyCount !== 'number'
    || !Number.isSafeInteger(healthyCount)
    || healthyCount < 0
    || typeof totalCount !== 'number'
    || !Number.isSafeInteger(totalCount)
    || totalCount < 0
    || healthyCount > totalCount
  ) return undefined;

  return { healthyCount, totalCount };
}

const PUBLIC_SERVICE_LABELS = {
  app: 'Ecosystem App',
  'stake-app': 'Staking App',
  rpc: 'RPC Cluster',
  indexer: 'Indexer (Ponder)',
  redis: 'Database',
  notifications: 'Notifications',
  miniapp: 'Farcaster Mini App',
  'base-mainnet': 'Base Mainnet',
} as const;

type PublicServiceId = keyof typeof PUBLIC_SERVICE_LABELS;

function isPublicServiceId(id: string): id is PublicServiceId {
  return Object.hasOwn(PUBLIC_SERVICE_LABELS, id);
}

/**
 * Explicit public DTO for the status API and server-rendered status page.
 * Endpoint identities, provider diagnostics and future internal metrics stay
 * server-side by default.
 */
export function toPublicStatusSnapshot(snapshot: StatusSnapshot): StatusSnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    overall: snapshot.overall,
    services: snapshot.services.flatMap((service) => {
      if (!isPublicServiceId(service.id)) return [];
      const metrics = service.id === 'rpc' ? publicRpcMetrics(service.metrics) : undefined;
      return [{
        id: service.id,
        label: PUBLIC_SERVICE_LABELS[service.id],
        status: service.status,
        ...(service.latencyMs !== undefined ? { latencyMs: service.latencyMs } : {}),
        ...(metrics ? { metrics } : {}),
      }];
    }),
  };
}
