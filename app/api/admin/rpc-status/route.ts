import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { getBaseRpcMetrics, listBaseRpcEndpoints } from '@/lib/base-rpc';

const RPC_TIMEOUT_MS = 3_000;

// Lightweight health check per RPC endpoint
async function checkEndpoint(url: string) {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    // eth_blockNumber as a generic readiness probe
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: controller.signal,
    });
    const ms = Date.now() - start;
    if (!res.ok) return { url, ok: false, ms, error: `HTTP ${res.status}` };
    const json = await res.json();
    const ok = Boolean(json?.result);
    return { url, ok, ms, error: ok ? undefined : 'No result' };
  } catch (e: any) {
    return {
      url,
      ok: false,
      ms: Date.now() - start,
      error: e?.name === 'AbortError' ? 'timeout' : e?.message || 'error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  if (!validateAdminKey(request)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    const endpoints = listBaseRpcEndpoints();
    const liveMetrics = getBaseRpcMetrics();
    const metricMap = new Map(liveMetrics.map((metric) => [metric.url, metric]));
    const checks = await Promise.all(endpoints.map((u) => checkEndpoint(u)));
    const enrichedChecks = checks.map((check) => ({
      ...check,
      ...(metricMap.get(check.url) ?? {
        successCount: 0,
        failureCount: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureMessage: null,
        ewmaLatencyMs: null,
      }),
    }));
    const summary = {
      total: enrichedChecks.length,
      healthy: enrichedChecks.filter(c => c.ok).length,
      degraded: enrichedChecks.filter(c => !c.ok).length,
      avgLatencyMs: Math.round(enrichedChecks.reduce((s, c) => s + c.ms, 0) / Math.max(1, enrichedChecks.length)),
      liveSuccessCount: enrichedChecks.reduce((sum, check) => sum + check.successCount, 0),
      liveFailureCount: enrichedChecks.reduce((sum, check) => sum + check.failureCount, 0),
    };
    return NextResponse.json({ success: true, summary, endpoints: enrichedChecks, timestamp: Date.now() });
  } catch (e: any) {
    return NextResponse.json(createErrorResponse('Failed to check RPC status', 500).body, { status: 500 });
  }
}


