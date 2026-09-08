'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { useAdminRead } from '@/hooks/useAdminRead';
import { parseAdminLeaderboards, parseAdminOperation } from '@/lib/admin-api-data';
import { toast } from 'react-hot-toast';
import { type AdminSectionProps, AdminReadError, LoadingSpinner, getErrorName, getErrorMessage, useAdminAbortController } from './admin-section-shared';

export function AdminGamificationSection({ adminKey, isActive, showConfirmDialog }: Pick<AdminSectionProps, 'adminKey' | 'isActive' | 'showConfirmDialog'>) {
  const abortControllerRef = useAdminAbortController(isActive);
  const { data: gmLb, loading: readLoading, error: readError, reload } = useAdminRead({ adminKey, isActive, endpoint: '/api/gamification/leaderboards', parse: parseAdminLeaderboards, label: 'Leaderboards' });

  const resetGamification = async (scope: 'streaks' | 'missions' | 'all') => {
    try {
      const res = await fetch('/api/gamification/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
        body: JSON.stringify({ scope }),
        signal: abortControllerRef.current?.signal,
      });
      const data = parseAdminOperation(await res.json());
      if (!data) throw new Error('Response could not be read. Reload to check the result.');
      if (res.ok && typeof data.deleted === 'number') {
        toast.success(`Reset ${scope} successfully (${data.deleted} keys deleted)`);
      } else {
        toast.error(data?.error || `Failed to reset ${scope}`);
      }
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') {
        console.error('Reset gamification error:', error);
        toast.error(getErrorMessage(error) || 'Reset failed');
      }
    }
  };

  const confirmResetGamification = (scope: 'streaks' | 'missions' | 'all') => {
    showConfirmDialog({
      title: 'Reset Gamification Data',
      description: `Are you sure you want to reset ${scope}? This will delete all related data and cannot be undone.`,
      confirmText: 'Reset',
      onConfirm: () => resetGamification(scope),
      isDangerous: scope === 'all',
    });
  };

  // Export helpers for gamification data
  const exportToCSV = (data: Array<{ address: string; value: number }>, filename: string) => {
    if (!data || data.length === 0) {
      toast.error('No data to export');
      return;
    }
    const header = 'address,value';
    const rows = data.map(e => `${e.address},${e.value}`);
    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${data.length} rows to CSV`);
  };

  const exportToJSON = (data: Array<{ address: string; value: number }>, filename: string) => {
    if (!data || data.length === 0) {
      toast.error('No data to export');
      return;
    }
    const jsonContent = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${data.length} entries to JSON`);
  };

  if (!isActive) return null;
  return (<div className="space-y-6">
    <AdminReadError message={readError} onRetry={reload} busy={readLoading} />
    <Card>
      <CardHeader>
        <CardTitle>Leaderboards</CardTitle>
        <CardDescription>Streaks reset monthly; Rocks accumulate across all months</CardDescription>
      </CardHeader>
      <CardContent>
        {readLoading ? (
          <LoadingSpinner text="Loading leaderboards..." />
        ) : gmLb ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">Streaks (Best · All-Time)</h4>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => exportToCSV(gmLb.streakTop, 'streaks')}>
                    <Download className="w-3 h-3 mr-1" />CSV
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => exportToJSON(gmLb.streakTop, 'streaks')}>
                    <Download className="w-3 h-3 mr-1" />JSON
                  </Button>
                </div>
              </div>
              <ScrollArea className="space-y-2 max-h-[400px] overflow-y-auto">
                {gmLb.streakTop.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No data</div>
                ) : gmLb.streakTop.map((e, i) => (
                  <div key={`s-${e.address}-${i}`} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="font-mono text-xs">{e.address}</div>
                    <div className="text-sm font-semibold">{e.value}</div>
                  </div>
                ))}
              </ScrollArea>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">Missions (Rocks · All-Time)</h4>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => exportToCSV(gmLb.missionTop, 'missions')}>
                    <Download className="w-3 h-3 mr-1" />CSV
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => exportToJSON(gmLb.missionTop, 'missions')}>
                    <Download className="w-3 h-3 mr-1" />JSON
                  </Button>
                </div>
              </div>
              <ScrollArea className="space-y-2 max-h-[400px] overflow-y-auto">
                {gmLb.missionTop.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No data</div>
                ) : gmLb.missionTop.map((e, i) => (
                  <div key={`m-${e.address}-${i}`} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="font-mono text-xs">{e.address}</div>
                    <div className="text-sm font-semibold">{e.value}</div>
                  </div>
                ))}
              </ScrollArea>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Admin Actions</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Button variant="outline" onClick={() => confirmResetGamification('streaks')}><RefreshCw className="w-4 h-4 mr-2" />Reset Streaks</Button>
        <Button variant="outline" onClick={() => confirmResetGamification('missions')}><RefreshCw className="w-4 h-4 mr-2" />Reset Missions</Button>
        <Button variant="destructive" onClick={() => confirmResetGamification('all')}><Trash2 className="w-4 h-4 mr-2" />Reset All</Button>
      </CardContent>
    </Card>
  </div>);
}
