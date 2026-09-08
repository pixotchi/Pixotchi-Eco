'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw } from 'lucide-react';

import { useAdminRead } from '@/hooks/useAdminRead';
import { parseAdminRpc } from '@/lib/admin-api-data';
import { type AdminSectionProps, AdminReadError, LoadingSpinner } from './admin-section-shared';

export function AdminRpcSection({ adminKey, isActive }: Pick<AdminSectionProps, 'adminKey' | 'isActive'>) {
  const { data, loading: rpcLoading, error: readError, reload: fetchRpcStatus } = useAdminRead({ adminKey, isActive, endpoint: '/api/admin/rpc-status', parse: parseAdminRpc, label: 'RPC' });
  const rpcStatus = data;

  if (!isActive) return null;
  return (<div className="space-y-6">
    <AdminReadError message={readError} onRetry={fetchRpcStatus} busy={rpcLoading} />
    <Card>
      <CardHeader>
        <CardTitle>RPC Health</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-muted-foreground">
            {rpcStatus ? (
              <span>
                Total: {rpcStatus.summary?.total} • Healthy: {rpcStatus.summary?.healthy} • Degraded: {rpcStatus.summary?.degraded} • Cooling Down: {rpcStatus.summary?.coolingDown ?? 0} • Avg: {rpcStatus.summary?.avgLatencyMs}ms • Live Success: {rpcStatus.summary?.liveSuccessCount} • Live Failure: {rpcStatus.summary?.liveFailureCount}
              </span>
            ) : (
              <span>Press refresh to check RPCs</span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={fetchRpcStatus} disabled={rpcLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${rpcLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {rpcLoading ? (
          <LoadingSpinner text="Checking RPC endpoints..." />
        ) : (
          <div className="space-y-2">
            {(rpcStatus?.endpoints || []).map((e) => (
              <div key={e.url} className={`flex items-center justify-between p-2 rounded border ${e.ok ? 'bg-[hsl(var(--success)/0.08)] border-[hsl(var(--success)/0.22)]' : 'bg-destructive/10 border-destructive/25'}`}>
                <div className="mr-2 min-w-0">
                  <div className="font-mono text-xs truncate" title={e.url}>{e.url}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {e.vendor || 'Unknown vendor'}{typeof e.rank === 'number' ? ` • rank ${e.rank}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className={e.ok ? 'text-[hsl(var(--success-strong))]' : 'text-destructive'}>{e.ok ? 'OK' : 'DOWN'}</span>
                  {e.coolingDown && <span className="text-[hsl(var(--warning))]">COOLDOWN</span>}
                  <span className="text-muted-foreground">{e.ms}ms</span>
                  <span className="text-muted-foreground">live {e.successCount}/{e.failureCount}</span>
                  {e.ewmaLatencyMs !== null && <span className="text-muted-foreground">ewma {e.ewmaLatencyMs}ms</span>}
                  <span className="text-muted-foreground">
                    r {e.readHealthy ? '1' : '0'} • rcpt {e.receiptHealthy ? '1' : '0'} • log {e.logHealthy ? '1' : '0'} • probe {e.probeHealthy ? '1' : '0'}
                  </span>
                  {(e.readCoolingDown || e.receiptCoolingDown || e.logCoolingDown || e.probeCoolingDown) && (
                    <span className="text-muted-foreground">
                      cd r {e.readCoolingDown ? '1' : '0'} • rcpt {e.receiptCoolingDown ? '1' : '0'} • log {e.logCoolingDown ? '1' : '0'} • probe {e.probeCoolingDown ? '1' : '0'}
                    </span>
                  )}
                  {typeof e.readConsecutiveFailures === 'number' && e.readConsecutiveFailures > 0 && (
                    <span className="text-muted-foreground">read fails {e.readConsecutiveFailures}</span>
                  )}
                  {e.readOpenUntilAt && e.readOpenUntilAt > Date.now() && (
                    <span className="text-muted-foreground">
                      read until {formatDistanceToNow(e.readOpenUntilAt, { addSuffix: true })}
                    </span>
                  )}
                  {!e.ok && e.error && <span className="text-muted-foreground truncate max-w-[12rem]" title={e.error}>{e.error}</span>}
                </div>
              </div>
            ))}
            {(rpcStatus?.endpoints?.length || 0) === 0 && (
              <div className="text-center text-muted-foreground text-sm">No endpoints configured.</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  </div>);
}
