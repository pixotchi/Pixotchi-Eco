import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { listRpcHttpEndpoints } from '@/lib/env-config';

// Lightweight health check per RPC endpoint
async function checkEndpoint(url: string) {
  const start = Date.now();
  try {
    // eth_blockNumber as a generic readiness probe
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    const ms = Date.now() - start;
    if (!res.ok) return { url, ok: false, ms, error: `HTTP ${res.status}` };
    const json = await res.json();
    const ok = Boolean(json?.result);
    return { url, ok, ms, error: ok ? undefined : 'No result' };
  } catch (e: any) {
    return { url, ok: false, ms: Date.now() - start, error: e?.message || 'error' };
  }
}

export async function GET(request: NextRequest) {
  if (!validateAdminKey(request)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    const endpoints = listRpcHttpEndpoints();
    const checks = await Promise.all(endpoints.map((u) => checkEndpoint(u)));
    const summary = {
      total: checks.length,
      healthy: checks.filter(c => c.ok).length,
      degraded: checks.filter(c => !c.ok).length,
      avgLatencyMs: Math.round(checks.reduce((s, c) => s + c.ms, 0) / Math.max(1, checks.length)),
    };
    return NextResponse.json({ success: true, summary, endpoints: checks, timestamp: Date.now() });
  } catch (e: any) {
    return NextResponse.json(createErrorResponse('Failed to check RPC status', 500).body, { status: 500 });
  }
}


