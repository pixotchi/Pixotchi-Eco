'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, BadgeCheck, CheckCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAdminRead } from '@/hooks/useAdminRead';
import { parseAdminClaims, parseAdminOperation } from '@/lib/admin-api-data';
import { toast } from 'react-hot-toast';
import { type AdminSectionProps, AdminReadError } from './admin-section-shared';

export function AdminClaimsSection({ adminKey, isActive, showConfirmDialog }: Pick<AdminSectionProps, 'adminKey' | 'isActive' | 'showConfirmDialog'>) {
  const { data: claimsData, setData: setClaimsData, loading: readLoading, error: readError, reload } = useAdminRead({ adminKey, isActive, endpoint: '/api/admin/claims', parse: parseAdminClaims, label: 'Claims' });
  const [mutationLoading, setClaimsLoading] = useState(false);
  const claimsLoading = readLoading || mutationLoading;

  if (!isActive) return null;
  return (<div className="space-y-6">
    <AdminReadError message={readError} onRetry={reload} busy={readLoading} />
    <div className="flex items-center justify-between">
      <h2 className="text-2xl font-bold">Base Verify Claims</h2>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={reload}
          disabled={claimsLoading}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${claimsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        {claimsData && claimsData.claims.length > 0 && (
          <Button
            variant="destructive"
            onClick={() => {
              showConfirmDialog({
                title: 'Reset All Claims',
                description: 'This will delete ALL claim records from Redis. Every wallet will be able to claim again. This cannot be undone.',
                confirmText: 'Reset All',
                isDangerous: true,
                requiresTextConfirmation: true,
                textToMatch: 'RESET',
                onConfirm: async () => {
                  setClaimsLoading(true);
                  try {
                    const res = await fetch('/api/admin/claims?reset=all&confirm=true', {
                      method: 'DELETE',
                      headers: { 'Authorization': `Bearer ${adminKey}` }
                    });
                    const data = parseAdminOperation(await res.json());
                    if (!data) throw new Error('Response could not be read. Reload to check the result.');
                    if (res.ok) {
                      toast.success(data.message || 'All claims reset');
                      setClaimsData(null);
                    } else {
                      toast.error(data.error || 'Reset failed');
                    }
                  } catch {
                    toast.error('Failed to reset claims');
                  } finally {
                    setClaimsLoading(false);
                  }
                },
              });
            }}
            disabled={claimsLoading}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Reset All
          </Button>
        )}
      </div>
    </div>

    {/* Stats Cards */}
    {claimsData?.stats && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{claimsData.stats.total}</div>
            <p className="text-xs text-muted-foreground">Total Claims</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-[hsl(var(--success-strong))]">{claimsData.stats.complete}</div>
            <p className="text-xs text-muted-foreground">Complete</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-[hsl(var(--warning))]">{claimsData.stats.partial + claimsData.stats.failed}</div>
            <p className="text-xs text-muted-foreground">Partial / Failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {claimsData.stats.leafBonusSent}L / {claimsData.stats.seedBonusSent}S
            </div>
            <p className="text-xs text-muted-foreground">LEAF / SEED Bonuses Sent</p>
          </CardContent>
        </Card>
      </div>
    )}

    {/* Claims List */}
    <Card>
      <CardHeader>
        <CardTitle>Claimed Wallets</CardTitle>
        <CardDescription>
          Wallets that have claimed a free plant via Base Verify. Delete a record to allow that wallet to claim again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {claimsData && claimsData.claims.length > 0 ? (
          <div className="space-y-2">
            {/* Header */}
            <div className="hidden grid-cols-[minmax(0,1fr)_80px_70px_90px_100px_80px] gap-2 border-b px-3 pb-2 text-xs font-medium text-muted-foreground md:grid">
              <div>Address</div>
              <div>Token ID</div>
              <div>Strain</div>
              <div>Status</div>
              <div>Bonuses</div>
              <div>Actions</div>
            </div>
            {claimsData.claims.map((claim) => (
              <div key={claim.address} className="grid grid-cols-2 items-start gap-x-4 gap-y-3 rounded-lg border border-border/60 px-3 py-3 text-sm hover:bg-muted/50 md:grid-cols-[minmax(0,1fr)_80px_70px_90px_100px_80px] md:items-center md:gap-2 md:border-0 md:border-b md:border-border/40 md:py-2">
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground md:hidden">Address</span>
                  <span className="block truncate font-mono text-xs" title={claim.address}>
                    {claim.address?.slice(0, 8)}...{claim.address?.slice(-6)}
                  </span>
                </div>
                <div>
                  <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground md:hidden">Token ID</span>
                  <span className="font-mono text-xs">{claim.tokenId || '—'}</span>
                </div>
                <div>
                  <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground md:hidden">Strain</span>
                  <span>{claim.strainId || '—'}</span>
                </div>
                <div>
                  <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground md:hidden">Status</span>
                  {claim.status === 'complete' ? (
                    <span className="text-[hsl(var(--success-strong))] text-xs flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> OK
                    </span>
                  ) : (
                    <span className="text-[hsl(var(--warning))] text-xs flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {claim.status}
                    </span>
                  )}
                </div>
                <div>
                  <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground md:hidden">Bonuses</span>
                  <span className="text-xs text-muted-foreground">
                    {claim.leafBonusSent ? 'LEAF ' : ''}{claim.seedBonusSent ? 'SEED' : ''}{!claim.leafBonusSent && !claim.seedBonusSent ? '—' : ''}
                  </span>
                </div>
                <div className="col-span-2 flex justify-end md:col-span-1 md:justify-start">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 w-11 p-0 text-destructive hover:text-destructive"
                    aria-label={`Delete claim for ${claim.address}`}
                    onClick={() => {
                      showConfirmDialog({
                        title: 'Delete Claim',
                        description: `Remove claim record for ${claim.address}? This wallet will be able to claim again.`,
                        confirmText: 'Delete',
                        isDangerous: true,
                        onConfirm: async () => {
                          try {
                            const res = await fetch(`/api/admin/claims?address=${claim.address}`, {
                              method: 'DELETE',
                              headers: { 'Authorization': `Bearer ${adminKey}` }
                            });
                            const data = parseAdminOperation(await res.json());
                            if (!data) throw new Error('Response could not be read. Reload to check the result.');
                            if (res.ok) {
                              toast.success(data.message || 'Claim deleted');
                              // Remove from local state
                              setClaimsData(prev => prev ? {
                                ...prev,
                                claims: prev.claims.filter((c) => c.address !== claim.address),
                                stats: {
                                  ...prev.stats,
                                  total: prev.stats.total - 1,
                                  complete: claim.status === 'complete' ? prev.stats.complete - 1 : prev.stats.complete,
                                  partial: claim.status !== 'complete' && claim.status !== 'transfer_failed' ? prev.stats.partial - 1 : prev.stats.partial,
                                  failed: claim.status === 'transfer_failed' ? prev.stats.failed - 1 : prev.stats.failed,
                                  leafBonusSent: claim.leafBonusSent ? prev.stats.leafBonusSent - 1 : prev.stats.leafBonusSent,
                                  seedBonusSent: claim.seedBonusSent ? prev.stats.seedBonusSent - 1 : prev.stats.seedBonusSent,
                                },
                              } : null);
                            } else {
                              toast.error(data.error || 'Delete failed');
                            }
                          } catch {
                            toast.error('Failed to delete claim');
                          }
                        },
                      });
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <BadgeCheck className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No claims found</p>
            <p className="text-sm">Claims will appear here when users claim free plants via Base Verify</p>
          </div>
        )}
      </CardContent>
    </Card>
  </div>);
}
