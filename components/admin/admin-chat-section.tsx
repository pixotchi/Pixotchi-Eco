'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { Clock, MessageCircle, RefreshCw, Trash2, Users } from 'lucide-react';

import { toast } from 'react-hot-toast';
import { useAdminRead } from '@/hooks/useAdminRead';
import { parseAdminChat, parseAdminOperation } from '@/lib/admin-api-data';
import { type AdminSectionProps, AdminReadError, getErrorName, getErrorMessage, useAdminAbortController } from './admin-section-shared';

export function AdminChatSection({ adminKey, isActive, showConfirmDialog }: Pick<AdminSectionProps, 'adminKey' | 'isActive' | 'showConfirmDialog'>) {
  const abortControllerRef = useAdminAbortController(isActive);
  const { data, loading: chatLoading, error: readError, reload: fetchChatData } = useAdminRead({ adminKey, isActive, endpoint: '/api/chat/admin/messages', parse: parseAdminChat, label: 'Chat' });
  const chatMessages = data?.messages ?? [];
  const chatStats = data?.stats ?? null;

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

      const data = parseAdminOperation(await response.json());
      if (!data || data.deletedCount === undefined) throw new Error('Response could not be read. Reload to check the result.');
      toast.success(`Deleted ${data.deletedCount} messages`);
      fetchChatData(); // Refresh data
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') {
        console.error('Error deleting all messages:', error);
        toast.error(getErrorMessage(error) || 'Failed to delete all messages');
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

  if (!isActive) return null;
  return (<div className="space-y-6">
    <AdminReadError message={readError} onRetry={fetchChatData} busy={chatLoading} />
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
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Chat Messages</CardTitle>
        <div className="flex min-w-0 max-w-full flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-auto min-h-11 max-w-full whitespace-normal"
            onClick={fetchChatData}
            disabled={chatLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${chatLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="destructive"
            className="h-auto min-h-11 max-w-full whitespace-normal"
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
          <ScrollArea className="space-y-4 max-h-[500px] overflow-y-auto">
            {chatMessages.map((message) => (
              <div
                key={`${message.id}-${message.timestamp}`}
                className={`p-4 rounded-lg border ${message.isSpam
                  ? 'bg-destructive/10 border-destructive/20'
                  : 'bg-card'
                  }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                      <span className="min-w-0 break-words font-medium text-sm">
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
                    <p className="break-words text-sm">{message.message}</p>
                    <div className="mt-2 break-words text-xs text-muted-foreground">
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
                    className="h-11 w-11 shrink-0 p-0"
                    aria-label={`Delete chat message from ${message.displayName || message.address}`}
                    onClick={() => deleteMessage(message.id, message.timestamp)}
                    disabled={chatLoading}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  </div>);
}
