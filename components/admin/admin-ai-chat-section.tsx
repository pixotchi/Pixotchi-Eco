'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { parseAdminAiSnapshot } from '@/lib/admin-view-data';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { AIToolCallTrace } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { Bot, Clock, Code, DollarSign, Eye, FileText, MessageCircle, RefreshCw, Search, Trash2, TrendingUp, Users } from 'lucide-react';
import { useState } from 'react';
import { useAdminRead } from '@/hooks/useAdminRead';
import { parseAdminAiMessages, parseAdminOperation } from '@/lib/admin-api-data';
import { toast } from 'react-hot-toast';
import { type AdminSectionProps, AdminReadError, getErrorName, getErrorMessage, sanitizeInput, useAdminAbortController } from './admin-section-shared';

function getToolStatusClass(status: AIToolCallTrace['status']) {
  if (status === 'ok') {
    return 'bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success-strong))]';
  }

  if (status === 'error') {
    return 'bg-destructive/10 text-destructive';
  }

  return 'bg-muted text-muted-foreground';
}

function formatToolFreshness(trace: AIToolCallTrace) {
  const parts: string[] = [];

  if (trace.freshness?.blockNumber) {
    parts.push(`block ${trace.freshness.blockNumber}`);
  }

  if (trace.freshness?.cache) {
    parts.push(`cache: ${trace.freshness.cache}`);
  }

  if (trace.freshness?.fetchedAt) {
    const fetchedAt = new Date(trace.freshness.fetchedAt);
    if (!Number.isNaN(fetchedAt.getTime())) {
      parts.push(`fetched ${formatDistanceToNow(fetchedAt, { addSuffix: true })}`);
    }
  }

  return parts.join(' · ') || 'No freshness metadata';
}

