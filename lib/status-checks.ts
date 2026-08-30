import { CLIENT_ENV, SERVER_ENV } from './env-config';
import { getBaseRpcStatusSnapshot } from './base-rpc';
import { redis, redisGetJSON, redisSetJSON } from './redis';
import { fetchIndexerGraphQL } from './indexer-client';
import { fetchBaseNotificationUsers } from './notifications/base-api';
import { getNotificationProviderLabel } from './notifications/provider';

type StatusLevel = 'operational' | 'degraded' | 'outage' | 'unknown';

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

const DEFAULT_TIMEOUT_MS = Number(process.env.STATUS_CHECK_TIMEOUT_MS || 6000);
const APP_HEALTH_PATH = '/api/health';
const MINIAPP_HEALTH_URL = process.env.STATUS_MINIAPP_HEALTH_URL || '';
const STAKE_APP_URL = process.env.STATUS_STAKE_APP_URL || 'https://stake.pixotchi.tech';
const BASE_STATUS_URL = process.env.STATUS_BASE_STATUS_URL || 'https://status.base.org/api/v2/summary.json';
const STATUS_CACHE_KEY = `status:checks:snapshot:${SERVER_ENV.NOTIFICATION_PROVIDER}:v1`;
const DEFAULT_STATUS_CACHE_TTL_SECONDS = Number(process.env.STATUS_SNAPSHOT_TTL_SECONDS || 300);

let inFlightSnapshot: Promise<StatusSnapshot> | null = null;
let memorySnapshot: StatusSnapshot | null = null;
let memorySnapshotExpiresAt = 0;

const normalizeUrl = (url?: string | null) => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
};

const withDefaultHealthPath = (url?: string | null, path: string = APP_HEALTH_PATH) => {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    const isBareOriginPath = parsed.pathname === '/' || parsed.pathname === '';
    if (isBareOriginPath && !parsed.search && !parsed.hash) {
      parsed.pathname = path;
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
};

const APP_HEALTH_URL = withDefaultHealthPath(
  process.env.STATUS_APP_HEALTH_URL || CLIENT_ENV.APP_URL,
);

const withTimeout = async <T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await fn(controller.signal);
    return result;
  } finally {
    clearTimeout(timeout);
  }
};

const measure = async <T>(fn: () => Promise<T>) => {
  const start = Date.now();
  try {
    const result = await fn();
    return { result, ms: Date.now() - start };
  } catch (error: UntypedValue) {
    return { error, ms: Date.now() - start };
  }
};

const deriveStatus = (healthy: number, total: number): StatusLevel => {
  if (total === 0) return 'unknown';
  if (healthy === 0) return 'outage';
  if (healthy < total) return 'degraded';
  return 'operational';
};

async function checkRpcCluster(): Promise<StatusService> {
  const snapshot = await getBaseRpcStatusSnapshot({ refreshProbe: true });
  const healthy = snapshot.summary.healthy;
  const total = snapshot.summary.total;
  const status = deriveStatus(healthy, total);
  const avgHealthyLatency = snapshot.summary.avgLatencyMs ?? undefined;
  const coolingDown = snapshot.summary.coolingDown;

  return {
    id: 'rpc',
    label: 'RPC Cluster',
    status,
    latencyMs: avgHealthyLatency,
    details: `${healthy}/${total || 1} endpoints passing probe + read checks${coolingDown > 0 ? ` • ${coolingDown} cooling down` : ''}`,
    metrics: {
      coolingDown,
      healthyCount: healthy,
      totalCount: total,
      uniqueVendorCount: snapshot.summary.uniqueVendorCount,
      rankedUrls: snapshot.rankedUrls,
      endpoints: snapshot.endpoints.map((endpoint) => ({
        error:
          endpoint.probe.lastFailureMessage ??
          endpoint.read.lastFailureMessage ??
          null,
        ewmaLatencyMs:
          endpoint.probe.ewmaLatencyMs ??
          endpoint.read.ewmaLatencyMs ??
          null,
        logHealthy: endpoint.log.healthy,
        logCoolingDown: endpoint.log.coolingDown,
        probeHealthy: endpoint.probe.healthy,
        probeCoolingDown: endpoint.probe.coolingDown,
        rank: endpoint.rank,
        readHealthy: endpoint.read.healthy,
        readCoolingDown: endpoint.read.coolingDown,
        receiptHealthy: endpoint.receipt.healthy,
        receiptCoolingDown: endpoint.receipt.coolingDown,
        url: endpoint.url,
        vendor: endpoint.vendor,
      })),
    },
  };
}

