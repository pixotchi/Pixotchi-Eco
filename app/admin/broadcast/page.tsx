"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'react-hot-toast';
import { 
  Megaphone, 
  Plus, 
  Trash2, 
  Edit2, 
  Eye, 
  X as XIcon, 
  Users, 
  TrendingUp,
  Clock,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import type { BroadcastMessage } from '@/lib/broadcast-service';

const ADMIN_KEY_STORAGE = 'admin-key';

export default function BroadcastAdminPage() {
  // Form state
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [expiresIn, setExpiresIn] = useState('86400'); // 24 hours default
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [type, setType] = useState<'info' | 'warning' | 'success' | 'announcement'>('info');
  const [targeting, setTargeting] = useState<'current' | 'all'>('all');
  const [dismissible, setDismissible] = useState(true);
  const [actionLabel, setActionLabel] = useState('');
  const [actionUrl, setActionUrl] = useState('');

  // List state
  const [messages, setMessages] = useState<BroadcastMessage[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const getAdminKey = () => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(ADMIN_KEY_STORAGE) || '';
  };

  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/broadcast', {
        headers: { 'Authorization': `Bearer ${getAdminKey()}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
        setStats(data.stats || null);
      } else if (response.status === 401) {
        toast.error('Unauthorized - check admin key');
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      toast.error('Failed to fetch messages');
    }
  }, []);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const handleCreate = async () => {
    if (!content.trim()) {
      toast.error('Content is required');
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        content,
        priority,
        type,
        targeting,
        dismissible,
        expiresIn: parseInt(expiresIn),
      };

      if (title.trim()) payload.title = title.trim();
      if (actionLabel.trim() && actionUrl.trim()) {
        payload.action = { label: actionLabel.trim(), url: actionUrl.trim() };
      }

      const url = editingId 
        ? '/api/admin/broadcast'
        : '/api/admin/broadcast';
      
      const method = editingId ? 'PUT' : 'POST';
      
      if (editingId) {
        payload.id = editingId;
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAdminKey()}`
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast.success(editingId ? 'Broadcast updated!' : 'Broadcast created!');
        resetForm();
        fetchMessages();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to save broadcast');
      }
    } catch (error) {
      console.error('Error saving broadcast:', error);
      toast.error('Error saving broadcast');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (message: BroadcastMessage) => {
    setEditingId(message.id);
    setContent(message.content);
    setTitle(message.title || '');
    setPriority(message.priority);
    setType(message.type);
    setTargeting(message.targeting);
    setDismissible(message.dismissible);
    setActionLabel(message.action?.label || '');
    setActionUrl(message.action?.url || '');
    
    // Calculate remaining time for expiry
    if (message.expiresAt) {
      const remaining = Math.max(0, Math.floor((message.expiresAt - Date.now()) / 1000));
      setExpiresIn(remaining.toString());
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this broadcast?')) return;

    try {
      const response = await fetch(`/api/admin/broadcast?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getAdminKey()}` }
      });

      if (response.ok) {
        toast.success('Broadcast deleted');
        fetchMessages();
      } else {
        toast.error('Failed to delete broadcast');
      }
    } catch (error) {
      console.error('Error deleting broadcast:', error);
      toast.error('Error deleting broadcast');
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setContent('');
    setTitle('');
    setPriority('normal');
    setType('info');
    setTargeting('all');
    setDismissible(true);
    setActionLabel('');
    setActionUrl('');
    setExpiresIn('86400');
  };

  const typeOptions = [
    { value: 'info', label: 'Info', icon: '💡' },
    { value: 'announcement', label: 'Announcement', icon: '📢' },
    { value: 'success', label: 'Success', icon: '✅' },
    { value: 'warning', label: 'Warning', icon: '⚠️' },
  ];

  const priorityOptions = [
    { value: 'low', label: 'Low', color: 'text-gray-600' },
    { value: 'normal', label: 'Normal', color: 'text-blue-600' },
    { value: 'high', label: 'High', color: 'text-red-600' },
  ];

  const expiryOptions = [
    { value: '3600', label: '1 hour' },
    { value: '21600', label: '6 hours' },
    { value: '43200', label: '12 hours' },
    { value: '86400', label: '24 hours' },
    { value: '259200', label: '3 days' },
    { value: '604800', label: '7 days' },
    { value: '2592000', label: '30 days' },
  ];

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Megaphone className="w-8 h-8" />
            Broadcast Messages
          </h1>
          <p className="text-muted-foreground mt-1">
            Send alerts and announcements to players
          </p>
        </div>
        <Button onClick={fetchMessages} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Messages</p>
                  <p className="text-2xl font-bold">{stats.totalMessages}</p>
                </div>
                <Megaphone className="w-8 h-8 text-purple-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Impressions</p>
                  <p className="text-2xl font-bold">{stats.totalImpressions}</p>
                </div>
                <Eye className="w-8 h-8 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Dismissals</p>
                  <p className="text-2xl font-bold">{stats.totalDismissals}</p>
                </div>
                <XIcon className="w-8 h-8 text-orange-500 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Registered Users</p>
                  <p className="text-2xl font-bold">{stats.registeredUsers}</p>
                </div>
                <Users className="w-8 h-8 text-green-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create/Edit Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {editingId ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            {editingId ? 'Edit Broadcast' : 'Create New Broadcast'}
          </CardTitle>
          <CardDescription>
            {editingId ? 'Update the broadcast message' : 'Send a message to all players'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-sm font-medium block mb-2">
              Title (Optional)
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Giveaway Alert, System Update"
              maxLength={60}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {title.length}/60 characters
            </p>
          </div>

          {/* Content */}
          <div>
            <label className="text-sm font-medium block mb-2">
              Message Content *
            </label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Your message to players..."
              rows={4}
              maxLength={500}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {content.length}/500 characters
            </p>
          </div>

          {/* Type and Priority Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Type */}
            <div>
              <label className="text-sm font-medium block mb-2">Type</label>
              <div className="grid grid-cols-2 gap-2">
                {typeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setType(option.value as any)}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      type === option.value
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

            {/* Priority */}
            <div>
              <label className="text-sm font-medium block mb-2">Priority</label>
              <div className="space-y-2">
                {priorityOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPriority(option.value as any)}
                    className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                      priority === option.value
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className={`text-sm font-medium ${option.color}`}>
                      {option.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Targeting */}
          <div>
            <label className="text-sm font-medium block mb-2">
              Show To
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setTargeting('all')}
                className={`p-4 rounded-lg border-2 transition-all ${
                  targeting === 'all'
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <Users className="w-5 h-5 mb-2 mx-auto" />
                <div className="text-sm font-medium">All Users</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Current + New visitors
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTargeting('current')}
                className={`p-4 rounded-lg border-2 transition-all ${
                  targeting === 'current'
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <Users className="w-5 h-5 mb-2 mx-auto" />
                <div className="text-sm font-medium">Current Users Only</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Registered wallets only
                </div>
              </button>
            </div>
          </div>

          {/* Expiry */}
          <div>
            <label className="text-sm font-medium block mb-2">
              Expires In
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {expiryOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setExpiresIn(option.value)}
                  className={`p-2 rounded-lg border transition-all text-sm ${
                    expiresIn === option.value
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Action Button (Optional) */}
          <div>
            <label className="text-sm font-medium block mb-2">
              Call-to-Action (Optional)
            </label>
            <div className="space-y-2">
              <Input
                value={actionLabel}
                onChange={(e) => setActionLabel(e.target.value)}
                placeholder="Button label (e.g., Learn More, Join Now)"
                maxLength={30}
              />
              <Input
                value={actionUrl}
                onChange={(e) => setActionUrl(e.target.value)}
                placeholder="URL (e.g., https://pixotchi.tech/event)"
                type="url"
              />
            </div>
          </div>

          {/* Dismissible Toggle */}
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div>
              <div className="text-sm font-medium">Allow Dismissal</div>
              <div className="text-xs text-muted-foreground">
                Can users close this message?
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDismissible(!dismissible)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                dismissible ? 'bg-primary' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  dismissible ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Warning for non-dismissible messages */}
          {!dismissible && (
            <Alert className="bg-orange-500/10 border-orange-500/20">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <AlertDescription className="text-sm">
                Non-dismissible messages will persist until manually deleted or expired.
                Use carefully for critical announcements only.
              </AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              onClick={handleCreate}
              disabled={loading || !content.trim()}
              className="flex-1"
            >
              {loading ? 'Saving...' : editingId ? 'Update Broadcast' : 'Create Broadcast'}
            </Button>
            {editingId && (
              <Button onClick={resetForm} variant="outline">
                Cancel Edit
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Messages List */}
      <Card>
        <CardHeader>
          <CardTitle>Active Broadcasts ({messages.length})</CardTitle>
          <CardDescription>
            Currently visible messages to players
          </CardDescription>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <Megaphone className="w-12 h-12 mx-auto text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground">No active broadcasts</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create your first message above
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="border rounded-lg p-4 space-y-3 hover:bg-muted/50 transition-colors"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">
                          {msg.title || 'Untitled Message'}
                        </h3>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          msg.priority === 'high' ? 'bg-red-100 text-red-700' :
                          msg.priority === 'normal' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {msg.priority}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">
                          {msg.type}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                          {msg.targeting === 'all' ? 'All Users' : 'Current Only'}
                        </span>
                        {!msg.dismissible && (
                          <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700">
                            Non-dismissible
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(msg)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(msg.id)}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  </div>

                  {/* Stats and Metadata */}
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
                      <div className="flex items-center gap-1 text-orange-600">
                        <Clock className="w-3 h-3" />
                        Expires {new Date(msg.expiresAt).toLocaleString()}
                      </div>
                    )}
                  </div>

                  {/* Action Link */}
                  {msg.action && (
                    <div className="text-xs bg-blue-50 dark:bg-blue-950/30 p-2 rounded border border-blue-200 dark:border-blue-800">
                      <span className="font-medium">Action:</span> {msg.action.label} → {msg.action.url}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

