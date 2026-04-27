import { createErrorResponse,validateAdminKey } from '@/lib/auth-utils';
import { getBaseRpcStatusSnapshot } from '@/lib/base-rpc';
import { NextRequest,NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  if (!validateAdminKey(request)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    const snapshot = await getBaseRpcStatusSnapshot({ refreshProbe: true });
    const endpoints = snapshot.endpoints.map((endpoint) => ({
      url: endpoint.url,
      vendor: endpoint.vendor,
      rank: endpoint.rank,
      ok: endpoint.probe.healthy && endpoint.read.healthy,
      ms: endpoint.probe.ewmaLatencyMs ?? endpoint.read.ewmaLatencyMs ?? 0,
      error:
        endpoint.probe.lastFailureMessage ??
        endpoint.read.lastFailureMessage ??
        endpoint.receipt.lastFailureMessage ??
        endpoint.log.lastFailureMessage ??
        undefined,
      successCount:
        endpoint.read.successCount +
        endpoint.receipt.successCount +
        endpoint.log.successCount +
        endpoint.probe.successCount,
      failureCount:
        endpoint.read.failureCount +
        endpoint.receipt.failureCount +
        endpoint.log.failureCount +
        endpoint.probe.failureCount,
      lastSuccessAt:
        endpoint.probe.lastSuccessAt ??
        endpoint.read.lastSuccessAt ??
        endpoint.receipt.lastSuccessAt ??
        endpoint.log.lastSuccessAt,
      lastFailureAt:
        endpoint.probe.lastFailureAt ??
        endpoint.read.lastFailureAt ??
        endpoint.receipt.lastFailureAt ??
        endpoint.log.lastFailureAt,
      lastFailureMessage:
        endpoint.probe.lastFailureMessage ??
        endpoint.read.lastFailureMessage ??
        endpoint.receipt.lastFailureMessage ??
        endpoint.log.lastFailureMessage,
      coolingDown:
        endpoint.read.coolingDown ||
        endpoint.receipt.coolingDown ||
        endpoint.log.coolingDown ||
        endpoint.probe.coolingDown,
      readCoolingDown: endpoint.read.coolingDown,
      receiptCoolingDown: endpoint.receipt.coolingDown,
      logCoolingDown: endpoint.log.coolingDown,
      probeCoolingDown: endpoint.probe.coolingDown,
      readConsecutiveFailures: endpoint.read.consecutiveFailures,
      receiptConsecutiveFailures: endpoint.receipt.consecutiveFailures,
      logConsecutiveFailures: endpoint.log.consecutiveFailures,
      probeConsecutiveFailures: endpoint.probe.consecutiveFailures,
      readOpenUntilAt: endpoint.read.openUntilAt,
      receiptOpenUntilAt: endpoint.receipt.openUntilAt,
      logOpenUntilAt: endpoint.log.openUntilAt,
      probeOpenUntilAt: endpoint.probe.openUntilAt,
      ewmaLatencyMs: endpoint.read.ewmaLatencyMs,
      readHealthy: endpoint.read.healthy,
      receiptHealthy: endpoint.receipt.healthy,
      logHealthy: endpoint.log.healthy,
      probeHealthy: endpoint.probe.healthy,
    }));

    return NextResponse.json({
      success: true,
      summary: snapshot.summary,
      endpoints,
      rankedUrls: snapshot.rankedUrls,
      timestamp: snapshot.generatedAt,
    });
  } catch {
    return NextResponse.json(createErrorResponse('Failed to check RPC status', 500).body, { status: 500 });
  }
}


