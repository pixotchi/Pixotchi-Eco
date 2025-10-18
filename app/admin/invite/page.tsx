'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Shield, 
  Users, 
  Code, 
  Trash2, 
  Plus, 
  BarChart3, 
  Download,
  RefreshCw,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  Clock,
  UserX,
  MessageCircle,
  Bot,
  Search,
  FileText,
  TrendingUp,
  DollarSign,
  Bell,
  Megaphone,
  Edit2,
  X as XIcon
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminChatMessage, ChatStats, AIConversation, AIChatMessage, AIUsageStats } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { ThemeSelector } from '@/components/theme-selector';
import type { BroadcastMessage } from '@/lib/broadcast-service';
import { Activity, useEffectEvent } from 'react';

interface AdminStats {
  codes: {
    total: number;
    used: number;
    active: number;
    expired: number;
    byDate: Record<string, number>;
  };
  users: {
    totalUsers: number;
    validatedUsers: number;
    topGenerators: Array<{
      address: string;
      generated: number;
      used: number;
    }>;
  };
  recentCodes: Array<{
    code: string;
    createdAt: number;
    isUsed: boolean;
    createdBy: string;
    usedBy?: string;
  }>;
}

type AdminTab = 'overview' | 'codes' | 'users' | 'cleanup' | 'chat' | 'ai-chat' | 'gamification' | 'rpc' | 'notifications' | 'broadcast' | 'og-images';

interface ConfirmDialogState {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  onConfirm: () => void;
  isDangerous?: boolean;
  requiresTextConfirmation?: boolean;
  textToMatch?: string;
}

interface PlantNotificationStats {
  sentCount: number;
  lastPerFid: Record<string, string>;
  recent: any[];
  lastRun?: any;
}

interface GlobalNotificationStats {
  sentCount: number;
  lastPerFid: Record<string, string>;
  recent: any[];
}

interface FenceStats {
  warn: {
    sentCount: number;
    lastPerFid: Record<string, string>;
    recent: any[];
  };
  expire: {
    sentCount: number;
    lastPerFid: Record<string, string>;
    recent: any[];
  };
  lastRun: any;
  runs: any[];
}

interface AdminStatsResponse {
  success: boolean;
  stats: {
    plant1h: PlantNotificationStats;
    fence: FenceStats;
    global: GlobalNotificationStats;
    eligibleFids: string[];
  };
}

// Loading spinner component for consistency
const LoadingSpinner = ({ text }: { text?: string }) => (
  <div className="text-center py-8">
    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    {text && <p className="mt-2 text-muted-foreground">{text}</p>}
  </div>
);

