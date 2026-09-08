'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CLIENT_ENV } from '@/lib/env-config';
import { AlertTriangle, Bell, Code, Eye, Megaphone, RefreshCw, Search, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { type AdminSectionProps, AdminReadError, getErrorName, getErrorMessage, useAdminAbortController } from './admin-section-shared';
import {
  parseNotificationStats, parseEligiblePlants, parseNotificationKeys, parseNotificationKeyDeletion,
  parseBaseCampaignPreview, parseBaseCampaignResult, parseNotificationOutcome, readNotificationResponse,
  type PlantNotificationStats, type GlobalNotificationStats, type BaseNotificationAudience,
  type BaseNotificationCampaign, type EligibleNotificationPlants, type NotificationKeys, type BaseNotificationPreview,
} from '@/lib/admin-notification-data';

export function AdminNotificationsSection({ adminKey, isActive, showConfirmDialog }: Pick<AdminSectionProps, 'adminKey' | 'isActive' | 'showConfirmDialog'>) {
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useAdminAbortController(isActive);
  const notificationProvider = CLIENT_ENV.NOTIFICATION_PROVIDER;
  const isBaseNotifications = notificationProvider === 'base';

  const [notifStats, setNotifStats] = useState<PlantNotificationStats | null>(null);
  const [notifGlobalStats, setNotifGlobalStats] = useState<GlobalNotificationStats | null>(null);
  const [eligibleFids, setEligibleFids] = useState<string[]>([]);
  const [notifDebugResult, setNotifDebugResult] = useState<unknown>(null);
  const [notifLoading, setNotifLoading] = useState(false);
  const [baseAudience, setBaseAudience] = useState<BaseNotificationAudience | null>(null);
  const [baseCampaigns, setBaseCampaigns] = useState<BaseNotificationCampaign[]>([]);
  const [baseSyncLoading, setBaseSyncLoading] = useState(false);
  const [baseSyncResult, setBaseSyncResult] = useState<unknown>(null);

  // Eligible plants management
  const [eligiblePlants, setEligiblePlants] = useState<EligibleNotificationPlants | null>(null);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [notifFidFilter, setNotifFidFilter] = useState('');
  const [triggerResult, setTriggerResult] = useState<unknown>(null);
  const [baseAddressFilter, setBaseAddressFilter] = useState('');
  const [baseCampaignTitle, setBaseCampaignTitle] = useState('');
  const [baseCampaignMessage, setBaseCampaignMessage] = useState('');
  const [baseCampaignTargetPath, setBaseCampaignTargetPath] = useState('/');
  const [baseCampaignAudienceMode, setBaseCampaignAudienceMode] = useState<'all' | 'selected'>('all');
  const [baseCampaignAddressInput, setBaseCampaignAddressInput] = useState('');
  const [baseCampaignPreview, setBaseCampaignPreview] = useState<BaseNotificationPreview | null>(null);
  const [baseCampaignResult, setBaseCampaignResult] = useState<unknown>(null);
  const [baseCampaignLoading, setBaseCampaignLoading] = useState(false);

  // Send notifications confirmation dialog
  const [sendNotifDialogOpen, setSendNotifDialogOpen] = useState(false);
  const [sendNotifProgress, setSendNotifProgress] = useState<{ sent: number; total: number; errors: string[] } | null>(null);

  // Notification Redis keys management
  const [notifKeys, setNotifKeys] = useState<NotificationKeys | null>(null);
  const [notifKeysLoading, setNotifKeysLoading] = useState(false);
  const [notifKeysExpanded, setNotifKeysExpanded] = useState<Record<string, boolean>>({});
  const [statsError, setStatsError] = useState<string | null>(null);
  const [eligibleError, setEligibleError] = useState<string | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const statsRequest = useRef(0);
  const eligibilityRequest = useRef(0);
  const campaignRequest = useRef(0);

  const invalidateEligibility = () => {
    eligibilityRequest.current += 1;
    setEligiblePlants(null);
    setSendNotifDialogOpen(false);
  };
  const invalidateCampaignPreview = () => {
    campaignRequest.current += 1;
    setBaseCampaignPreview(null);
    setBaseCampaignResult(null);
  };

  const fetchNotifKeys = async () => {
    if (!adminKey.trim()) return;
    setNotifKeysLoading(true);
    setKeysError(null);
    const signal = abortControllerRef.current?.signal;
    try {
      const res = await fetch('/api/admin/notifications/keys?limit=200', { headers: { Authorization: `Bearer ${adminKey}` }, signal });
      const data = await readNotificationResponse(res, parseNotificationKeys, 'Failed to load notification keys');
      if (!signal?.aborted) setNotifKeys(data);
    } catch (error) {
      if (getErrorName(error) !== 'AbortError' && !signal?.aborted) {
        setNotifKeys(null);
        setKeysError(getErrorMessage(error) || 'Failed to load notification keys');
      }
    } finally { if (!signal?.aborted) setNotifKeysLoading(false); }
  };

  const deleteNotifKey = async (key: string) => {
    if (!adminKey.trim()) return;
    setKeysError(null);
    try {
      const res = await fetch(`/api/admin/notifications/keys?key=${encodeURIComponent(key)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${adminKey}` }, signal: abortControllerRef.current?.signal,
      });
      await readNotificationResponse(res, parseNotificationKeyDeletion, 'Failed to delete key');
      toast.success(`Deleted key: ${key}`);
      void fetchNotifKeys();
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') setKeysError(getErrorMessage(error) || 'Failed to delete key');
    }
  };

  const deleteNotifKeysByPattern = async (pattern: string) => {
    if (!adminKey.trim()) return;
    setKeysError(null);
    try {
      const res = await fetch(`/api/admin/notifications/keys?pattern=${encodeURIComponent(pattern)}&confirm=true`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${adminKey}` }, signal: abortControllerRef.current?.signal,
      });
      const data = await readNotificationResponse(res, parseNotificationKeyDeletion, 'Failed to delete keys');
      toast.success(`Deleted ${data.deletedCount} keys matching ${pattern}`);
      void fetchNotifKeys();
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') setKeysError(getErrorMessage(error) || 'Failed to delete keys');
    }
  };

  const fetchNotifStats = useCallback(async () => {
    if (!adminKey.trim()) return;
    setNotifLoading(true);
    setStatsError(null);
    const request = ++statsRequest.current;
    const signal = abortControllerRef.current?.signal;
    try {
      const res = await fetch('/api/admin/notifications', { headers: { Authorization: `Bearer ${adminKey}` }, signal });
      const payload = await readNotificationResponse(res, value => parseNotificationStats(value, notificationProvider), 'Failed to load notification stats');
      if (signal?.aborted || request !== statsRequest.current) return;
      setNotifStats(payload.stats.plantTOD);
      setNotifGlobalStats(payload.stats.global ?? null);
      setEligibleFids(payload.stats.eligibleFids ?? []);
      setBaseAudience(payload.stats.audience ?? null);
      setBaseCampaigns(payload.stats.campaigns?.recent ?? []);
    } catch (error) {
      if (getErrorName(error) !== 'AbortError' && !signal?.aborted && request === statsRequest.current) {
        setNotifStats(null);
        setNotifGlobalStats(null);
        setEligibleFids([]);
        setBaseAudience(null);
        setBaseCampaigns([]);
        setStatsError(getErrorMessage(error) || 'Failed to load notification stats');
      }
    } finally { if (!signal?.aborted && request === statsRequest.current) setNotifLoading(false); }
  }, [adminKey, notificationProvider, abortControllerRef]);

  const runNotifDebug = async () => {
    if (!adminKey.trim()) return toast.error('Enter admin key');
    setLoading(true);
    setDebugError(null);
    setNotifDebugResult(null);
    try {
      const res = await fetch('/api/notifications/cron/plant-care?debug=1', {
        method: 'POST', headers: { Authorization: `Bearer ${adminKey}` }, signal: abortControllerRef.current?.signal,
      });
      const data = await readNotificationResponse(res, value => parseNotificationOutcome(value, 'debug'), 'Debug run failed');
      setNotifDebugResult(data.raw);
      toast.success('Debug run completed');
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') setDebugError(getErrorMessage(error) || 'Debug run failed');
    } finally { setLoading(false); }
  };

  const resetNotifHistory = async () => {
    if (!adminKey.trim()) return toast.error('Enter admin key');
    setLoading(true);
    setResetError(null);
    try {
      const res = await fetch('/api/admin/notifications/reset?scope=all', {
        method: 'DELETE', headers: { Authorization: `Bearer ${adminKey}` }, signal: abortControllerRef.current?.signal,
      });
      await readNotificationResponse(res, value => parseNotificationOutcome(value, 'reset'), 'Reset failed');
      toast.success('Notifications history reset successfully');
      setNotifDebugResult(null);
      invalidateEligibility();
      invalidateCampaignPreview();
      void fetchNotifStats();
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') setResetError(getErrorMessage(error) || 'Reset failed');
    } finally { setLoading(false); }
  };

  const confirmResetNotifHistory = () => {
    showConfirmDialog({
      title: 'Reset Notifications History',
      description: 'Are you sure you want to reset notifications counts and history for all users? This action cannot be undone.',
      confirmText: 'Reset', onConfirm: resetNotifHistory, isDangerous: true,
    });
  };

  const fetchEligiblePlants = async (recipientFilter?: string) => {
    if (!adminKey.trim()) return toast.error('Enter admin key');
    invalidateEligibility();
    const request = eligibilityRequest.current;
    const signal = abortControllerRef.current?.signal;
    setEligibleLoading(true);
    setEligibleError(null);
    try {
      const params = new URLSearchParams();
      if (recipientFilter) params.set(isBaseNotifications ? 'address' : 'fid', recipientFilter);
      const query = params.toString();
      const res = await fetch(`/api/admin/notifications/eligible${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${adminKey}` }, signal });
      const data = await readNotificationResponse(res, value => parseEligiblePlants(value, notificationProvider), 'Failed to fetch eligible plants');
      if (request !== eligibilityRequest.current || signal?.aborted) return;
      setEligiblePlants(data);
      toast.success(`Found ${data.summary.totalEligiblePlants} eligible plants across ${data.summary.wouldNotify} ${isBaseNotifications ? 'wallets' : 'users'}`);
    } catch (error) {
      if (request === eligibilityRequest.current && getErrorName(error) !== 'AbortError' && !signal?.aborted) {
        setEligiblePlants(null);
        setEligibleError(getErrorMessage(error) || 'Failed to fetch eligible plants');
      }
    } finally { if (!signal?.aborted) setEligibleLoading(false); }
  };

  const triggerNotifications = async (fid?: string, dryRun: boolean = false) => {
    if (isBaseNotifications) return;
    if (!adminKey.trim()) return toast.error('Enter admin key');
    setTriggerLoading(true);
    setTriggerError(null);
    setTriggerResult(null);
    try {
      const params = new URLSearchParams();
      if (fid) params.set('fid', fid);
      if (dryRun) params.set('dry', '1');
      const res = await fetch(`/api/admin/notifications/trigger?${params.toString()}`, {
        method: 'POST', headers: { Authorization: `Bearer ${adminKey}` }, signal: abortControllerRef.current?.signal,
      });
      const data = await readNotificationResponse(res, value => parseNotificationOutcome(value, 'trigger'), 'Trigger failed');
      setTriggerResult(data.raw);
      toast.success(dryRun ? `Dry run: Would notify FID ${fid}` : `Sent notification to FID ${fid}`);
      if (!dryRun) { invalidateEligibility(); void fetchNotifStats(); }
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') setTriggerError(getErrorMessage(error) || 'Trigger failed');
    } finally { setTriggerLoading(false); }
  };

  const getEligibleFidsToNotify = (): number[] => {
    if (eligibleLoading || eligiblePlants?.provider !== 'neynar') return [];
    return [...new Set(eligiblePlants.eligible
      .filter(user => !user.userThrottled && user.plants.some(plant => !plant.throttled && plant.hoursLeft > 0))
      .map(user => user.fid))];
  };

  const sendToEligibleFids = async () => {
    if (isBaseNotifications || !adminKey.trim()) return;
    const fidsToNotify = getEligibleFidsToNotify();
    if (fidsToNotify.length === 0) return toast.error('No eligible FIDs to notify');
    const signal = abortControllerRef.current?.signal;
    setTriggerLoading(true);
    setTriggerError(null);
    setSendNotifProgress({ sent: 0, total: fidsToNotify.length, errors: [] });
    const errors: string[] = [];
    let sent = 0;
    for (const fid of fidsToNotify) {
      if (signal?.aborted) break;
      try {
        const res = await fetch(`/api/admin/notifications/trigger?fid=${fid}`, {
          method: 'POST', headers: { Authorization: `Bearer ${adminKey}` }, signal,
        });
        await readNotificationResponse(res, value => parseNotificationOutcome(value, 'trigger'), 'Trigger failed');
        sent += 1;
      } catch (error) {
        if (getErrorName(error) === 'AbortError') break;
        errors.push(`FID ${fid}: ${getErrorMessage(error) || 'Network error'}`);
      }
      setSendNotifProgress({ sent, total: fidsToNotify.length, errors: [...errors] });
    }
    setTriggerLoading(false);
    setSendNotifDialogOpen(false);
    invalidateEligibility();
    if (signal?.aborted) return;
    if (errors.length === 0) toast.success(`Successfully sent notifications to ${sent} users`);
    else setTriggerError(`Sent to ${sent}/${fidsToNotify.length}. ${errors.join(' ')}`);
    void fetchNotifStats();
    void fetchEligiblePlants(notifFidFilter || undefined);
  };

  const runBaseAudienceSync = async (force: boolean = false) => {
    if (!adminKey.trim()) return toast.error('Enter admin key');
    setBaseSyncLoading(true);
    setSyncError(null);
    setBaseSyncResult(null);
    try {
      const res = await fetch(`/api/notifications/cron/base-audience-sync${force ? '?force=1' : ''}`, {
        method: 'POST', headers: { Authorization: `Bearer ${adminKey}` }, signal: abortControllerRef.current?.signal,
      });
      const data = await readNotificationResponse(res, value => parseNotificationOutcome(value, 'sync'), 'Audience sync failed');
      setBaseSyncResult(data.raw);
      invalidateCampaignPreview();
      invalidateEligibility();
      toast.success(data.skipped ? 'Audience sync skipped' : data.completed ? 'Audience sync completed' : 'Audience sync checkpoint saved');
      void fetchNotifStats();
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') setSyncError(getErrorMessage(error) || 'Audience sync failed');
    } finally { setBaseSyncLoading(false); }
  };

  const campaignBody = () => ({
    title: baseCampaignTitle, message: baseCampaignMessage, targetPath: baseCampaignTargetPath,
    audienceMode: baseCampaignAudienceMode, walletAddressInput: baseCampaignAddressInput,
  });

  const previewBaseCampaign = async () => {
    if (!adminKey.trim()) return toast.error('Enter admin key');
    invalidateCampaignPreview();
    const request = campaignRequest.current;
    const signal = abortControllerRef.current?.signal;
    setBaseCampaignLoading(true);
    setCampaignError(null);
    try {
      const res = await fetch('/api/admin/notifications/campaigns/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminKey}` },
        body: JSON.stringify(campaignBody()), signal,
      });
      const preview = await readNotificationResponse(res, parseBaseCampaignPreview, 'Preview failed');
      if (request !== campaignRequest.current || signal?.aborted) return;
      setBaseCampaignPreview(preview);
      toast.success(`Preview ready for ${preview.resolvedCount} wallets`);
    } catch (error) {
      if (request === campaignRequest.current && getErrorName(error) !== 'AbortError' && !signal?.aborted) {
        setBaseCampaignPreview(null);
        setCampaignError(getErrorMessage(error) || 'Preview failed');
      }
    } finally { if (!signal?.aborted) setBaseCampaignLoading(false); }
  };

  const sendBaseCampaign = async (dryRun: boolean = false) => {
    if (!adminKey.trim()) return toast.error('Enter admin key');
    if (!baseCampaignPreview || baseCampaignPreview.resolvedCount === 0) return;
    const request = campaignRequest.current;
    setBaseCampaignLoading(true);
    setCampaignError(null);
    setBaseCampaignResult(null);
    try {
      const res = await fetch('/api/admin/notifications/campaigns/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminKey}` },
        body: JSON.stringify({ ...campaignBody(), dryRun }), signal: abortControllerRef.current?.signal,
      });
      const data = await readNotificationResponse(res, parseBaseCampaignResult, 'Campaign failed');
      if (request !== campaignRequest.current) return;
      setBaseCampaignResult(data.raw);
      setBaseCampaignPreview(null);
      toast.success(dryRun ? 'Dry run saved' : `Campaign processed: ${data.result.sentCount} sent`);
      void fetchNotifStats();
    } catch (error) {
      if (request === campaignRequest.current && getErrorName(error) !== 'AbortError') {
        setBaseCampaignPreview(null);
        setCampaignError(getErrorMessage(error) || 'Campaign failed');
      }
    } finally { setBaseCampaignLoading(false); }
  };

  useEffect(() => { if (isActive) void fetchNotifStats(); }, [isActive, fetchNotifStats]);
  useEffect(() => {
    // Responses from a previous key or tab activation cannot restore recipients.
    eligibilityRequest.current += 1;
    campaignRequest.current += 1;
    setEligiblePlants(null);
    setBaseCampaignPreview(null);
    setSendNotifDialogOpen(false);
    setEligibleLoading(false);
    setBaseCampaignLoading(false);
    setNotifKeysLoading(false);
  }, [adminKey, isActive]);

  if (!isActive) return null;
  return (<><div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Notifications ({isBaseNotifications ? 'Base App' : 'Neynar'})</CardTitle>
      </CardHeader>
      <CardContent>
        <AdminReadError message={statsError} onRetry={fetchNotifStats} busy={notifLoading} />
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-muted-foreground">
            {notifStats ? (
              <span>
                Total sent: {notifStats.sentCount || 0} • Runs: {notifStats.totalRuns || 0}
              </span>
            ) : (
              <span>Press refresh to load stats</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchNotifStats} disabled={notifLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${notifLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={runNotifDebug} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Debug Run
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmResetNotifHistory} disabled={loading}>
              {loading ? 'Resetting…' : 'Reset History'}
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          {!isBaseNotifications && (
            <div className="text-sm">
              <div className="font-semibold mb-1">Global direct-send stats</div>
              <div className="flex items-center justify-between p-2 rounded border">
                <div>Sent total: {notifGlobalStats?.sentCount || 0}</div>
                <div className="text-xs text-muted-foreground">Recent entries: {(notifGlobalStats?.recent || []).length}</div>
              </div>
            </div>
          )}
          {debugError && <div role="alert" className="text-sm text-destructive flex flex-wrap items-center gap-3">
            {debugError}<Button variant="outline" size="sm" onClick={runNotifDebug} disabled={loading}>Retry debug run</Button>
          </div>}
          {resetError && <div role="alert" className="text-sm text-destructive flex flex-wrap items-center gap-3">
            {resetError}<Button variant="outline" size="sm" onClick={confirmResetNotifHistory} disabled={loading}>Retry reset</Button>
          </div>}
          <div className="text-sm">
            <div className="font-semibold mb-1">Last cron/debug run</div>
            <ScrollArea className="p-2 rounded border text-xs text-muted-foreground max-h-64 overflow-y-auto">
              <pre className="whitespace-pre-wrap">
                {JSON.stringify(notifDebugResult ?? notifStats?.lastRun ?? { message: 'No run summary yet.' }, null, 2)}
              </pre>
            </ScrollArea>
          </div>
          <div className="text-sm">
            <div className="font-semibold mb-1">Recent runs</div>
            <ScrollArea className="space-y-2 max-h-64 overflow-y-auto text-xs text-muted-foreground">
              {(notifStats?.recent || []).length === 0 ? (
                <div className="border rounded p-2">No history yet.</div>
              ) : (
                (notifStats?.recent || []).map((run, idx) => (
                  <pre key={idx} className="border p-2 rounded whitespace-pre-wrap">{JSON.stringify(run, null, 2)}</pre>
                ))
              )}
            </ScrollArea>
          </div>
        </div>
      </CardContent>
    </Card>

    {isBaseNotifications ? (
      <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> Base Audience Snapshot</CardTitle>
            <CardDescription>Wallet snapshot used for plant-care sends and mass campaigns.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="border rounded p-3">
                <div className="text-muted-foreground">Enabled wallets</div>
                <div className="text-xl font-semibold">{baseAudience?.enabledCount || 0}</div>
              </div>
              <div className="border rounded p-3">
                <div className="text-muted-foreground">Current snapshot</div>
                <div className="font-mono text-xs break-all">{baseAudience?.currentSnapshot?.id || 'None yet'}</div>
              </div>
              <div className="border rounded p-3">
                <div className="text-muted-foreground">Last completed</div>
                <div>{baseAudience?.currentSnapshot?.completedAt ? new Date(baseAudience.currentSnapshot.completedAt).toLocaleString() : 'Not synced yet'}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => runBaseAudienceSync(false)} disabled={baseSyncLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${baseSyncLoading ? 'animate-spin' : ''}`} />
                Sync / Resume
              </Button>
              <Button variant="outline" size="sm" onClick={() => runBaseAudienceSync(true)} disabled={baseSyncLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${baseSyncLoading ? 'animate-spin' : ''}`} />
                Force Full Sync
              </Button>
            </div>
            {syncError && <div role="alert" className="text-sm text-destructive flex flex-wrap items-center gap-3">
              {syncError}<Button variant="outline" size="sm" onClick={() => runBaseAudienceSync(false)} disabled={baseSyncLoading}>Retry sync</Button>
            </div>}
            <div className="text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground">Sync state</div>
              <ScrollArea className="p-2 rounded border whitespace-pre-wrap max-h-56 overflow-y-auto"><pre className="m-0 [white-space:inherit]">
                {JSON.stringify(baseSyncResult ?? baseAudience?.syncState ?? { message: 'No sync run recorded yet.' }, null, 2)}
              </pre></ScrollArea>
            </div>
            <div className="space-y-2">
              <div className="font-semibold text-sm">Recent snapshot history</div>
              <ScrollArea className="space-y-2 max-h-56 overflow-y-auto">
                {(baseAudience?.history || []).length === 0 ? (
                  <div className="border rounded p-2 text-sm text-muted-foreground">No snapshot history yet.</div>
                ) : (
                  (baseAudience?.history || []).map((entry) => (
                    <div key={entry.id} className="border rounded p-2 text-xs">
                      <div className="font-mono break-all">{entry.id}</div>
                      <div className="text-muted-foreground">
                        {entry.uniqueAddresses} wallets • {entry.pagesFetched} pages • {entry.completedAt ? new Date(entry.completedAt).toLocaleString() : 'in progress'}
                      </div>
                    </div>
                  ))
                )}
              </ScrollArea>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Base Plant-Care Eligibility</CardTitle>
            <CardDescription>Checks due plant owners against the cached enabled-wallet snapshot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Filter by wallet address (optional)"
                aria-label="Filter by wallet address"
                value={baseAddressFilter}
                onChange={(e) => { invalidateEligibility(); setBaseAddressFilter(e.target.value); }}
                className="w-full md:w-72"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchEligiblePlants(baseAddressFilter || undefined)}
                disabled={eligibleLoading}
              >
                <Search className={`w-4 h-4 mr-2 ${eligibleLoading ? 'animate-spin' : ''}`} />
                {eligibleLoading ? 'Loading...' : 'Check Eligible'}
              </Button>
            </div>

            <AdminReadError message={eligibleError} onRetry={() => fetchEligiblePlants(baseAddressFilter || undefined)} busy={eligibleLoading} />
            {eligiblePlants?.provider === 'base' && (
              <div className="space-y-3">
                <div className="p-3 rounded border text-sm space-y-1">
                  <div>
                    <span className="font-semibold">Summary:</span>{' '}
                    {eligiblePlants.summary?.addressesWithEligiblePlants || 0} wallets with due plants,{' '}
                    <span className="text-[hsl(var(--warning))] font-semibold">{eligiblePlants.summary?.totalEligiblePlants || 0} total eligible plants</span>
                  </div>
                  <div className="text-muted-foreground">
                    Would notify now: <span className="font-semibold text-[hsl(var(--success-strong))]">{eligiblePlants.summary?.wouldNotify || 0}</span> •
                    Throttled wallets: <span className="font-semibold text-[hsl(var(--warning))]"> {eligiblePlants.summary?.throttledUsers || 0}</span>
                  </div>
                </div>
                <ScrollArea className="space-y-2 max-h-[400px] overflow-y-auto">
                  {(eligiblePlants.eligible || []).length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">No Base wallets with eligible plants found.</div>
                  ) : (
                    (eligiblePlants.eligible || []).map((user) => (
                      <div key={user.address} className={`p-3 border rounded space-y-2 ${user.userThrottled ? 'opacity-60 bg-[hsl(var(--warning)/0.1)]' : ''}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-mono text-xs break-all">{user.address}</div>
                          {user.userThrottled && (
                            <span className="text-xs bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))] px-1.5 py-0.5 rounded">
                              THROTTLED
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {(user.plants || []).map((plant) => (
                            <div
                              key={plant.id}
                              className={`p-2 rounded text-xs ${plant.throttled ? 'bg-[hsl(var(--warning)/0.12)] border border-[hsl(var(--warning)/0.32)]' : 'bg-[hsl(var(--success)/0.1)] border border-[hsl(var(--success)/0.28)]'}`}
                            >
                              <div className="font-semibold">Plant #{plant.id}</div>
                              <div className={`${plant.throttled ? 'text-[hsl(var(--warning))]' : 'text-[hsl(var(--success-strong))]'} font-semibold`}>
                                {plant.hoursLeft}h left
                              </div>
                              <div className={plant.throttled ? 'text-[hsl(var(--warning))]' : 'text-[hsl(var(--success-strong))]'}>
                                {plant.throttled ? '⏸ Notified' : '✓ Would notify'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5" /> Base Campaigns</CardTitle>
            <CardDescription>Custom mass notifications to all enabled wallets or a selected wallet list.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                aria-label="Campaign title"
                value={baseCampaignTitle}
                onChange={(e) => { invalidateCampaignPreview(); setBaseCampaignTitle(e.target.value); }}
                placeholder="Title (max 30 characters)"
                maxLength={30}
              />
              <Input
                aria-label="Campaign destination path"
                value={baseCampaignTargetPath}
                onChange={(e) => { invalidateCampaignPreview(); setBaseCampaignTargetPath(e.target.value); }}
                placeholder="/rewards"
                maxLength={500}
              />
            </div>
            <Textarea
              aria-label="Campaign message"
              value={baseCampaignMessage}
              onChange={(e) => { invalidateCampaignPreview(); setBaseCampaignMessage(e.target.value); }}
              placeholder="Message (max 200 characters)"
              maxLength={200}
              rows={4}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant={baseCampaignAudienceMode === 'all' ? 'default' : 'outline'}
                size="sm"
                aria-pressed={baseCampaignAudienceMode === 'all'}
                onClick={() => { invalidateCampaignPreview(); setBaseCampaignAudienceMode('all'); }}
              >
                All Enabled Wallets
              </Button>
              <Button
                variant={baseCampaignAudienceMode === 'selected' ? 'default' : 'outline'}
                size="sm"
                aria-pressed={baseCampaignAudienceMode === 'selected'}
                onClick={() => { invalidateCampaignPreview(); setBaseCampaignAudienceMode('selected'); }}
              >
                Selected Wallets
              </Button>
            </div>
            {baseCampaignAudienceMode === 'selected' && (
              <Textarea
                aria-label="Campaign recipient wallets"
                value={baseCampaignAddressInput}
                onChange={(e) => { invalidateCampaignPreview(); setBaseCampaignAddressInput(e.target.value); }}
                placeholder="Paste wallet addresses separated by commas, spaces, or new lines"
                rows={5}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={previewBaseCampaign} disabled={baseCampaignLoading}>
                <Eye className="w-4 h-4 mr-2" />
                Preview
              </Button>
              <Button variant="outline" size="sm" onClick={() => sendBaseCampaign(true)} disabled={baseCampaignLoading || !baseCampaignPreview?.resolvedCount}>
                <Bell className="w-4 h-4 mr-2" />
                Save Dry Run
              </Button>
              <Button size="sm" onClick={() => sendBaseCampaign(false)} disabled={baseCampaignLoading || !baseCampaignPreview?.resolvedCount}>
                <Megaphone className="w-4 h-4 mr-2" />
                Send Campaign
              </Button>
            </div>
            <AdminReadError message={campaignError} onRetry={previewBaseCampaign} busy={baseCampaignLoading} />
            {!baseCampaignPreview && !campaignError && <p className="text-xs text-muted-foreground">Preview the current campaign to enable sending or saving a dry run.</p>}
            {baseCampaignPreview && (
              <div className="text-xs text-muted-foreground p-3 rounded border space-y-1">
                <div className="font-semibold text-foreground">Preview</div>
                <div>Requested: {baseCampaignPreview.requestedCount} • Resolved: {baseCampaignPreview.resolvedCount}</div>
                <div>Snapshot size: {baseCampaignPreview.snapshotCount ?? 'n/a'} • Snapshot matched: {baseCampaignPreview.snapshotMatchedCount ?? 'n/a'}</div>
                {(baseCampaignPreview.notes || []).length > 0 && (
                  <div>{(baseCampaignPreview.notes || []).join(' ')}</div>
                )}
              </div>
            )}
            {baseCampaignResult !== null && (
              <ScrollArea className="text-xs text-muted-foreground p-3 rounded border max-h-64 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{JSON.stringify(baseCampaignResult, null, 2)}</pre>
              </ScrollArea>
            )}
            <div className="space-y-2">
              <div className="font-semibold text-sm">Recent campaigns</div>
              <ScrollArea className="space-y-2 max-h-64 overflow-y-auto">
                {baseCampaigns.length === 0 ? (
                  <div className="border rounded p-2 text-sm text-muted-foreground">No campaigns yet.</div>
                ) : (
                  baseCampaigns.map((campaign) => (
                    <div key={campaign.id} className="border rounded p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold">{campaign.title}</div>
                        <div className="text-muted-foreground">{campaign.status}</div>
                      </div>
                      <div>{campaign.message}</div>
                      <div className="text-muted-foreground">
                        {campaign.audienceMode} • requested {campaign.requestedCount} • resolved {campaign.resolvedCount} • sent {campaign.sentCount} • failed {campaign.failedCount}
                      </div>
                      <div className="text-muted-foreground">{campaign.updatedAt ? new Date(campaign.updatedAt).toLocaleString() : ''}</div>
                    </div>
                  ))
                )}
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
      </>
    ) : (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Neynar Plant-Care Admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {eligibleFids && eligibleFids.length > 0 && (
            <div className="text-sm">
              <div className="font-semibold mb-1">Known eligible FIDs</div>
              <ScrollArea className="flex flex-wrap gap-1 max-h-[140px] overflow-y-auto">
                {eligibleFids.slice(0, 200).map((fid) => (
                  <span key={fid} className="text-xs bg-muted px-2 py-0.5 rounded">{fid}</span>
                ))}
              </ScrollArea>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filter by FID (optional)"
              aria-label="Filter by Farcaster ID"
              value={notifFidFilter}
              onChange={(e) => { invalidateEligibility(); setNotifFidFilter(e.target.value.replace(/\D/g, '')); }}
              className="w-40"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchEligiblePlants(notifFidFilter || undefined)}
              disabled={eligibleLoading}
            >
              <Search className={`w-4 h-4 mr-2 ${eligibleLoading ? 'animate-spin' : ''}`} />
              {eligibleLoading ? 'Loading...' : 'Check Eligible'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerNotifications(notifFidFilter || undefined, true)}
              disabled={triggerLoading}
            >
              <Eye className="w-4 h-4 mr-2" />
              Dry Run
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const fids = getEligibleFidsToNotify();
                if (fids.length === 0) {
                  toast.error('No eligible FIDs found. Click "Check Eligible" first.');
                  return;
                }
                setSendNotifProgress(null);
                setSendNotifDialogOpen(true);
              }}
              disabled={triggerLoading || eligibleLoading || !eligiblePlants}
            >
              <Bell className={`w-4 h-4 mr-2 ${triggerLoading ? 'animate-spin' : ''}`} />
              Send Notifications
            </Button>
          </div>

          <AdminReadError message={eligibleError} onRetry={() => fetchEligiblePlants(notifFidFilter || undefined)} busy={eligibleLoading} />
          {eligiblePlants?.provider === 'neynar' && (
            <div className="space-y-3">
              <div className="p-3 rounded border text-sm space-y-1">
                <div>
                  <span className="font-semibold">Summary:</span>{' '}
                  {eligiblePlants.summary?.fidsWithEligiblePlants || 0} FIDs with due plants,{' '}
                  <span className="text-[hsl(var(--warning))] font-semibold">{eligiblePlants.summary?.totalEligiblePlants || 0} total eligible plants</span>
                </div>
                <div className="text-muted-foreground">
                  Would notify now: <span className="font-semibold text-[hsl(var(--success-strong))]">{eligiblePlants.summary?.wouldNotify || 0}</span> •
                  Throttled users: <span className="font-semibold text-[hsl(var(--warning))]"> {eligiblePlants.summary?.throttledUsers || 0}</span>
                </div>
              </div>
              <ScrollArea className="space-y-2 max-h-[400px] overflow-y-auto">
                {(eligiblePlants.eligible || []).length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">No users with eligible plants found.</div>
                ) : (
                  (eligiblePlants.eligible || []).map((user) => (
                    <div key={user.fid} className={`p-3 border rounded space-y-2 ${user.userThrottled ? 'opacity-60 bg-[hsl(var(--warning)/0.1)]' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div className="font-mono text-sm flex items-center gap-2">
                          FID: <span className="font-semibold">{user.fid}</span>
                          {user.userThrottled && (
                            <span className="text-xs bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))] px-1.5 py-0.5 rounded">
                              THROTTLED
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{user.address}</div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {(user.plants || []).map((plant) => (
                          <div
                            key={plant.id}
                            className={`p-2 rounded text-xs ${plant.throttled ? 'bg-[hsl(var(--warning)/0.12)] border border-[hsl(var(--warning)/0.32)]' : 'bg-[hsl(var(--success)/0.1)] border border-[hsl(var(--success)/0.28)]'}`}
                          >
                            <div className="font-semibold">Plant #{plant.id}</div>
                            <div className={`${plant.throttled ? 'text-[hsl(var(--warning))]' : 'text-[hsl(var(--success-strong))]'} font-semibold`}>
                              {plant.hoursLeft}h left
                            </div>
                            <div className={plant.throttled ? 'text-[hsl(var(--warning))]' : 'text-[hsl(var(--success-strong))]'}>
                              {plant.throttled ? '⏸ Notified' : '✓ Would notify'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </ScrollArea>
            </div>
          )}

          <AdminReadError message={triggerError} onRetry={() => { setTriggerError(null); void fetchEligiblePlants(notifFidFilter || undefined); }} busy={eligibleLoading || triggerLoading} />
          {triggerResult !== null && (
            <div className="text-sm">
              <div className="font-semibold mb-1">Last Trigger Result</div>
              <ScrollArea className="p-2 rounded border text-xs text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto"><pre className="m-0 [white-space:inherit]">
                {JSON.stringify(triggerResult, null, 2)}
              </pre></ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    )}

    {/* Redis Keys Management Card */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code className="w-5 h-5" /> Redis Notification Keys
        </CardTitle>
        <CardDescription>View and manage notification-related Redis keys</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchNotifKeys}
            disabled={notifKeysLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${notifKeysLoading ? 'animate-spin' : ''}`} />
            {notifKeysLoading ? 'Loading...' : 'Load Keys'}
          </Button>
          {notifKeys && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                showConfirmDialog({
                  title: 'Delete All Legacy Keys',
                  description: 'This will delete all plant3h and plant1h legacy keys. Current plant12h keys will be preserved.',
                  confirmText: 'Delete Legacy Keys',
                  onConfirm: async () => {
                    await deleteNotifKeysByPattern('notif:plant3h:*');
                    await deleteNotifKeysByPattern('notif:plant1h:*');
                  },
                  isDangerous: true,
                });
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clean Legacy Keys
            </Button>
          )}
        </div>

        <AdminReadError message={keysError} onRetry={fetchNotifKeys} busy={notifKeysLoading} />
        {notifKeys && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Found <span className="font-semibold text-foreground">{notifKeys.totalKeys}</span> keys
              {notifKeys.totalKeys > notifKeys.returnedKeys && ` (showing ${notifKeys.returnedKeys})`}
            </div>

            {/* Grouped Keys */}
            {Object.entries(notifKeys.grouped).map(([prefix, keys]) => (
              <div key={prefix} className="border rounded-lg overflow-hidden">
                <button
                  className="flex min-h-11 w-full items-center justify-between bg-muted/50 px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => setNotifKeysExpanded(prev => ({ ...prev, [prefix]: !prev[prefix] }))}
                >
                  <span>{prefix} ({keys.length} keys)</span>
                  <span className="text-xs text-muted-foreground">{notifKeysExpanded[prefix] ? '▼' : '▶'}</span>
                </button>
                {notifKeysExpanded[prefix] && (
                  <ScrollArea className="divide-y divide-border/55 max-h-[300px] overflow-y-auto">
                    {keys.map((keyInfo) => (
                      <div key={keyInfo.key} className="p-2 text-xs hover:bg-muted/30 flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[10px] truncate" title={keyInfo.key}>{keyInfo.key}</div>
                          <div className="text-muted-foreground mt-1">
                            <span className="bg-muted px-1 rounded mr-2">{keyInfo.type}</span>
                            {keyInfo.ttl && keyInfo.ttl > 0 && <span>TTL: {Math.floor(keyInfo.ttl / 60)}m</span>}
                            {keyInfo.ttl === -1 && <span className="text-[hsl(var(--warning))]">No expiry</span>}
                          </div>
                          {keyInfo.value !== null && (
                            <ScrollArea className="mt-1 p-1 bg-muted/50 rounded text-[10px] max-h-20 overflow-auto whitespace-pre-wrap"><pre className="m-0 [white-space:inherit]">
                              {JSON.stringify(keyInfo.value, null, 1)}
                            </pre></ScrollArea>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 w-11 p-0 text-destructive hover:text-destructive"
                          aria-label={`Delete notification key ${keyInfo.key}`}
                          onClick={() => {
                            showConfirmDialog({
                              title: 'Delete Key',
                              description: `Delete key: ${keyInfo.key}?`,
                              confirmText: 'Delete',
                              onConfirm: () => deleteNotifKey(keyInfo.key),
                              isDangerous: true,
                            });
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </ScrollArea>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  </div>
    <Dialog open={sendNotifDialogOpen} onOpenChange={(open) => !triggerLoading && setSendNotifDialogOpen(open)}>
      <DialogContent size="md" layout="form">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Send Notifications
          </DialogTitle>
          <DialogDescription>
            The following FIDs have eligible plants (not throttled) and will receive notifications:
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <div className="border rounded p-2 space-y-1">
            {getEligibleFidsToNotify().map((fid) => {
              const user = eligiblePlants?.provider === 'neynar' ? eligiblePlants.eligible.find(u => u.fid === fid) : undefined;
              return (
                <div key={fid} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                  <div className="font-mono">FID: <span className="font-semibold">{fid}</span></div>
                  <div className="text-xs text-muted-foreground">
                    {user?.plants?.length || 0} plant{(user?.plants?.length || 0) !== 1 ? 's' : ''}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-sm text-muted-foreground text-center">
            Total: <span className="font-semibold text-foreground">{getEligibleFidsToNotify().length}</span> users will receive notifications
          </div>

          {sendNotifProgress && (
            <div className="space-y-2 p-3 bg-muted/50 rounded">
              <div className="text-sm">
                Progress: <span className="font-semibold">{sendNotifProgress.sent}/{sendNotifProgress.total}</span>
              </div>
              <ProgressBar
                label="Notifications sent"
                value={sendNotifProgress.total > 0 ? (sendNotifProgress.sent / sendNotifProgress.total) * 100 : 0}
                className="h-2 border-0 bg-muted shadow-none [&>div]:bg-primary [&>div]:bg-none [&>div]:shadow-none"
              />
              {sendNotifProgress.errors.length > 0 && (
                <div className="text-xs text-destructive">
                  Errors: {sendNotifProgress.errors.length}
                </div>
              )}
            </div>
          )}

        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setSendNotifDialogOpen(false)}
            disabled={triggerLoading}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={sendToEligibleFids}
            disabled={triggerLoading || getEligibleFidsToNotify().length === 0}
          >
            {triggerLoading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Bell className="w-4 h-4 mr-2" />
                Send to {getEligibleFidsToNotify().length} Users
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog></>);
}