async function checkAppReachability(): Promise<StatusService> {
  const target = normalizeUrl(APP_HEALTH_URL);
  if (!target) {
    return {
      id: 'app',
      label: 'Mini App',
      status: 'unknown',
      details: 'App URL not configured',
    };
  }

  const { error, ms } = await measure(async () => {
    const response = await withTimeout((signal) => fetch(target, {
      method: 'HEAD',
      cache: 'no-store',
      signal,
    }), DEFAULT_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  });

  const status: StatusLevel = error
    ? (error?.name === 'AbortError' ? 'outage' : 'degraded')
    : 'operational';

  return {
    id: 'app',
    label: 'Ecosystem App',
    status,
    latencyMs: ms,
    details: error ? (error?.message || 'Unreachable') : 'Reachable',
  };
}

async function checkIndexer(): Promise<StatusService> {
  const { error, ms } = await measure(async () => {
    const query = `
      query StatusPing {
        attacks(limit: 1) { items { id } }
      }
    `.trim();

    const result = await withTimeout(
      (signal) => fetchIndexerGraphQL<{ attacks?: { items?: Array<{ id: string }> } }>(query, undefined, { signal }),
      DEFAULT_TIMEOUT_MS,
    );

    if (!result?.attacks) {
      throw new Error('No data');
    }
  });

  const status: StatusLevel = error
    ? (error?.name === 'AbortError' ? 'outage' : 'degraded')
    : 'operational';

  return {
    id: 'indexer',
    label: 'Indexer (Ponder)',
    status,
    latencyMs: ms,
    details: error ? (error?.message || 'Unavailable') : 'Responding',
  };
}

async function checkRedis(): Promise<StatusService> {
  if (!redis) {
    return {
      id: 'redis',
      label: 'Database',
      status: 'unknown',
      details: 'Redis not configured',
    };
  }

  const { error, ms } = await measure(async () => {
    await withTimeout((signal) => {
      // Upstash client does not support AbortSignal; emulate via race
      return Promise.race([
        redis!.ping(),
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
        }),
      ]) as Promise<UntypedValue>;
    }, DEFAULT_TIMEOUT_MS);
  });

  const status: StatusLevel = error
    ? (error?.name === 'AbortError' ? 'outage' : 'degraded')
    : 'operational';

  return {
    id: 'redis',
    label: 'Database',
    status,
    latencyMs: ms,
    details: error ? (error?.message || 'Ping failed') : 'Ping successful',
  };
}

async function checkNotifications(): Promise<StatusService> {
  if (SERVER_ENV.NOTIFICATION_PROVIDER === 'base') {
    if (!SERVER_ENV.BASE_NOTIFICATIONS_API_KEY) {
      return {
        id: 'notifications',
        label: `Notifications (${getNotificationProviderLabel('base')})`,
        status: 'unknown',
        details: 'API key missing',
      };
    }

    const { error, ms } = await measure(async () => {
      await fetchBaseNotificationUsers({ limit: 1, notificationEnabled: true });
    });

    const status: StatusLevel = error
      ? (error?.name === 'AbortError' ? 'outage' : 'degraded')
      : 'operational';

    return {
      id: 'notifications',
      label: `Notifications (${getNotificationProviderLabel('base')})`,
      status,
      latencyMs: ms,
      details: error ? (error?.message || 'Unreachable') : 'API responding',
    };
  }

  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) {
    return {
      id: 'notifications',
      label: `Notifications (${getNotificationProviderLabel('neynar')})`,
      status: 'unknown',
      details: 'API key missing',
    };
  }

  const searchUrl = 'https://api.neynar.com/v2/farcaster/user/search?q=pixotchi&limit=1';
  const { error, ms } = await measure(async () => {
    const response = await withTimeout((signal) => fetch(searchUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'api_key': apiKey,
      },
      cache: 'no-store',
      signal,
    }), DEFAULT_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  });

  const status: StatusLevel = error
    ? (error?.name === 'AbortError' ? 'outage' : 'degraded')
    : 'operational';

  return {
    id: 'notifications',
    label: `Notifications (${getNotificationProviderLabel('neynar')})`,
    status,
    latencyMs: ms,
    details: error ? (error?.message || 'Unreachable') : 'API responding',
  };
}

async function checkFarcasterMiniApp(): Promise<StatusService> {
  const url = MINIAPP_HEALTH_URL.trim();
  if (!url) {
    return {
      id: 'miniapp',
      label: 'Farcaster Mini App',
      status: 'unknown',
      details: 'Mini App health URL not configured',
    };
  }

  const { error, ms } = await measure(async () => {
    const response = await withTimeout((signal) => fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal,
    }), DEFAULT_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  });

  const status: StatusLevel = error
    ? (error?.name === 'AbortError' ? 'outage' : 'degraded')
    : 'operational';

  return {
    id: 'miniapp',
    label: 'Farcaster Mini App',
    status,
    latencyMs: ms,
    details: error ? (error?.message || 'Ping failed') : 'Reachable',
  };
}