export default function AdminInviteDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  
  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    description: '',
    confirmText: 'Confirm',
    onConfirm: () => {},
  });
  const [confirmationInput, setConfirmationInput] = useState('');
  
  // AbortController for canceling requests on tab switch or unmount
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<AdminChatMessage[]>([]);
  const [chatStats, setChatStats] = useState<ChatStats | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

  // AI Chat state
  const [aiConversations, setAIConversations] = useState<AIConversation[]>([]);
  const [aiStats, setAIStats] = useState<AIUsageStats | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<AIChatMessage[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [aiChatLoading, setAIChatLoading] = useState(false);
  // Gamification leaderboards
  const [gmLb, setGmLb] = useState<{ streakTop: Array<{ address: string; value: number }>; missionTop: Array<{ address: string; value: number }> } | null>(null);

  // Broadcast state
  const [broadcastMessages, setBroadcastMessages] = useState<BroadcastMessage[]>([]);
  const [broadcastStats, setBroadcastStats] = useState<any>(null);
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

  // OG Image test state
  const [ogAddress, setOgAddress] = useState('vitalik.eth');
  const [ogSelectedStrain, setOgSelectedStrain] = useState(1);
  const [ogRefreshKey, setOgRefreshKey] = useState(0);
  const [ogShortUrl, setOgShortUrl] = useState('');
  const [ogIsGenerating, setOgIsGenerating] = useState(false);

  const ogStrains = [
    { id: 1, name: 'Flora' },
    { id: 2, name: 'Taki' },
    { id: 3, name: 'Rosa' },
    { id: 4, name: 'Zest' },
    { id: 5, name: 'TYJ' },
  ];

  // Cleanup: abort pending requests on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Helper to show confirmation dialog
  const showConfirmDialog = useCallback((config: Omit<ConfirmDialogState, 'open'>) => {
    setConfirmDialog({ ...config, open: true });
    setConfirmationInput('');
  }, []);

  // Helper for sanitizing search input
  const sanitizeInput = useCallback((input: string, maxLength: number = 100): string => {
    return input.trim().slice(0, maxLength);
  }, []);

  // Logout handler - clear sensitive data
  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
    setAdminKey(''); // Clear admin key from memory
    setStats(null);
    setChatMessages([]);
    setAIConversations([]);
    setGmLb(null);
    toast.success('Logged out successfully');
  }, []);

  const authenticate = async () => {
    if (!adminKey.trim()) {
      toast.error('Please enter admin key');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/invite/admin/stats', {
        headers: {
          'Authorization': `Bearer ${adminKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        // Extract the stats from the API response structure
        setStats({
          codes: data.codes,
          users: data.users,
          recentCodes: data.recentCodes,
        });
        setIsAuthenticated(true);
        toast.success('Admin access granted');
      } else if (response.status === 429) {
        toast.error('Too many authentication attempts. Please try again in 15 minutes.');
      } else if (response.status === 401) {
        toast.error('Invalid admin key. Please check your credentials.');
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.message || `Authentication failed (${response.status})`);
      }
    } catch (error: any) {
      console.error('Authentication error:', error);
      toast.error(error.message || 'Network error during authentication');
    } finally {
      setLoading(false);
    }
  };

  const refreshStats = async () => {
    if (!isAuthenticated) return;
    
    setLoading(true);
    try {
      const response = await fetch('/api/invite/admin/stats', {
        headers: {
          'Authorization': `Bearer ${adminKey}`,
          'Content-Type': 'application/json',
        },
        signal: abortControllerRef.current?.signal,
      });
      if (response.ok) {
        const data = await response.json();
        // Extract the stats from the API response structure
        setStats({
          codes: data.codes,
          users: data.users,
          recentCodes: data.recentCodes,
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.message || 'Failed to refresh stats');
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Refresh stats error:', error);
        toast.error('Failed to refresh stats');
      }
    } finally {
      setLoading(false);
    }
  };

  const generateAdminCodes = async (count: number) => {
    setGenerating(true);
    try {
      const response = await fetch('/api/invite/admin/generate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ count }),
      });

      const data = await response.json();
      if (data.success) {
        toast.success(`Generated ${data.codes.length} codes`);
        // Copy codes to clipboard
        navigator.clipboard.writeText(data.codes.join('\n'));
        toast.success('Codes copied to clipboard');
        refreshStats();
      } else {
        toast.error(data.error || 'Failed to generate codes');
      }
    } catch (error) {
      toast.error('Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // Broadcast functions
  const fetchBroadcastMessages = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const response = await fetch('/api/admin/broadcast', {
        headers: { 'Authorization': `Bearer ${adminKey}` }
      });
      if (response.ok) {
        const data = await response.json();
        setBroadcastMessages(data.messages || []);
        setBroadcastStats(data.stats || null);
      }
    } catch (error) {
      console.error('Failed to fetch broadcast messages:', error);
    }
  }, [isAuthenticated, adminKey]);

  const handleBroadcastCreate = async () => {
    if (!broadcastContent.trim()) {
      toast.error('Content is required');
      return;
    }
    setBroadcastLoading(true);
    try {
      const payload: any = {
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
        const data = await response.json();
        toast.error(data.error || 'Failed to save broadcast');
      }
    } catch (error) {
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
    setActiveTab('broadcast');
  };

  const handleBroadcastDelete = async (id: string) => {
    if (!confirm('Delete this broadcast?')) return;
    try {
      const response = await fetch(`/api/admin/broadcast?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminKey}` }
      });
      if (response.ok) {
        toast.success('Broadcast deleted');
        fetchBroadcastMessages();
      } else {
        toast.error('Failed to delete broadcast');
      }
    } catch (error) {
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
      const data = await response.json();
      if (response.ok) {
        toast.success(`Cleaned up ${data.cleaned} orphaned records`);
        fetchBroadcastMessages();
      } else {
        toast.error(data.error || 'Cleanup failed');
      }
    } catch (error) {
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
      const data = await response.json();
      if (response.ok) {
        toast.success(`🧹 Deleted ${data.deletedKeys} keys`);
        fetchBroadcastMessages();
      } else {
        toast.error(data.error || 'Nuke operation failed');
      }
    } catch (error) {
      toast.error('Error during nuke operation');
    }
  };

  useEffect(() => {
    if (isAuthenticated && activeTab === 'broadcast') {
      fetchBroadcastMessages();
    }
  }, [isAuthenticated, activeTab, fetchBroadcastMessages]);

  const performCleanup = async (action: string, target?: string) => {
    const actionNames = {
      delete_all_codes: 'delete ALL codes',
      delete_expired_codes: 'delete expired codes',
      delete_used_codes: 'delete used codes',
      reset_user_data: 'reset ALL user data',
      reset_daily_limits: 'reset daily limits',
      delete_specific_user: `delete user ${target}`,
      delete_everything: 'DELETE EVERYTHING from the database',
    };

    setLoading(true);
    try {
      const response = await fetch('/api/invite/admin/cleanup', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminKey}`,
        },
        // Map historical UI action to API's supported action name
        body: JSON.stringify({ action: action === 'delete_specific_user' ? 'delete_user_data' : action, target }),
        signal: abortControllerRef.current?.signal,
      });

      const data = await response.json();
      if (data.success) {
        toast.success(data.message || `Successfully performed: ${actionNames[action as keyof typeof actionNames]}`);
        refreshStats();
      } else {
        toast.error(data.error || `Cleanup failed: ${actionNames[action as keyof typeof actionNames]}`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Cleanup error:', error);
        toast.error(error.message || 'Cleanup operation failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Wrapper to show confirmation before cleanup
  const confirmCleanup = (action: string, target?: string) => {
    const actionNames = {
      delete_all_codes: 'delete ALL codes',
      delete_expired_codes: 'delete expired codes',
      delete_used_codes: 'delete used codes',
      reset_user_data: 'reset ALL user data',
      reset_daily_limits: 'reset daily limits',
      delete_specific_user: `delete user ${target}`,
      delete_everything: 'DELETE EVERYTHING from the database',
    };

    const actionName = actionNames[action as keyof typeof actionNames];
    const isDangerous = action === 'delete_everything' || action === 'delete_all_codes' || action === 'reset_user_data';
    
    showConfirmDialog({
      title: isDangerous ? '⚠️ Dangerous Operation' : 'Confirm Action',
      description: `Are you sure you want to ${actionName}? This action cannot be undone.`,
      confirmText: isDangerous ? 'Yes, I understand' : 'Confirm',
      onConfirm: () => performCleanup(action, target),
      isDangerous,
      requiresTextConfirmation: action === 'delete_everything',
      textToMatch: action === 'delete_everything' ? 'DELETE EVERYTHING' : undefined,
    });
  };

  const exportRewardData = () => {
    if (!stats) return;
    
    const rewardData = stats.users.topGenerators.map(user => ({
      address: user.address,
      generated: user.generated,
      successful: user.used,
      tokens: user.used * 100, // 100 tokens per successful invite
    }));

    const csv = [
      'Address,Generated,Successful,Tokens',
      ...rewardData.map(r => `${r.address},${r.generated},${r.successful},${r.tokens}`)
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invite-rewards-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Reward data exported');
  };

  // Chat management functions
  const fetchChatData = async () => {
    if (!adminKey.trim()) return;
    
    setChatLoading(true);
    try {
      const response = await fetch('/api/chat/admin/messages', {
        headers: {
          'Authorization': `Bearer ${adminKey}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch chat data');
      }

      const data = await response.json();
      setChatMessages(data.messages || []);
      setChatStats(data.stats || null);
    } catch (error) {
      console.error('Error fetching chat data:', error);
      toast.error('Failed to fetch chat data');
    } finally {
      setChatLoading(false);
    }
  };

  const deleteMessage = async (messageId: string, timestamp: number) => {
    if (!adminKey.trim()) return;
    
    try {
      const response = await fetch('/api/chat/admin/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ messageId, timestamp }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete message');
      }

      toast.success('Message deleted');
      fetchChatData(); // Refresh data
    } catch (error) {
      console.error('Error deleting message:', error);
      toast.error('Failed to delete message');
    }
  };

  const deleteAllMessages = async () => {
    if (!adminKey.trim()) return;

    try {
      const response = await fetch('/api/chat/admin/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ deleteAll: true }),
        signal: abortControllerRef.current?.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to delete all messages');
      }

      const data = await response.json();
      toast.success(`Deleted ${data.deletedCount} messages`);
      fetchChatData(); // Refresh data
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error deleting all messages:', error);
        toast.error(error.message || 'Failed to delete all messages');
      }
    }
  };

  const confirmDeleteAllMessages = () => {
    showConfirmDialog({
      title: 'Delete All Chat Messages',
      description: 'Are you sure you want to delete ALL chat messages? This action cannot be undone.',
      confirmText: 'Delete All',
      onConfirm: deleteAllMessages,
      isDangerous: true,
    });
  };

  // AI Chat management functions
  const fetchAIChatData = async () => {
    if (!adminKey.trim()) return;
    
    setAIChatLoading(true);
    try {
      const response = await fetch('/api/chat/ai/admin/conversations?includeStats=true', {
        headers: {
          'Authorization': `Bearer ${adminKey}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch AI chat data');
      }

      const data = await response.json();
      setAIConversations(data.conversations || []);
      setAIStats(data.stats || null);
    } catch (error) {
      console.error('Error fetching AI chat data:', error);
      toast.error('Failed to fetch AI chat data');
    } finally {
      setAIChatLoading(false);
    }
  };

  const loadConversationMessages = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/chat/ai/admin/messages?conversationId=${conversationId}`, {
        headers: {
          'Authorization': `Bearer ${adminKey}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load conversation messages');
      }

      const result = await response.json();
      setConversationMessages(result.messages);
      setSelectedConversation(conversationId);
    } catch (error) {
      console.error('Error loading conversation messages:', error);
      toast.error('Failed to load conversation');
    }
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/chat/ai/admin/conversations?conversationId=${conversationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${adminKey}`,
        },
        signal: abortControllerRef.current?.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }

      toast.success('Conversation deleted');
      fetchAIChatData();
      
      if (selectedConversation === conversationId) {
        setSelectedConversation(null);
        setConversationMessages([]);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Error deleting conversation:', error);
        toast.error(error.message || 'Failed to delete conversation');
      }
    }
  };

  const confirmDeleteConversation = (conversationId: string) => {
    showConfirmDialog({
      title: 'Delete Conversation',
      description: 'Are you sure you want to delete this conversation? This action cannot be undone.',
      confirmText: 'Delete',
      onConfirm: () => deleteConversation(conversationId),
      isDangerous: true,
    });
  };

  // Filter conversations by search term
  const filteredConversations = aiConversations.filter(conv => 
    conv.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    conv.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Fetch data when switching tabs - with AbortController cleanup
  useEffect(() => {
    if (!isAuthenticated || !adminKey) return;

    // Cancel any pending requests from previous tab
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new AbortController for this tab
    abortControllerRef.current = new AbortController();

    if (activeTab === 'chat') {
      fetchChatData();
    } else if (activeTab === 'ai-chat') {
      fetchAIChatData();
    } else if (activeTab === 'gamification') {
      (async () => {
        try {
          const res = await fetch('/api/gamification/leaderboards', { 
            headers: { 'Authorization': `Bearer ${adminKey}` },
            signal: abortControllerRef.current?.signal,
          });
          if (!res.ok) {
            console.warn('Failed to fetch gamification leaderboards:', res.status);
            return;
          }
          const data = await res.json();
          setGmLb({ streakTop: data.streakTop || [], missionTop: data.missionTop || [] });
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            console.error('Error fetching gamification data:', error);
          }
        }
      })();
    } else if (activeTab === 'rpc') {
      fetchRpcStatus();
    } else if (activeTab === 'notifications') {
      fetchNotifStats();
    }

    // Cleanup on unmount or tab change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [activeTab, isAuthenticated, adminKey]);

  // Gamification helpers
  const resetGamification = async (scope: 'streaks' | 'missions' | 'all') => {
    try {
      const res = await fetch('/api/gamification/admin/reset', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` }, 
        body: JSON.stringify({ scope }),
        signal: abortControllerRef.current?.signal,
      });
      const data = await res.json();
      if (res.ok) { 
        toast.success(`Reset ${scope} successfully (${data.deleted} keys deleted)`); 
      } else { 
        toast.error(data?.error || `Failed to reset ${scope}`); 
      }
    } catch (error: any) { 
      if (error.name !== 'AbortError') {
        console.error('Reset gamification error:', error);
        toast.error(error.message || 'Reset failed'); 
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

  // RPC status state
  const [rpcStatus, setRpcStatus] = useState<{ endpoints: Array<{ url: string; ok: boolean; ms: number; error?: string }>; summary: any } | null>(null);
  const [rpcLoading, setRpcLoading] = useState(false);
  const fetchRpcStatus = async () => {
    if (!adminKey.trim()) return;
    setRpcLoading(true);
    try {
      const res = await fetch('/api/admin/rpc-status', { headers: { 'Authorization': `Bearer ${adminKey}` } });
      const data = await res.json();
      if (res.ok) setRpcStatus({ endpoints: data.endpoints || [], summary: data.summary || null });
      else toast.error(data?.error || 'Failed RPC status');
    } catch {
      toast.error('Failed RPC status');
    } finally { setRpcLoading(false); }
  };

  // Notifications admin data
  const [notifStats, setNotifStats] = useState<PlantNotificationStats | null>(null);
  const [notifGlobalStats, setNotifGlobalStats] = useState<GlobalNotificationStats | null>(null);
  const [notifFenceStats, setNotifFenceStats] = useState<FenceStats | null>(null);
  const [eligibleFids, setEligibleFids] = useState<string[]>([]);
  const [notifDebugResult, setNotifDebugResult] = useState<any>(null);
  const [notifDebugLoadingWarn, setNotifDebugLoadingWarn] = useState(false);
  const [notifDebugLoadingExpire, setNotifDebugLoadingExpire] = useState(false);
  const [notifResetFenceLoading, setNotifResetFenceLoading] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);

  const fetchNotifStats = async () => {
    if (!adminKey.trim()) return;
    setNotifLoading(true);
    try {
      const res = await fetch('/api/admin/notifications', { headers: { Authorization: `Bearer ${adminKey}` } });
      const data: AdminStatsResponse | { error?: string } = await res.json();
      if (res.ok && (data as AdminStatsResponse)?.success) {
        const payload = data as AdminStatsResponse;
        setNotifStats(payload?.stats?.plant1h || null);
        setNotifFenceStats(payload?.stats?.fence || null);
        setNotifGlobalStats(payload?.stats?.global || null);
        setEligibleFids(payload?.stats?.eligibleFids || []);
      } else {
        const errorMessage = (data as { error?: string })?.error || 'Failed to load notifications stats';
        toast.error(errorMessage);
      }
    } catch (error) {
      console.error('Failed to load notifications stats:', error);
      toast.error('Failed to load notifications stats');
    } finally { setNotifLoading(false); }
  };

  const runNotifDebug = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications/cron/plant-care?debug=1', { method: 'POST' });
      const data = await res.json();
      setNotifDebugResult(data);
      if (!res.ok || data?.success === false) {
        toast.error(data?.error || 'Debug run failed');
      } else {
        toast.success('Debug run completed');
      }
    } catch {
      toast.error('Debug run failed');
    } finally { setLoading(false); }
  };

  const resetNotifHistory = async () => {
    if (!adminKey.trim()) return toast.error('Enter admin key');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/notifications/reset?scope=all', { 
        method: 'DELETE', 
        headers: { Authorization: `Bearer ${adminKey}` },
        signal: abortControllerRef.current?.signal,
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Notifications history reset successfully');
        setNotifDebugResult(null);
        fetchNotifStats();
      } else {
        toast.error(data?.error || 'Reset failed');
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Reset notifications error:', error);
        toast.error(error.message || 'Reset failed');
      }
    } finally { setLoading(false); }
  };

  const confirmResetNotifHistory = () => {
    showConfirmDialog({
      title: 'Reset Notifications History',
      description: 'Are you sure you want to reset notifications counts and history for all users? This action cannot be undone.',
      confirmText: 'Reset',
      onConfirm: resetNotifHistory,
      isDangerous: true,
    });
  };

  const runFenceDebug = async (type: 'warn' | 'expire') => {
    const setLoading = type === 'warn' ? setNotifDebugLoadingWarn : setNotifDebugLoadingExpire;
    setLoading(true);
    try {
      const res = await fetch(`/api/notifications/cron/fence-expiry?debug=1`, { method: 'POST' });
      const data = await res.json();
      setNotifDebugResult(data);
      if (!res.ok || data?.success === false) {
        toast.error(data?.error || 'Debug run failed');
      } else {
        toast.success(type === 'warn' ? 'Warn debug run completed' : 'Expire debug run completed');
      }
      fetchNotifStats();
    } catch (error) {
      console.error('Debug run failed:', error);
      toast.error('Debug run failed');
    } finally { setLoading(false); }
  };

  const resetFenceData = async (fid?: string, plant?: string) => {
    setNotifResetFenceLoading(true);
    try {
      const params = new URLSearchParams({ scope: 'fence' });
      if (fid) params.set('fid', fid);
      if (plant) params.set('plantId', plant);
      const res = await fetch(`/api/admin/notifications/reset?${params.toString()}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        toast.error(data?.error || 'Failed to reset fence data');
      } else {
        toast.success('Fence data reset');
        fetchNotifStats();
      }
    } catch (error) {
      console.error('Reset fence data failed:', error);
      toast.error('Reset fence data failed');
    } finally {
      setNotifResetFenceLoading(false);
    }
  };

  const confirmResetNotifFence = () => {
    showConfirmDialog({
      title: 'Reset Fence Data',
      description: 'Are you sure you want to reset fence alert data? This clears all logs, counts, and throttles.',
      confirmText: 'Reset',
      onConfirm: () => resetFenceData(),
      isDangerous: true,
    });
  };

  // OG Image test handlers
  const handleOgRefresh = () => {
    setOgRefreshKey((prev) => prev + 1);
  };

  const handleOgGenerateShortUrl = async () => {
    setOgIsGenerating(true);
    try {
      const response = await fetch('/api/share/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
        body: JSON.stringify({
          address: ogAddress,
          strain: String(ogSelectedStrain),
          name: ogStrains.find((s) => s.id === ogSelectedStrain)?.name || 'Flora',
          mintedAt: new Date().toISOString(),
        }),
      });
      if (response.ok) {
        const data = await response.json();
        setOgShortUrl(data.shortUrl);
        toast.success('Short URL generated!');
      } else {
        toast.error('Failed to generate short URL');
      }
    } catch (error) {
      console.error('Failed to generate short URL', error);
      toast.error('Error generating short URL');
    } finally {
      setOgIsGenerating(false);
    }
  };

  // Authentication screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-xl">Admin Access Required</CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter your admin key to access the invite management dashboard
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder="Admin key"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && authenticate()}
                className="pr-10"
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <Button
              onClick={authenticate}
              disabled={loading || !adminKey.trim()}
              className="w-full"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  Access Dashboard
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main dashboard
  return (
    <div className="min-h-screen w-full bg-background overflow-y-auto overflow-x-hidden">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-10 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Shield className="w-6 h-6 text-primary" />
              <h1 className="text-xl font-bold">Dashboard</h1>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="outline" size="sm" onClick={refreshStats} disabled={loading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <ThemeSelector />
              <Button variant="outline" size="sm" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-20">
        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-8 overflow-x-auto pb-2">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'codes', label: 'Codes', icon: Code },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'broadcast', label: 'Broadcast', icon: Megaphone },
            { id: 'chat', label: 'Chat', icon: MessageCircle },
            { id: 'ai-chat', label: 'AI Chat', icon: Bot },
            { id: 'cleanup', label: 'Cleanup', icon: Trash2 },
            { id: 'gamification', label: 'Gamification', icon: TrendingUp },
            { id: 'rpc', label: 'RPC', icon: BarChart3 },
            { id: 'notifications', label: 'Notifications', icon: Bell },
            { id: 'og-images', label: 'OG Images', icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'default' : 'ghost'}
                onClick={() => setActiveTab(tab.id as AdminTab)}
                className="flex items-center space-x-2"
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </Button>
            );
          })}
        </div>

        {/* Overview Tab */}
        <Activity mode={activeTab === 'overview' ? 'visible' : 'hidden'}>
          {stats && (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Total Codes</p>
                        <p className="text-2xl font-bold">{stats.codes.total}</p>
                      </div>
                      <Code className="w-8 h-8 text-primary" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Used Codes</p>
                        <p className="text-2xl font-bold">{stats.codes.used}</p>
                      </div>
                      <CheckCircle className="w-8 h-8 text-primary" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Active Users</p>
                        <p className="text-2xl font-bold">{stats.users.validatedUsers}</p>
                      </div>
                      <Users className="w-8 h-8 text-primary" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Success Rate</p>
                        <p className="text-2xl font-bold">
                          {stats.codes.total > 0 ? Math.round((stats.codes.used / stats.codes.total) * 100) : 0}%
                        </p>
                      </div>
                      <BarChart3 className="w-8 h-8 text-primary" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Top Generators */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Top Referrers</span>
                    <Button size="sm" onClick={exportRewardData}>
                      <Download className="w-4 h-4 mr-2" />
                      Export Rewards
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stats.users.topGenerators.slice(0, 10).map((user, index) => (
                      <div key={user.address} className="flex items-center justify-between p-3 bg-card rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center text-sm font-bold">
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-mono text-sm">{user.address.slice(0, 10)}...{user.address.slice(-4)}</p>
                            <p className="text-xs text-muted-foreground">{user.used} successful • {user.generated} generated</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">{user.used * 100} tokens</p>
                          <p className="text-xs text-muted-foreground">reward estimate</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </Activity>

        {/* Codes Tab */}
        <Activity mode={activeTab === 'codes' ? 'visible' : 'hidden'}>
          {stats && (
            <div className="space-y-6">
              {/* Generate Section */}
              <Card>
                <CardHeader>
                  <CardTitle>Generate Admin Codes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center space-x-3">
                    <Button onClick={() => generateAdminCodes(1)} disabled={generating}>
                      <Plus className="w-4 h-4 mr-2" />
                      Generate 1
                    </Button>
                    <Button onClick={() => generateAdminCodes(5)} disabled={generating}>
                      <Plus className="w-4 h-4 mr-2" />
                      Generate 5
                    </Button>
                    <Button onClick={() => generateAdminCodes(10)} disabled={generating}>
                      <Plus className="w-4 h-4 mr-2" />
                      Generate 10
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Generated codes will be copied to clipboard automatically
                  </p>
                </CardContent>
              </Card>

              {/* Recent Codes */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Codes ({stats.recentCodes.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {stats.recentCodes.map((code) => (
                      <div key={code.code} className="flex items-center justify-between p-3 bg-card rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className={`w-3 h-3 rounded-full ${code.isUsed ? 'bg-green-500/70' : 'bg-yellow-400/70'}`} />
                          <span className="font-mono">{code.code}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-sm">{code.isUsed ? 'Used' : 'Active'}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(code.createdAt).toLocaleString()} (Local)
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </Activity>

        {/* Users Tab */}
        <Activity mode={activeTab === 'users' ? 'visible' : 'hidden'}>
          {stats && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>User Statistics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Users</p>
                      <p className="text-2xl font-bold">{stats.users.totalUsers}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Validated Users</p>
                      <p className="text-2xl font-bold">{stats.users.validatedUsers}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    {stats.users.topGenerators.map((user) => (
                      <div key={user.address} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div>
                          <p className="font-mono text-sm">{user.address}</p>
                          <p className="text-xs text-muted-foreground">
                            Generated: {user.generated} • Successful: {user.used}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => confirmCleanup('delete_specific_user', user.address)}
                        >
                          <UserX className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </Activity>

        {/* Broadcast Tab */}
        <Activity mode={activeTab === 'broadcast' ? 'visible' : 'hidden'}>
          <div className="space-y-6">
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
                      <Megaphone className="w-8 h-8 text-purple-500 opacity-50" />
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
                      <Eye className="w-8 h-8 text-blue-500 opacity-50" />
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
                      <XIcon className="w-8 h-8 text-orange-500 opacity-50" />
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
                  <label className="text-sm font-medium block mb-2">Title (Optional)</label>
                  <Input
                    value={broadcastTitle}
                    onChange={(e) => setBroadcastTitle(e.target.value)}
                    placeholder="e.g., Giveaway Alert, System Update"
                    maxLength={60}
                  />
                  <p className="text-xs text-muted-foreground mt-1">{broadcastTitle.length}/60 characters</p>
                </div>

                <div>
                  <label className="text-sm font-medium block mb-2">Message Content *</label>
                  <Textarea
                    value={broadcastContent}
                    onChange={(e) => setBroadcastContent(e.target.value)}
                    placeholder="Your message to players..."
                    rows={4}
                    maxLength={500}
                    className="resize-none"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{broadcastContent.length}/500 characters</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium block mb-2">Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 'info', label: 'Info', icon: '💡' },
                        { value: 'announcement', label: 'Announcement', icon: '📢' },
                        { value: 'success', label: 'Success', icon: '✅' },
                        { value: 'warning', label: 'Warning', icon: '⚠️' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setBroadcastType(option.value as any)}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            broadcastType === option.value
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
                    <label className="text-sm font-medium block mb-2">Priority</label>
                    <div className="space-y-2">
                      {[
                        { value: 'low', label: 'Low', color: 'text-gray-600' },
                        { value: 'normal', label: 'Normal', color: 'text-blue-600' },
                        { value: 'high', label: 'High', color: 'text-red-600' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setBroadcastPriority(option.value as any)}
                          className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                            broadcastPriority === option.value
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
                  <label className="text-sm font-medium block mb-2">Expires In</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
                        className={`p-2 rounded-lg border transition-all text-sm ${
                          !broadcastNeverExpires && broadcastExpiresIn === option.value
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
                      className={`p-2 rounded-lg border transition-all text-sm ${
                        !broadcastNeverExpires && broadcastExpiresIn === 'custom'
                          ? 'border-primary bg-primary/10 font-medium'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      Custom…
                    </button>
                    <button
                      type="button"
                      onClick={() => setBroadcastNeverExpires(true)}
                      className={`p-2 rounded-lg border transition-all text-sm ${
                        broadcastNeverExpires
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
                  <label className="text-sm font-medium block mb-2">Call-to-Action (Optional)</label>
                  <div className="space-y-2">
                    <Input
                      value={broadcastActionLabel}
                      onChange={(e) => setBroadcastActionLabel(e.target.value)}
                      placeholder="Button label (e.g., Learn More, Join Now)"
                      maxLength={30}
                    />
                    <Input
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
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      broadcastDismissible ? 'bg-primary' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        broadcastDismissible ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {!broadcastDismissible && (
                  <Alert className="bg-orange-500/10 border-orange-500/20">
                    <AlertTriangle className="w-4 h-4 text-orange-600" />
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
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                msg.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                                msg.priority === 'normal' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                                'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                              }`}>
                                {msg.priority}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                                {msg.type}
                              </span>
                              {!msg.dismissible && (
                                <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                                  Non-dismissible
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{msg.content}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleBroadcastEdit(msg)}>
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleBroadcastDelete(msg.id)}>
                              <Trash2 className="w-4 h-4 text-red-600" />
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
                            <div className="flex items-center gap-1 text-orange-600">
                              <Clock className="w-3 h-3" />
                              Expires {new Date(msg.expiresAt).toLocaleString()}
                            </div>
                          )}
                        </div>
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
        )}
        </Activity>

        {/* Cleanup Tab */}
        <Activity mode={activeTab === 'cleanup' ? 'visible' : 'hidden'}>
        {activeTab === 'cleanup' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <AlertTriangle className="w-5 h-5 mr-2 text-orange-500" />
                  Cleanup Operations
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  These operations cannot be undone. Use with caution.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Button
                    variant="outline"
                    onClick={() => confirmCleanup('delete_expired_codes')}
                    disabled={loading}
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Delete Expired Codes
                  </Button>
                  
                  <Button
                    variant="outline"
                    onClick={() => confirmCleanup('delete_used_codes')}
                    disabled={loading}
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Delete Used Codes
                  </Button>
                  
                  <Button
                    variant="outline"
                    onClick={() => confirmCleanup('reset_daily_limits')}
                    disabled={loading}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reset Daily Limits
                  </Button>
                  
                  <Button
                    variant="outline"
                    onClick={() => confirmCleanup('reset_user_data')}
                    disabled={loading}
                  >
                    <Users className="w-4 h-4 mr-2" />
                    Reset User Data
                  </Button>
                </div>
                
                  <div className="border-t border-border pt-4 space-y-4">
                  <Button
                    variant="destructive"
                    onClick={() => confirmCleanup('delete_all_codes')}
                    disabled={loading}
                    className="w-full"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete ALL Codes
                  </Button>
                  
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                    <div className="flex items-center mb-2">
                      <AlertTriangle className="w-5 h-5 text-destructive mr-2" />
                      <h4 className="font-semibold text-destructive">DANGER ZONE</h4>
                    </div>
                    <p className="text-sm text-destructive mb-3">
                      This will delete <strong>EVERYTHING</strong> from the database including all codes, users, audit logs, and system data. This action cannot be undone!
                    </p>
                    <Button
                      variant="destructive"
                      onClick={() => confirmCleanup('delete_everything')}
                      disabled={loading}
                      className="w-full"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      🚨 DELETE EVERYTHING 🚨
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        </Activity>

        {/* Chat Tab */}
        <Activity mode={activeTab === 'chat' ? 'visible' : 'hidden'}>
        {activeTab === 'chat' && (
          <div className="space-y-6">
            {/* Chat Stats */}
            {chatStats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Total Messages</p>
                        <p className="text-2xl font-bold">{chatStats.totalMessages}</p>
                      </div>
                      <MessageCircle className="w-8 h-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Active Users</p>
                        <p className="text-2xl font-bold">{chatStats.activeUsers}</p>
                      </div>
                      <Users className="w-8 h-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Last 24h</p>
                        <p className="text-2xl font-bold">{chatStats.messagesLast24h}</p>
                      </div>
                      <Clock className="w-8 h-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Chat Management */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Chat Messages</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={fetchChatData}
                    disabled={chatLoading}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${chatLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={confirmDeleteAllMessages}
                    disabled={chatLoading}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete All
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {chatLoading ? (
                  <div className="text-center py-8">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    <p className="mt-2 text-muted-foreground">Loading chat messages...</p>
                  </div>
                ) : chatMessages.length === 0 ? (
                  <div className="text-center py-8">
                    <MessageCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No chat messages found</p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[500px] overflow-y-auto">
                    {chatMessages.map((message) => (
                      <div
                        key={`${message.id}-${message.timestamp}`}
                        className={`p-4 rounded-lg border ${
                          message.isSpam
                            ? 'bg-destructive/10 border-destructive/20'
                            : 'bg-card'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-medium text-sm">
                                {message.displayName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(message.timestamp).toLocaleString()} (Local)
                              </span>
                              {message.isSpam && (
                                <span className="text-xs bg-destructive/10 text-destructive px-2 py-1 rounded-full">
                                  Potential Spam
                                </span>
                              )}
                            </div>
                            <p className="text-sm">{message.message}</p>
                            <div className="mt-2 text-xs text-muted-foreground">
                              Address: {message.address}
                              {message.similarCount && message.similarCount > 1 && (
                                <span className="ml-2">
                                  Similar messages: {message.similarCount}
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteMessage(message.id, message.timestamp)}
                            disabled={chatLoading}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
        </Activity>

        {/* AI Chat Tab */}
        <Activity mode={activeTab === 'ai-chat' ? 'visible' : 'hidden'}>
        {activeTab === 'ai-chat' && (
          <div className="space-y-6">
            {/* AI Chat Stats */}
                {aiStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <Card>
                  <CardContent className="flex items-center p-4">
                        <MessageCircle className="w-8 h-8 text-primary mr-3" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Total Conversations</p>
                      <p className="text-2xl font-bold">{aiStats.totalConversations}</p>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="flex items-center p-4">
                        <Bot className="w-8 h-8 text-primary mr-3" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Total Messages</p>
                      <p className="text-2xl font-bold">{aiStats.totalMessages}</p>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="flex items-center p-4">
                        <TrendingUp className="w-8 h-8 text-primary mr-3" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Total Tokens</p>
                      <p className="text-2xl font-bold">{aiStats.totalTokens.toLocaleString()}</p>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="flex items-center p-4">
                        <Clock className="w-8 h-8 text-primary mr-3" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Daily Usage</p>
                      <p className="text-2xl font-bold">{aiStats.dailyUsage}</p>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="flex items-center p-4">
                        <DollarSign className="w-8 h-8 text-primary mr-3" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Est. Cost</p>
                      <p className="text-2xl font-bold">${aiStats.costEstimate.toFixed(4)}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Conversations List */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="w-5 h-5" />
                      AI Conversations ({filteredConversations.length})
                    </CardTitle>
                    <Button
                      variant="outline"
                      onClick={fetchAIChatData}
                      disabled={aiChatLoading}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${aiChatLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        placeholder="Search conversations..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(sanitizeInput(e.target.value))}
                        className="pl-10"
                        maxLength={100}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[500px] overflow-y-auto">
                  {aiChatLoading ? (
                    <div className="text-center py-8">
                      <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                      <p className="mt-2 text-muted-foreground">Loading conversations...</p>
                    </div>
                  ) : filteredConversations.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Bot className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No AI conversations found</p>
                    </div>
                  ) : (
                    filteredConversations.map((conversation) => (
                      <div
                        key={conversation.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedConversation === conversation.id
                            ? 'bg-primary/10 border-primary'
                            : 'hover:bg-muted/50'
                        }`}
                        onClick={() => loadConversationMessages(conversation.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium truncate">{conversation.title}</p>
                            <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                                {conversation.model}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">
                              {conversation.address.slice(0, 6)}...{conversation.address.slice(-4)}
                            </p>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>{conversation.messageCount} messages</span>
                              <span>{conversation.totalTokens} tokens</span>
                              <span title={new Date(conversation.lastMessageAt).toLocaleString()}>{formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true })}</span>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                loadConversationMessages(conversation.id);
                              }}
                            >
                              <Eye className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmDeleteConversation(conversation.id);
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Conversation Messages */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Conversation Messages
                    {selectedConversation && (
                      <span className="text-sm font-normal text-muted-foreground">
                        ({conversationMessages.length} messages)
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-[500px] overflow-y-auto">
                  {!selectedConversation ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>Select a conversation to view messages</p>
                    </div>
                  ) : conversationMessages.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No messages in this conversation</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {conversationMessages.map((message) => (
                        <div
                          key={message.id}
                          className={`p-3 rounded-lg border ${
                            message.type === 'assistant'
                              ? 'bg-blue-50 dark:bg-blue-950/30 border-l-4 border-blue-500 dark:border-blue-400'
                              : 'bg-gray-50 dark:bg-gray-800/30 border-l-4 border-gray-500 dark:border-gray-400'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {message.type === 'assistant' ? (
                                <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              ) : (
                                <Users className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                              )}
                              <span className="font-medium text-sm text-foreground">
                                {message.type === 'assistant' ? 'Neural Seed' : 'User'}
                              </span>
                              {message.tokensUsed && (
                                <span className="text-xs bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200 px-2 py-1 rounded">
                                  {message.tokensUsed} tokens
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground" title={new Date(message.timestamp).toLocaleString()}>
                              {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap text-foreground">{message.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
        </Activity>

        {/* Gamification Tab */}
        <Activity mode={activeTab === 'gamification' ? 'visible' : 'hidden'}>
        {activeTab === 'gamification' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Leaderboards (Current Month)</CardTitle>
              </CardHeader>
              <CardContent>
                {!gmLb ? (
                  <LoadingSpinner text="Loading leaderboards..." />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-medium mb-2">Streaks</h4>
                      <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {gmLb.streakTop.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No data</div>
                        ) : gmLb.streakTop.map((e, i) => (
                          <div key={`s-${e.address}-${i}`} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                            <div className="font-mono text-xs">{e.address}</div>
                            <div className="text-sm font-semibold">{e.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Missions (Points)</h4>
                      <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {gmLb.missionTop.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No data</div>
                        ) : gmLb.missionTop.map((e, i) => (
                          <div key={`m-${e.address}-${i}`} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                            <div className="font-mono text-xs">{e.address}</div>
                            <div className="text-sm font-semibold">{e.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
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
          </div>
        )}
        </Activity>

        {/* RPC Tab */}
        <Activity mode={activeTab === 'rpc' ? 'visible' : 'hidden'}>
        {activeTab === 'rpc' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>RPC Health</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm text-muted-foreground">
                    {rpcStatus ? (
                      <span>
                        Total: {rpcStatus.summary?.total} • Healthy: {rpcStatus.summary?.healthy} • Degraded: {rpcStatus.summary?.degraded} • Avg: {rpcStatus.summary?.avgLatencyMs}ms
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
                      <div key={e.url} className={`flex items-center justify-between p-2 rounded border ${e.ok ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                        <div className="font-mono text-xs truncate mr-2" title={e.url}>{e.url}</div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className={e.ok ? 'text-green-600' : 'text-red-600'}>{e.ok ? 'OK' : 'DOWN'}</span>
                          <span className="text-muted-foreground">{e.ms}ms</span>
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
          </div>
        )}
        </Activity>

        {/* Notifications Tab */}
        <Activity mode={activeTab === 'notifications' ? 'visible' : 'hidden'}>
        {activeTab === 'notifications' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Notifications (Plant Care 1h)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm text-muted-foreground">
                    {notifStats ? (
                      <span>
                        Total sent: {notifStats.sentCount || 0}
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
                      Debug Run (Force)
                    </Button>
                    <Button variant="destructive" size="sm" onClick={confirmResetNotifHistory} disabled={loading}>
                      {loading ? 'Resetting…' : 'Reset History'}
                    </Button>
                  </div>
                </div>
                {!notifStats ? (
                  <div className="text-center py-8 text-muted-foreground">No data yet.</div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-sm">
                      <div className="font-semibold mb-1">Global (all types)</div>
                      <div className="flex items-center justify-between p-2 rounded border">
                        <div>Sent total: {notifGlobalStats?.sentCount || 0}</div>
                        <div className="text-xs text-muted-foreground">Recent entries: {(notifGlobalStats?.recent || []).length}</div>
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="font-semibold mb-1">Recent batches</div>
                      <div className="space-y-1 max-h-[300px] overflow-y-auto">
                        {(notifStats?.recent || []).map((e: any, i: number) => (
                          <div key={i} className="flex items-center justify-between p-2 rounded border">
                            <div className="text-xs text-muted-foreground">{new Date(e.ts || 0).toLocaleString()} (Local)</div>
                            <div className="text-xs">fids: {(e.fids || []).length}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="font-semibold mb-1">Last cron run</div>
                      <div className="p-2 rounded border text-xs text-muted-foreground">
                        {notifDebugResult ? (
                          <pre className="whitespace-pre-wrap">{JSON.stringify(notifDebugResult, null, 2)}</pre>
                        ) : notifStats?.lastRun ? (
                          <pre className="whitespace-pre-wrap">{JSON.stringify(notifStats.lastRun, null, 2)}</pre>
                        ) : (
                          <span>No run summary yet.</span>
                        )}
                      </div>
                    </div>
                    {eligibleFids && eligibleFids.length > 0 ? (
                      <div className="text-sm">
                        <div className="font-semibold mb-1">Eligible fids (seen)</div>
                        <div className="flex flex-wrap gap-1 max-h-[200px] overflow-y-auto">
                          {eligibleFids.slice(0, 200).map((f: any) => (
                            <span key={f} className="text-xs bg-muted px-2 py-0.5 rounded">{f}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold flex items-center gap-2"><Shield className="w-4 h-4" /> Fence Alerts (2h warning)</h3>
                        <Button variant="outline" size="sm" onClick={() => runFenceDebug('warn')} disabled={notifDebugLoadingWarn}>
                          <RefreshCw className={`w-4 h-4 mr-2 ${notifDebugLoadingWarn ? 'animate-spin' : ''}`} /> Debug Warn
                        </Button>
                      </div>
                      <Card>
                        <CardContent className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span>Total warns</span>
                            <span className="font-semibold">{notifFenceStats?.warn.sentCount || 0}</span>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1">Recent</div>
                            <div className="space-y-1 max-h-[200px] overflow-y-auto text-xs">
                              {(notifFenceStats?.warn.recent || []).length === 0 ? (
                                <div className="text-muted-foreground">No warn notifications sent yet.</div>
                              ) : (
                                (notifFenceStats?.warn.recent || []).map((entry: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between p-2 rounded border">
                                    <span>{new Date(entry.ts || 0).toLocaleString()}</span>
                                    <span>fids: {(entry.fids || []).length}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Fence Alerts (expired)</h3>
                        <Button variant="outline" size="sm" onClick={() => runFenceDebug('expire')} disabled={notifDebugLoadingExpire}>
                          <RefreshCw className={`w-4 h-4 mr-2 ${notifDebugLoadingExpire ? 'animate-spin' : ''}`} /> Debug Expire
                        </Button>
                      </div>
                      <Card>
                        <CardContent className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span>Total expiries</span>
                            <span className="font-semibold">{notifFenceStats?.expire.sentCount || 0}</span>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1">Recent</div>
                            <div className="space-y-1 max-h-[200px] overflow-y-auto text-xs">
                              {(notifFenceStats?.expire.recent || []).length === 0 ? (
                                <div className="text-muted-foreground">No expiry notifications sent yet.</div>
                              ) : (
                                (notifFenceStats?.expire.recent || []).map((entry: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between p-2 rounded border">
                                    <span>{new Date(entry.ts || 0).toLocaleString()}</span>
                                    <span>fids: {(entry.fids || []).length}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">Last Fence Cron Run</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <pre className="whitespace-pre-wrap text-xs text-muted-foreground max-h-64 overflow-y-auto">{notifFenceStats?.lastRun ? JSON.stringify(notifFenceStats.lastRun, null, 2) : 'No runs yet.'}</pre>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">Run History (last 20)</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2 max-h-64 overflow-y-auto text-xs text-muted-foreground">
                              {(notifFenceStats?.runs || []).length === 0 ? 'No history yet.' : (notifFenceStats?.runs || []).map((run: any, idx: number) => (
                                <pre key={idx} className="border p-2 rounded">{JSON.stringify(run, null, 2)}</pre>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="destructive" size="sm" onClick={confirmResetNotifFence} disabled={notifResetFenceLoading}>
                          {notifResetFenceLoading ? 'Clearing Fence Data…' : 'Clear Fence Data'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
        </Activity>

        {/* OG Images Tab */}
        <Activity mode={activeTab === 'og-images' ? 'visible' : 'hidden'}>
        {activeTab === 'og-images' && (
          <div className="space-y-6">
            <div className="text-center space-y-2 mb-6">
              <h2 className="text-2xl font-bold">🖼️ OG Image Test Lab</h2>
              <p className="text-muted-foreground">
                Test share images for Twitter & Farcaster without posting
              </p>
            </div>

            {/* Controls */}
            <Card>
              <CardHeader>
                <CardTitle>Test Parameters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Address / ENS / Basename</label>
                  <Input
                    value={ogAddress}
                    onChange={(e) => setOgAddress(e.target.value)}
                    placeholder="vitalik.eth or 0x123..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Strain</label>
                  <div className="grid grid-cols-5 gap-2">
                    {ogStrains.map((strain) => (
                      <Button
                        key={strain.id}
                        variant={ogSelectedStrain === strain.id ? 'default' : 'outline'}
                        onClick={() => setOgSelectedStrain(strain.id)}
                        className="w-full"
                      >
                        {strain.name}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={handleOgRefresh} className="w-full">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh Images
                  </Button>

                  <Button 
                    onClick={handleOgGenerateShortUrl} 
                    className="w-full"
                    variant="secondary"
                    disabled={ogIsGenerating}
                  >
                    {ogIsGenerating ? 'Generating...' : '✨ Generate Short URL'}
                  </Button>
                </div>

                {ogShortUrl && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <div className="text-xs font-semibold text-green-900 dark:text-green-100 mb-1">
                      Short URL Generated:
                    </div>
                    <div className="font-mono text-sm text-green-700 dark:text-green-300 break-all">
                      {ogShortUrl}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(ogShortUrl);
                          toast.success('Copied!');
                        }}
                      >
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(ogShortUrl, '_blank')}
                      >
                        Open
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Twitter Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>🐦 Twitter</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    (1200 x 630)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <img
                    key={`twitter-${ogRefreshKey}`}
                    src={`/api/og/mint?platform=twitter&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}&v=${ogRefreshKey}`}
                    alt="Twitter OG Preview"
                    className="w-full border border-border rounded-lg"
                  />
                  <div className="flex gap-2">
                    <Input 
                      value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/og/mint?platform=twitter&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`}
                      readOnly 
                      className="flex-1 text-xs" 
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/og/mint?platform=twitter&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`;
                        navigator.clipboard.writeText(url);
                        toast.success('Copied!');
                      }}
                    >
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/api/og/mint?platform=twitter&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`, '_blank')}
                    >
                      Open
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Farcaster Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>🟣 Farcaster</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    (1200 x 800 - 3:2 ratio)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <img
                    key={`farcaster-${ogRefreshKey}`}
                    src={`/api/og/mint?platform=farcaster&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}&v=${ogRefreshKey}`}
                    alt="Farcaster OG Preview"
                    className="w-full border border-border rounded-lg"
                  />
                  <div className="flex gap-2">
                    <Input 
                      value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/og/mint?platform=farcaster&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`}
                      readOnly 
                      className="flex-1 text-xs" 
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/og/mint?platform=farcaster&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`;
                        navigator.clipboard.writeText(url);
                        toast.success('Copied!');
                      }}
                    >
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/api/og/mint?platform=farcaster&address=${encodeURIComponent(ogAddress)}&strain=${ogSelectedStrain}`, '_blank')}
                    >
                      Open
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Testing Checklist */}
            <Card>
              <CardHeader>
                <CardTitle>📝 Testing Checklist</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Text is readable against background</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Plant image is clearly visible on left</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Address/ENS/Basename displays correctly</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Twitter (1200x630) fits content properly</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Farcaster (1200x800) uses full vertical space</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>✅</span>
                  <span>Short URLs work and redirect correctly</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        </Activity>
      </div>

      {/* Custom Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog({ ...confirmDialog, open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={confirmDialog.isDangerous ? 'text-destructive' : ''}>
              {confirmDialog.title}
            </DialogTitle>
            <DialogDescription>{confirmDialog.description}</DialogDescription>
          </DialogHeader>
          
          {confirmDialog.requiresTextConfirmation && confirmDialog.textToMatch && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Type <strong>{confirmDialog.textToMatch}</strong> to confirm:</p>
              <Input
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                placeholder={confirmDialog.textToMatch}
              />
            </div>
          )}
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog.isDangerous ? 'destructive' : 'default'}
              onClick={() => {
                // Check text confirmation if required
                if (confirmDialog.requiresTextConfirmation && confirmDialog.textToMatch) {
                  if (confirmationInput !== confirmDialog.textToMatch) {
                    toast.error('Confirmation text does not match. Operation cancelled.');
                    return;
                  }
                }
                confirmDialog.onConfirm();
                setConfirmDialog({ ...confirmDialog, open: false });
              }}
              disabled={Boolean(
                confirmDialog.requiresTextConfirmation &&
                confirmDialog.textToMatch &&
                confirmationInput !== confirmDialog.textToMatch
              )}
            >
              {confirmDialog.confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
} 