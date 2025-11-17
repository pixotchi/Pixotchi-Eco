import { CLIENT_ENV, listRpcHttpEndpoints } from './env-config';
import { redis } from './redis';

type StatusLevel = 'operational' | 'degraded' | 'outage' | 'unknown';

export interface StatusService {
  id: string;
  label: string;
  status: StatusLevel;
  latencyMs?: number;
  details?: string;
  metrics?: Record<string, unknown>;
}

export interface StatusSnapshot {
  generatedAt: string;
  overall: StatusLevel;
  services: StatusService[];
}

const DEFAULT_TIMEOUT_MS = Number(process.env.STATUS_CHECK_TIMEOUT_MS || 6000);
const APP_HEALTH_URL = process.env.STATUS_APP_HEALTH_URL || CLIENT_ENV.APP_URL;
const MINIAPP_HEALTH_URL = process.env.STATUS_MINIAPP_HEALTH_URL || '';
const STAKE_APP_URL = process.env.STATUS_STAKE_APP_URL || 'https://stake.pixotchi.tech';
const BASE_STATUS_URL = process.env.STATUS_BASE_STATUS_URL || 'https://status.base.org/api/v2/summary.json';

const normalizeUrl = (url?: string | null) => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
};

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
  } catch (error: any) {
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
  const endpoints = listRpcHttpEndpoints();
  const timeout = DEFAULT_TIMEOUT_MS;
  const results = await Promise.all(endpoints.map(async (url) => {
    const { result, error, ms } = await measure(async () => {
      const response = await withTimeout((signal) => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        cache: 'no-store',
        signal,
      }), timeout);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      if (!json?.result) {
        throw new Error('Invalid response');
      }
      return json.result;
    });
    return {
      ok: !error,
      ms,
      error: error ? (error?.name === 'AbortError' ? 'timeout' : error?.message || 'error') : undefined,
    };
  }));

  const healthy = results.filter(r => r.ok).length;
  const status = deriveStatus(healthy, results.length);
  const avgHealthyLatency = healthy > 0
    ? Math.round(results.filter(r => r.ok).reduce((sum, r) => sum + (r.ms || 0), 0) / healthy)
    : undefined;

  return {
    id: 'rpc',
    label: 'RPC Cluster',
    status,
    latencyMs: avgHealthyLatency,
    details: `${healthy}/${results.length || 1} endpoints responsive`,
    metrics: {
      healthyCount: healthy,
      totalCount: results.length,
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
    label: 'Mini App & API',
    status,
    latencyMs: ms,
    details: error ? (error?.message || 'Unreachable') : 'Reachable',
  };
}

async function checkIndexer(): Promise<StatusService> {
  const url = process.env.NEXT_PUBLIC_PONDER_API_URL || 'https://api.mini.pixotchi.tech/graphql';
  const payload = {
    query: `
      query StatusPing {
        attacks(limit: 1) { items { id } }
      }
    `.trim(),
  };

  const { error, ms } = await measure(async () => {
    const response = await withTimeout((signal) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal,
    }), DEFAULT_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json = await response.json();
    if (!json?.data?.attacks) {
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
      ]) as Promise<unknown>;
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
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) {
    return {
      id: 'notifications',
      label: 'Notifications (Neynar)',
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
    label: 'Notifications (Neynar)',
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
  const mainnetComponent = components.find((component: any) =>
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
    } catch (error: any) {
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

export type { StatusLevel };

