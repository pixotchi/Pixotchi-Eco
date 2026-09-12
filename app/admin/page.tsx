'use client';

import { AdminAccessGate } from '@/components/admin/admin-access-gate';
import { AdminConfirmationDialog, type AdminConfirmationState } from '@/components/admin/admin-confirmation-dialog';
import { ThemeSelector } from '@/components/theme-selector';
import { Button } from '@/components/ui/button';
import { BadgeCheck, BarChart3, Bell, Bot, FileText, Gift, Megaphone, MessageCircle, Plus, Shield, TrendingUp } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'react-hot-toast';
import { AdminBroadcastSection } from '@/components/admin/admin-broadcast-section';
import { AdminChatSection } from '@/components/admin/admin-chat-section';
import { AdminAiChatSection } from '@/components/admin/admin-ai-chat-section';
import { AdminGamificationSection } from '@/components/admin/admin-gamification-section';
import { AdminRpcSection } from '@/components/admin/admin-rpc-section';
import { AdminNotificationsSection } from '@/components/admin/admin-notifications-section';
import { AdminOgImagesSection } from '@/components/admin/admin-og-images-section';
import { AdminFeedbackSection } from '@/components/admin/admin-feedback-section';
import { AdminAirdropSection } from '@/components/admin/admin-airdrop-section';
import { AdminClaimsSection } from '@/components/admin/admin-claims-section';

type AdminTab = 'chat' | 'ai-chat' | 'gamification' | 'rpc' | 'notifications' | 'broadcast' | 'og-images' | 'feedback' | 'airdrop' | 'claims';

const ADMIN_NAV_GROUPS: Array<{
  label: string;
  tabs: Array<{ id: AdminTab; label: string; icon: typeof BarChart3 }>;
}> = [
    {
      label: 'Community',
      tabs: [
        { id: 'feedback', label: 'Feedback', icon: Plus },
      ],
    },
    {
      label: 'Game Ops',
      tabs: [
        { id: 'broadcast', label: 'Broadcast', icon: Megaphone },
        { id: 'chat', label: 'Chat', icon: MessageCircle },
        { id: 'ai-chat', label: 'AI Chat', icon: Bot },
        { id: 'gamification', label: 'Gamification', icon: TrendingUp },
      ],
    },
    {
      label: 'System',
      tabs: [
        { id: 'rpc', label: 'RPC', icon: BarChart3 },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        { id: 'og-images', label: 'OG Images', icon: FileText },
      ],
    },
    {
      label: 'Economy',
      tabs: [
        { id: 'airdrop', label: 'Airdrop', icon: Gift },
        { id: 'claims', label: 'Claims', icon: BadgeCheck },
      ],
    },
  ];

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [activeTab, setActiveTab] = useState<AdminTab>('broadcast');

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<AdminConfirmationState>({
    open: false,
    title: '',
    description: '',
    confirmText: 'Confirm',
    onConfirm: () => { },
  });

  const showConfirmDialog = useCallback((config: Omit<AdminConfirmationState, 'open'>) => {
    setConfirmDialog({ ...config, open: true });
  }, []);
  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
    setAdminKey('');
    setConfirmDialog(state => ({ ...state, open: false }));
    toast.success('Logged out successfully');
  }, []);
  if (!isAuthenticated) return <AdminAccessGate adminKey={adminKey} setAdminKey={setAdminKey} onAuthenticated={() => setIsAuthenticated(true)} />;

  // Main dashboard
  return (
    <div className="min-h-screen w-full bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-10 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Shield className="w-6 h-6 text-primary" />
              <h1 className="text-xl font-bold">Dashboard</h1>
            </div>
            <div className="flex items-center space-x-3">
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
        <nav className="mb-8 space-y-3" aria-label="Admin dashboard sections">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1.5">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <Button
                      key={tab.id}
                      variant={activeTab === tab.id ? 'default' : 'ghost'}
                      aria-current={activeTab === tab.id ? 'page' : undefined}
                      onClick={() => setActiveTab(tab.id)}
                      className="flex items-center gap-2"
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Broadcast Tab */}
        <AdminBroadcastSection adminKey={adminKey} isActive={activeTab === 'broadcast'} showConfirmDialog={showConfirmDialog} />

        {/* Chat Tab */}
        <AdminChatSection adminKey={adminKey} isActive={activeTab === 'chat'} showConfirmDialog={showConfirmDialog} />

        {/* AI Chat Tab */}
        <AdminAiChatSection adminKey={adminKey} isActive={activeTab === 'ai-chat'} showConfirmDialog={showConfirmDialog} />

        {/* Gamification Tab */}
        <AdminGamificationSection adminKey={adminKey} isActive={activeTab === 'gamification'} showConfirmDialog={showConfirmDialog} />

        {/* RPC Tab */}
        <AdminRpcSection adminKey={adminKey} isActive={activeTab === 'rpc'} />

        {/* Notifications Tab */}
        <AdminNotificationsSection adminKey={adminKey} isActive={activeTab === 'notifications'} showConfirmDialog={showConfirmDialog} />

        {/* OG Images Tab */}
        <AdminOgImagesSection adminKey={adminKey} isActive={activeTab === 'og-images'} />

        {/* Feedback Tab */}
        <AdminFeedbackSection adminKey={adminKey} isActive={activeTab === 'feedback'} showConfirmDialog={showConfirmDialog} />

        {/* Airdrop Tab */}
        <AdminAirdropSection adminKey={adminKey} isActive={activeTab === 'airdrop'} showConfirmDialog={showConfirmDialog} />

        {/* ==================== CLAIMS TAB ==================== */}
        <AdminClaimsSection adminKey={adminKey} isActive={activeTab === 'claims'} showConfirmDialog={showConfirmDialog} />
      </div>

      <AdminConfirmationDialog state={confirmDialog} onClose={() => setConfirmDialog({ ...confirmDialog, open: false })} />
    </div>
  );
}