function formatToolInput(input: unknown) {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return '[unserializable input]';
  }
}
export function AdminAiChatSection({ adminKey, isActive, showConfirmDialog }: Pick<AdminSectionProps, 'adminKey' | 'isActive' | 'showConfirmDialog'>) {
  const abortControllerRef = useAdminAbortController(isActive);
  const { data: snapshot, loading: aiChatLoading, error: aiChatError, reload: fetchAIChatData } = useAdminRead({ adminKey, isActive, endpoint: '/api/chat/ai/admin/conversations?includeStats=true', parse: parseAdminAiSnapshot, label: 'AI chat' });
  const aiConversations = snapshot?.conversations ?? [];
  const aiStats = snapshot?.stats ?? null;
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const { data: conversationData, setData: setConversationData, loading: conversationLoading, error: conversationError, reload: reloadConversation } = useAdminRead({ adminKey, isActive: isActive && selectedConversation !== null, endpoint: `/api/chat/ai/admin/messages?conversationId=${encodeURIComponent(selectedConversation ?? '')}`, parse: parseAdminAiMessages, label: 'Conversation' });
  const conversationMessages = conversationData?.messages ?? [];
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingAllAIConversations, setDeletingAllAIConversations] = useState(false);

  const loadConversationMessages = (conversationId: string) => {
    if (conversationId === selectedConversation) void reloadConversation();
    else setSelectedConversation(conversationId);
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/chat/ai/admin/conversations?conversationId=${encodeURIComponent(conversationId)}`, {
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
        setConversationData(null);
      }
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') {
        console.error('Error deleting conversation:', error);
        toast.error(getErrorMessage(error) || 'Failed to delete conversation');
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

  const deleteAllAIChatConversations = async () => {
    if (!adminKey.trim()) return;

    setDeletingAllAIConversations(true);
    try {
      const response = await fetch('/api/chat/ai/admin/conversations?all=true', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${adminKey}`,
        },
        signal: abortControllerRef.current?.signal,
      });

      const data = parseAdminOperation(await response.json().catch(() => null));
      if (!data) throw new Error('Response could not be read. Reload to check the result.');

      if (!response.ok) {
        throw new Error(data?.error || data?.message || 'Failed to delete all AI conversations');
      }

      const deletedCount = typeof data?.deletedCount === 'number' ? data.deletedCount : 0;
      toast.success(
        deletedCount > 0
          ? `Deleted ${deletedCount} AI conversation${deletedCount === 1 ? '' : 's'}`
          : 'No AI conversations to delete'
      );

      setSelectedConversation(null);
      setConversationData(null);
      await fetchAIChatData();
    } catch (error) {
      if (getErrorName(error) !== 'AbortError') {
        console.error('Error deleting all AI conversations:', error);
        toast.error(getErrorMessage(error) || 'Failed to delete all AI conversations');
      }
    } finally {
      setDeletingAllAIConversations(false);
    }
  };

  const confirmDeleteAllAIConversations = () => {
    showConfirmDialog({
      title: 'Delete All AI Conversations',
      description: 'Are you sure you want to delete ALL AI conversations? This action cannot be undone.',
      confirmText: 'Delete All',
      onConfirm: deleteAllAIChatConversations,
      isDangerous: true,
    });
  };

  // Filter conversations by search term
  const filteredConversations = aiConversations.filter(conv =>
    conv.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    conv.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isActive) return null;
  return (<div className="space-y-6">
    <AdminReadError message={aiChatError} onRetry={fetchAIChatData} busy={aiChatLoading} />
    <AdminReadError message={conversationError} onRetry={reloadConversation} busy={conversationLoading} />
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
              <p className="text-2xl font-bold">{aiStats.costEstimate === null ? 'Unavailable' : `$${aiStats.costEstimate.toFixed(4)}`}</p>
              {aiStats.costEstimate === null && <p className="text-xs text-muted-foreground">Check provider billing for actual spend.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    )}

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Conversations List */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex min-w-0 items-center gap-2">
              <Bot className="w-5 h-5 shrink-0" />
              <span className="min-w-0 break-words">AI Conversations ({filteredConversations.length})</span>
            </CardTitle>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <Button
                variant="destructive"
                className="h-auto min-h-11 max-w-full whitespace-normal"
                onClick={confirmDeleteAllAIConversations}
                disabled={aiChatLoading || deletingAllAIConversations || aiConversations.length === 0}
              >
                <Trash2 className={`w-4 h-4 mr-2 ${deletingAllAIConversations ? 'animate-spin' : ''}`} />
                Delete All
              </Button>
              <Button
                variant="outline"
                className="h-auto min-h-11 max-w-full whitespace-normal"
                onClick={fetchAIChatData}
                disabled={aiChatLoading || deletingAllAIConversations}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${aiChatLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search conversations..."
                aria-label="Search conversations"
                value={searchTerm}
                onChange={(e) => setSearchTerm(sanitizeInput(e.target.value))}
                className="pl-10"
                maxLength={100}
              />
            </div>
          </div>
        </CardHeader>
        <ScrollArea className="space-y-2 max-h-[500px] overflow-y-auto">
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
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedConversation === conversation.id
                  ? 'bg-primary/10 border-primary'
                  : 'hover:bg-muted/50'
                  }`}
                onClick={() => loadConversationMessages(conversation.id)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-32">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="min-w-0 max-w-full font-medium truncate">{conversation.title}</p>
                      <span className="max-w-full break-words text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                        {conversation.model}
                      </span>
                    </div>
                    <p className="break-words text-xs text-muted-foreground mb-1">
                      {conversation.address.slice(0, 6)}...{conversation.address.slice(-4)}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{conversation.messageCount} messages</span>
                      <span>{conversation.totalTokens} tokens</span>
                      <span title={new Date(conversation.lastMessageAt).toLocaleString()}>{formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <div className="flex max-w-full shrink-0 flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 w-11 p-0"
                      aria-label={`View conversation with ${conversation.address}`}
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
                      className="h-11 w-11 p-0"
                      aria-label={`Delete conversation with ${conversation.address}`}
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
        </ScrollArea>
      </Card>

      {/* Conversation Messages */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <FileText className="w-5 h-5 shrink-0" />
            <span className="min-w-0 break-words">Conversation Messages</span>
            {selectedConversation && (
              <span className="text-sm font-normal text-muted-foreground">
                ({conversationMessages.length} messages)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <ScrollArea className="max-h-[500px] overflow-y-auto">
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
                  className={`p-3 rounded-lg border ${message.type === 'assistant'
                    ? 'bg-[hsl(var(--info)/0.1)] border-l-4 border-[hsl(var(--info))]'
                    : 'bg-gray-50 dark:bg-gray-800/30 border-l-4 border-gray-500 dark:border-gray-400'
                    }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {message.type === 'assistant' ? (
                        <Bot className="w-4 h-4 text-[hsl(var(--info))]" />
                      ) : (
                        <Users className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                      )}
                      <span className="font-medium text-sm text-foreground">
                        {message.type === 'assistant' ? 'Neural Seed' : 'User'}
                      </span>
                      {message.tokensUsed && (
                        <span className="text-xs bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))] px-2 py-1 rounded">
                          {message.tokensUsed} tokens
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground" title={new Date(message.timestamp).toLocaleString()}>
                      {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-foreground">{message.message}</p>
                  {message.type === 'assistant' && message.toolCalls?.length ? (
                    <div className="mt-3 rounded-md border border-[hsl(var(--info)/0.22)] bg-background/80 p-2">
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <Code className="w-3.5 h-3.5" />
                        Tool calls ({message.toolCalls.length})
                      </div>
                      <div className="space-y-2">
                        {message.toolCalls.map((toolCall, index) => (
                          <div
                            key={`${message.id}-${toolCall.toolName}-${index}`}
                            className="rounded border bg-muted/30 p-2"
                          >
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono font-semibold text-foreground">
                                {toolCall.toolName}
                              </span>
                              <span className={`rounded px-1.5 py-0.5 font-medium ${getToolStatusClass(toolCall.status)}`}>
                                {toolCall.status}
                              </span>
                              {toolCall.source && (
                                <span className="text-muted-foreground">
                                  {toolCall.source}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {formatToolFreshness(toolCall)}
                            </div>
                            {toolCall.error && (
                              <div className="mt-1 text-[11px] text-destructive">
                                {toolCall.error}
                              </div>
                            )}
                            {toolCall.input !== undefined && (
                              <ScrollArea className="mt-2 max-h-28 overflow-auto rounded bg-background p-2 text-[11px] text-muted-foreground whitespace-pre"><pre className="m-0 [white-space:inherit]">
                                {formatToolInput(toolCall.input)}
                              </pre></ScrollArea>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  </div>);
}