async function checkStakeApp(): Promise<StatusService> {
  const target = normalizeUrl(STAKE_APP_URL);
  if (!target) {
    return {
      id: 'stake-app',
      label: 'Staking App',
      status: 'unknown',
      details: 'Stake app URL not configured',
    };
  }

  const { error, ms } = await measure(async () => {
    const response = await withTimeout((signal) => fetch(target, {
      method: 'HEAD',
      cache: 'no-store',
      signal,
    }), DEFAULT_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  });

  const status: StatusLevel = error
    ? (error?.name === 'AbortError' ? 'outage' : 'degraded')
    : 'operational';

  return {
    id: 'stake-app',
    label: 'Staking App',
    status,
    latencyMs: ms,
    details: error ? (error?.message || 'Unreachable') : 'Reachable',
  };
}

const statuspageToStatusLevel = (status?: string): StatusLevel => {
  switch (status) {
    case 'operational':
      return 'operational';
    case 'degraded_performance':
      return 'degraded';
    case 'partial_outage':
      return 'degraded';
    case 'major_outage':
      return 'outage';
    case 'under_maintenance':
      return 'degraded';
    default:
      return 'unknown';
  }
};

async function checkBaseMainnet(): Promise<StatusService> {
  const url = BASE_STATUS_URL.trim();
  if (!url) {
    return {
      id: 'base-mainnet',
      label: 'Base Mainnet',
      status: 'unknown',
      details: 'Base status URL not configured',
    };
  }

  const { error, result, ms } = await measure(async () => {
    const response = await withTimeout((signal) => fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal,
    }), DEFAULT_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  });

  if (error || !result) {
    return {
      id: 'base-mainnet',
      label: 'Base Mainnet',
      status: error?.name === 'AbortError' ? 'outage' : 'degraded',
      latencyMs: ms,
      details: error?.message || 'Unable to fetch Base status',
    };
  }

  const components = Array.isArray(result?.components) ? result.components : [];
  const mainnetComponent = components.find((component: UntypedValue) =>
    typeof component?.name === 'string' &&
    component.name.toLowerCase().includes('mainnet') &&
    !component.name.toLowerCase().includes('testnet')
  );

  const status = statuspageToStatusLevel(mainnetComponent?.status);
  return {
    id: 'base-mainnet',
    label: 'Base Mainnet',
    status,
    latencyMs: ms,
    details: mainnetComponent?.status
      ? `Statuspage: ${mainnetComponent.status.replace('_', ' ')}`
      : 'Component not found',
    metrics: {
      last_status_change: mainnetComponent?.updated_at,
      raw_status: mainnetComponent?.status,
    },
  };
}

const checks = [
  checkAppReachability,
  checkStakeApp,
  checkRpcCluster,
  checkIndexer,
  checkRedis,
  checkNotifications,
  checkFarcasterMiniApp,
  checkBaseMainnet,
];

export const runStatusChecks = async (): Promise<StatusSnapshot> => {
  const services: StatusService[] = await Promise.all(checks.map(async (fn) => {
    try {
      return await fn();
    } catch (error: UntypedValue) {
      return {
        id: fn.name,
        label: fn.name,
        status: 'unknown' as StatusLevel,
        details: error?.message || 'Failed to run check',
      };
    }
  }));

  const overall: StatusLevel = (() => {
    if (services.some(s => s.status === 'outage')) return 'outage';
    if (services.some(s => s.status === 'degraded')) return 'degraded';
    if (services.every(s => s.status === 'operational')) return 'operational';
    return 'unknown';
  })();

  return {
    generatedAt: new Date().toISOString(),
    overall,
    services,
  };
};

function getStatusCacheTtlSeconds(): number {
  return Number.isFinite(DEFAULT_STATUS_CACHE_TTL_SECONDS) && DEFAULT_STATUS_CACHE_TTL_SECONDS > 0
    ? DEFAULT_STATUS_CACHE_TTL_SECONDS
    : 300;
}

function rememberSnapshot(snapshot: StatusSnapshot) {
  memorySnapshot = snapshot;
  memorySnapshotExpiresAt = Date.now() + (getStatusCacheTtlSeconds() * 1000);
}

function snapshotMatchesCurrentNotificationProvider(snapshot: StatusSnapshot): boolean {
  const notifications = snapshot.services.find((service) => service.id === 'notifications');
  return notifications?.label === `Notifications (${getNotificationProviderLabel(SERVER_ENV.NOTIFICATION_PROVIDER)})`;
}

export async function getCachedStatusSnapshot(forceRefresh: boolean = false): Promise<StatusSnapshot> {
  const now = Date.now();

  if (
    !forceRefresh &&
    memorySnapshot &&
    memorySnapshotExpiresAt > now &&
    snapshotMatchesCurrentNotificationProvider(memorySnapshot)
  ) {
    return memorySnapshot;
  }

  if (!forceRefresh) {
    const cached = await redisGetJSON<StatusSnapshot>(STATUS_CACHE_KEY);
    if (cached && snapshotMatchesCurrentNotificationProvider(cached)) {
      rememberSnapshot(cached);
      return cached;
    }
  }

  if (inFlightSnapshot) {
    return inFlightSnapshot;
  }

  inFlightSnapshot = (async () => {
    const snapshot = await runStatusChecks();
    rememberSnapshot(snapshot);
    await redisSetJSON(STATUS_CACHE_KEY, snapshot, getStatusCacheTtlSeconds());
    return snapshot;
  })();

  try {
    return await inFlightSnapshot;
  } finally {
    inFlightSnapshot = null;
  }
}

export type { StatusLevel };
