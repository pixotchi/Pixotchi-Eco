'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { BroadcastMessage } from '@/lib/broadcast-service';
import { AlertTriangle, Clock, Edit2, Eye, Megaphone, Plus, Trash2, X as XIcon } from 'lucide-react';
import { useState } from 'react';
import { useAdminRead } from '@/hooks/useAdminRead';
import { parseAdminBroadcast, parseAdminOperation, adminApiError } from '@/lib/admin-api-data';
import { toast } from 'react-hot-toast';
import { type AdminSectionProps, AdminReadError } from './admin-section-shared';

export function AdminBroadcastSection({ adminKey, isActive }: Pick<AdminSectionProps, 'adminKey' | 'isActive'>) {
  const { data, loading: readLoading, error: readError, reload: fetchBroadcastMessages } = useAdminRead({ adminKey, isActive, endpoint: '/api/admin/broadcast', parse: parseAdminBroadcast, label: 'Broadcast' });
  const broadcastMessages = data?.messages ?? [];
  const broadcastStats = data?.stats ?? null;
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastContent, setBroadcastContent] = useState('');
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastExpiresIn, setBroadcastExpiresIn] = useState('86400');
  const [broadcastPriority, setBroadcastPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [broadcastType, setBroadcastType] = useState<'info' | 'warning' | 'success' | 'announcement'>('info');
  const [broadcastDismissible, setBroadcastDismissible] = useState(true);
  const [broadcastActionLabel, setBroadcastActionLabel] = useState('');
  const [broadcastActionUrl, setBroadcastActionUrl] = useState('');
  const [editingBroadcastId, setEditingBroadcastId] = useState<string | null>(null);
  const [broadcastNeverExpires, setBroadcastNeverExpires] = useState(false);
  const [customExpiry, setCustomExpiry] = useState('');

  const handleBroadcastCreate = async () => {
    if (!broadcastContent.trim()) {
      toast.error('Content is required');
      return;
    }
    setBroadcastLoading(true);
    try {
      const payload: Pick<BroadcastMessage, 'content' | 'priority' | 'type' | 'dismissible'> & { id?: string; title?: string; expiresIn?: number | null; action?: BroadcastMessage['action'] } = {
        content: broadcastContent,
        priority: broadcastPriority,
        type: broadcastType,
        dismissible: broadcastDismissible,
      };
      if (!broadcastNeverExpires) {
        if (broadcastExpiresIn === 'custom') {
          const customVal = parseInt(customExpiry, 10);
          if (Number.isNaN(customVal) || customVal <= 0) {
            toast.error('Enter a valid custom expiry in seconds');
            setBroadcastLoading(false);
            return;
          }
          payload.expiresIn = customVal;
        } else {
          payload.expiresIn = parseInt(broadcastExpiresIn, 10);
        }
      } else {
        payload.expiresIn = null;
      }
      if (broadcastTitle.trim()) payload.title = broadcastTitle.trim();
      if (broadcastActionLabel.trim() && broadcastActionUrl.trim()) {
        payload.action = { label: broadcastActionLabel.trim(), url: broadcastActionUrl.trim() };
      }
      const method = editingBroadcastId ? 'PUT' : 'POST';
      if (editingBroadcastId) payload.id = editingBroadcastId;

      const response = await fetch('/api/admin/broadcast', {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminKey}`
        },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        toast.success(editingBroadcastId ? 'Broadcast updated!' : 'Broadcast created!');
        resetBroadcastForm();
        fetchBroadcastMessages();
      } else {
        const data: unknown = await response.json();
        toast.error(adminApiError(data, 'Failed to save broadcast'));
      }
    } catch {
      toast.error('Error saving broadcast');
    } finally {
      setBroadcastLoading(false);
    }
  };

  const handleBroadcastEdit = (message: BroadcastMessage) => {
    setEditingBroadcastId(message.id);
    setBroadcastContent(message.content);
    setBroadcastTitle(message.title || '');
    setBroadcastPriority(message.priority);
    setBroadcastType(message.type);
    setBroadcastDismissible(message.dismissible);
    setBroadcastActionLabel(message.action?.label || '');
    setBroadcastActionUrl(message.action?.url || '');
    if (message.expiresAt) {
      const remaining = Math.max(0, Math.floor((message.expiresAt - Date.now()) / 1000));
      setBroadcastNeverExpires(false);
      if ([3600, 21600, 43200, 86400, 259200, 604800, 2592000].includes(remaining)) {
        setBroadcastExpiresIn(remaining.toString());
        setCustomExpiry('');
      } else {
        setBroadcastExpiresIn('custom');
        setCustomExpiry(remaining.toString());
      }
      setBroadcastNeverExpires(false);
    } else {
      setBroadcastNeverExpires(true);
      setBroadcastExpiresIn('86400');
      setCustomExpiry('');
    }
  };

  const handleBroadcastDelete = async (id: string) => {
    if (!confirm('Delete this broadcast?')) return;
    try {
      const response = await fetch(`/api/admin/broadcast?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminKey}` }
      });
      if (response.ok) {
        toast.success('Broadcast deleted');
        fetchBroadcastMessages();
      } else {
        toast.error('Failed to delete broadcast');
      }
    } catch {
      toast.error('Error deleting broadcast');
    }
  };

  const resetBroadcastForm = () => {
    setEditingBroadcastId(null);
    setBroadcastContent('');
    setBroadcastTitle('');
    setBroadcastPriority('normal');
    setBroadcastType('info');
    setBroadcastDismissible(true);
    setBroadcastActionLabel('');
    setBroadcastActionUrl('');
    setBroadcastExpiresIn('86400');
    setBroadcastNeverExpires(false);
    setCustomExpiry('');
  };

  const handleCleanupOrphans = async () => {
    if (!confirm('Clean up orphaned dismissal records? This will remove dismissal records for deleted messages.')) return;
    try {
      const response = await fetch('/api/admin/broadcast/cleanup', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminKey}` }
      });
      const data = parseAdminOperation(await response.json());
      if (!data) throw new Error('Response could not be read. Reload to check the result.');
      if (response.ok && data.cleaned !== undefined) {
        toast.success(`Cleaned up ${data.cleaned} orphaned records`);
        fetchBroadcastMessages();
      } else {
        toast.error(data.error || 'Cleanup failed');
      }
    } catch {
      toast.error('Error during cleanup');
    }
  };

  const handleNukeAllBroadcasts = async () => {
    const confirmed = confirm(
      '⚠️ DANGER: This will delete ALL broadcast data including messages, stats, and user dismissals.\n\n' +
      'This action CANNOT be undone!\n\n' +
      'Type "DELETE ALL" in the next prompt to confirm.'
    );
    if (!confirmed) return;

    const verification = prompt('Type "DELETE ALL" to confirm (case-sensitive):');
    if (verification !== 'DELETE ALL') {
      toast.error('Verification failed. Operation cancelled.');
      return;
    }

    try {
      const response = await fetch('/api/admin/broadcast/cleanup?confirm=true', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminKey}` }
      });
      const data = parseAdminOperation(await response.json());
      if (!data) throw new Error('Response could not be read. Reload to check the result.');
      if (response.ok && data.deletedKeys !== undefined) {
        toast.success(`🧹 Deleted ${data.deletedKeys} keys`);
        fetchBroadcastMessages();
      } else {
        toast.error(data.error || 'Nuke operation failed');
      }
    } catch {
      toast.error('Error during nuke operation');
    }
  };

  if (!isActive) return null;
  return (<div className="space-y-6">
    <AdminReadError message={readError} onRetry={fetchBroadcastMessages} busy={readLoading} />
    {/* Stats Cards */}
    {broadcastStats && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Messages</p>
                <p className="text-2xl font-bold">{broadcastStats.totalMessages}</p>
              </div>
              <Megaphone className="w-8 h-8 text-violet-700 dark:text-violet-200 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Impressions</p>
                <p className="text-2xl font-bold">{broadcastStats.totalImpressions}</p>
              </div>
              <Eye className="w-8 h-8 text-[hsl(var(--info))] opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Dismissals</p>
                <p className="text-2xl font-bold">{broadcastStats.totalDismissals}</p>
              </div>
              <XIcon className="w-8 h-8 text-[hsl(var(--warning))] opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>
    )}

    {/* Cleanup Tools */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="w-5 h-5" />
          Data Cleanup Tools
        </CardTitle>
        <CardDescription>
          Manage and clean up broadcast data in Redis
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCleanupOrphans}
            className="flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clean Orphaned Records
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleNukeAllBroadcasts}
            className="flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4" />
            Delete All Broadcast Data
          </Button>
        </div>
        <Alert>
          <AlertDescription className="text-xs">
            <strong>Clean Orphaned Records:</strong> Removes dismissal records for messages that no longer exist (safe operation).<br />
            <strong>Delete All:</strong> ⚠️ Permanently deletes ALL broadcasts, stats, and user dismissals. Cannot be undone!
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    {/* Create/Edit Form */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {editingBroadcastId ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {editingBroadcastId ? 'Edit Broadcast' : 'Create New Broadcast'}
        </CardTitle>
        <CardDescription>
          {editingBroadcastId ? 'Update the broadcast message' : 'Send a message to all players'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label htmlFor="broadcast-title" className="text-sm font-medium block mb-2">Title (Optional)</label>
          <Input
            id="broadcast-title"
            value={broadcastTitle}
            onChange={(e) => setBroadcastTitle(e.target.value)}
            placeholder="e.g., Giveaway Alert, System Update"
            maxLength={60}
          />
          <p className="text-xs text-muted-foreground mt-1">{broadcastTitle.length}/60 characters</p>
        </div>

        <div>
          <label htmlFor="broadcast-content" className="text-sm font-medium block mb-2">Message Content *</label>
          <Textarea
            id="broadcast-content"
            required
            aria-describedby="broadcast-content-count"
            value={broadcastContent}
            onChange={(e) => setBroadcastContent(e.target.value)}
            placeholder="Your message to players..."
            rows={4}
            maxLength={500}
            className="resize-none"
          />
          <p id="broadcast-content-count" className="text-xs text-muted-foreground mt-1">{broadcastContent.length}/500 characters</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p id="broadcast-type-label" className="text-sm font-medium block mb-2">Type</p>
            <div role="group" aria-labelledby="broadcast-type-label" className="grid grid-cols-2 gap-2">
              {[
                { value: 'info', label: 'Info', icon: '💡' },
                { value: 'announcement', label: 'Announcement', icon: '📢' },
                { value: 'success', label: 'Success', icon: '✅' },
                { value: 'warning', label: 'Warning', icon: '⚠️' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={broadcastType === option.value}
                  onClick={() => setBroadcastType(option.value as BroadcastMessage['type'])}
                  className={`min-h-11 rounded-[var(--radius-control)] border-2 p-3 transition-[background-color,border-color,color] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${broadcastType === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                    }`}
                >
                  <div className="text-2xl mb-1">{option.icon}</div>
                  <div className="text-xs font-medium">{option.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p id="broadcast-priority-label" className="text-sm font-medium block mb-2">Priority</p>
            <div role="group" aria-labelledby="broadcast-priority-label" className="space-y-2">
              {[
                { value: 'low', label: 'Low', color: 'text-muted-foreground' },
                { value: 'normal', label: 'Normal', color: 'text-[hsl(var(--info))]' },
                { value: 'high', label: 'High', color: 'text-destructive' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={broadcastPriority === option.value}
                  onClick={() => setBroadcastPriority(option.value as BroadcastMessage['priority'])}
                  className={`min-h-11 w-full rounded-[var(--radius-control)] border-2 p-3 text-left transition-[background-color,border-color,color] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${broadcastPriority === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                    }`}
                >
                  <div className={`text-sm font-medium ${option.color}`}>{option.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <p id="broadcast-expiry-label" className="text-sm font-medium block mb-2">Expires In</p>
          <div role="group" aria-labelledby="broadcast-expiry-label" className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { value: '3600', label: '1 hour' },
              { value: '21600', label: '6 hours' },
              { value: '43200', label: '12 hours' },
              { value: '86400', label: '24 hours' },
              { value: '259200', label: '3 days' },
              { value: '604800', label: '7 days' },
              { value: '2592000', label: '30 days' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setBroadcastNeverExpires(false);
                  setBroadcastExpiresIn(option.value);
                  setCustomExpiry('');
                }}
                aria-pressed={!broadcastNeverExpires && broadcastExpiresIn === option.value}
                className={`min-h-11 rounded-[var(--radius-control)] border px-3 py-2 text-sm transition-[background-color,border-color,color] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${!broadcastNeverExpires && broadcastExpiresIn === option.value
                  ? 'border-primary bg-primary/10 font-medium'
                  : 'border-border hover:border-primary/50'
                  }`}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setBroadcastNeverExpires(false);
                setBroadcastExpiresIn('custom');
              }}
              aria-pressed={!broadcastNeverExpires && broadcastExpiresIn === 'custom'}
              className={`min-h-11 rounded-[var(--radius-control)] border px-3 py-2 text-sm transition-[background-color,border-color,color] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${!broadcastNeverExpires && broadcastExpiresIn === 'custom'
                ? 'border-primary bg-primary/10 font-medium'
                : 'border-border hover:border-primary/50'
                }`}
            >
              Custom…
            </button>
            <button
              type="button"
              aria-pressed={broadcastNeverExpires}
              onClick={() => setBroadcastNeverExpires(true)}
              className={`min-h-11 rounded-[var(--radius-control)] border px-3 py-2 text-sm transition-[background-color,border-color,color] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${broadcastNeverExpires
                ? 'border-primary bg-primary/10 font-medium'
                : 'border-border hover:border-primary/50'
                }`}
            >
              No expiry
            </button>
          </div>
          {broadcastNeverExpires ? (
            <p className="text-xs text-muted-foreground mt-2">This broadcast will remain active until deleted.</p>
          ) : broadcastExpiresIn === 'custom' ? (
            <div className="mt-2 space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="custom-expiry">Custom expiry (seconds)</label>
              <Input
                id="custom-expiry"
                type="number"
                min={1}
                value={customExpiry}
                onChange={(e) => setCustomExpiry(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Enter number of seconds"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">Selected expiry: {broadcastExpiresIn} seconds.</p>
          )}
        </div>

        <div>
          <p className="text-sm font-medium block mb-2">Call-to-Action (Optional)</p>
          <div className="space-y-2">
            <Input
              aria-label="Call-to-action button label"
              value={broadcastActionLabel}
              onChange={(e) => setBroadcastActionLabel(e.target.value)}
              placeholder="Button label (e.g., Learn More, Join Now)"
              maxLength={30}
            />
            <Input
              aria-label="Call-to-action URL"
              value={broadcastActionUrl}
              onChange={(e) => setBroadcastActionUrl(e.target.value)}
              placeholder="URL (e.g., https://pixotchi.tech/event)"
              type="url"
            />
          </div>
        </div>

        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div>
            <div className="text-sm font-medium">Allow Dismissal</div>
            <div className="text-xs text-muted-foreground">Can users close this message?</div>
          </div>
          <button
            type="button"
            onClick={() => setBroadcastDismissible(!broadcastDismissible)}
            aria-pressed={broadcastDismissible}
            aria-label="Toggle broadcast dismissal"
            className={`relative inline-flex h-11 w-16 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${broadcastDismissible ? 'bg-primary' : 'bg-gray-300'
              }`}
          >
            <span
              className={`inline-block h-7 w-7 transform rounded-full bg-white shadow-sm transition-transform ${broadcastDismissible ? 'translate-x-8' : 'translate-x-1'
                }`}
            />
          </button>
        </div>

        {!broadcastDismissible && (
          <Alert variant="warning">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription className="text-sm">
              Non-dismissible messages will persist until manually deleted or expired.
              Use carefully for critical announcements only.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3 pt-4">
          <Button
            onClick={handleBroadcastCreate}
            disabled={broadcastLoading || !broadcastContent.trim()}
            className="flex-1"
          >
            {broadcastLoading ? 'Saving...' : editingBroadcastId ? 'Update Broadcast' : 'Create Broadcast'}
          </Button>
          {editingBroadcastId && (
            <Button onClick={resetBroadcastForm} variant="outline">Cancel Edit</Button>
          )}
        </div>
      </CardContent>
    </Card>

    {/* Active Messages List */}
    <Card>
      <CardHeader>
        <CardTitle>Active Broadcasts ({broadcastMessages.length})</CardTitle>
        <CardDescription>Currently visible messages to players</CardDescription>
      </CardHeader>
      <CardContent>
        {broadcastMessages.length === 0 ? (
          <div className="text-center py-12">
            <Megaphone className="w-12 h-12 mx-auto text-muted-foreground opacity-50 mb-4" />
            <p className="text-muted-foreground">No active broadcasts</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first message above</p>
          </div>
        ) : (
          <div className="space-y-3">
            {broadcastMessages.map((msg) => (
              <div
                key={msg.id}
                className="border rounded-lg p-4 space-y-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{msg.title || 'Untitled Message'}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${msg.priority === 'high' ? 'bg-destructive/10 text-destructive' :
                        msg.priority === 'normal' ? 'bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))]' :
                          'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        }`}>
                        {msg.priority}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-200">
                        {msg.type}
                      </span>
                      {!msg.dismissible && (
                        <span className="text-xs px-2 py-0.5 rounded bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))]">
                          Non-dismissible
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 w-11 p-0"
                      aria-label={`Edit broadcast: ${msg.title}`}
                      onClick={() => handleBroadcastEdit(msg)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 w-11 p-0"
                      aria-label={`Delete broadcast: ${msg.title}`}
                      onClick={() => handleBroadcastDelete(msg.id)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-2 border-t">
                  <div className="flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    {msg.stats.impressions} views
                  </div>
                  <div className="flex items-center gap-1">
                    <XIcon className="w-3 h-3" />
                    {msg.stats.dismissals} dismissed
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Created {new Date(msg.createdAt).toLocaleString()}
                  </div>
                  {msg.expiresAt && (
                    <div className="flex items-center gap-1 text-[hsl(var(--warning))]">
                      <Clock className="w-3 h-3" />
                      Expires {new Date(msg.expiresAt).toLocaleString()}
                    </div>
                  )}
                </div>
                {msg.action && (
                  <div className="text-xs bg-[hsl(var(--info)/0.1)] p-2 rounded border border-[hsl(var(--info)/0.22)]">
                    <span className="font-medium">Action:</span> {msg.action.label} → {msg.action.url}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  </div>);
}
