'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageCircle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAdminRead } from '@/hooks/useAdminRead';
import { parseAdminFeedback, parseAdminOperation } from '@/lib/admin-api-data';
import { type AdminSectionProps, AdminReadError, LoadingSpinner } from './admin-section-shared';

export function AdminFeedbackSection({ adminKey, isActive, showConfirmDialog }: Pick<AdminSectionProps, 'adminKey' | 'isActive' | 'showConfirmDialog'>) {
  const [loading, setLoading] = useState(false);
  const { data, loading: feedbackLoading, error: readError, reload: fetchFeedback } = useAdminRead({ adminKey, isActive, endpoint: '/api/admin/feedback/list', parse: parseAdminFeedback, label: 'Feedback' });
  const feedbackList = data?.feedback ?? [];

  const deleteFeedback = async (feedbackId: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/feedback/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ feedbackId }),
      });
      const data = parseAdminOperation(await res.json());
      if (!data) throw new Error('Response could not be read. Reload to check the result.');
      if (res.ok) {
        toast.success('Feedback deleted');
        fetchFeedback();
      } else {
        toast.error(data.error || 'Failed to delete feedback');
      }
    } catch (error) {
      console.error('Delete feedback error:', error);
      toast.error('Failed to delete feedback');
    } finally {
      setLoading(false);
    }
  };

  const deleteAllFeedback = async () => {
    showConfirmDialog({
      title: '⚠️ Delete All Feedback',
      description: 'Are you sure you want to delete all feedback? This action cannot be undone.',
      confirmText: 'Delete All',
      onConfirm: async () => {
        setLoading(true);
        try {
          const res = await fetch('/api/admin/feedback/delete', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${adminKey}`,
            },
            body: JSON.stringify({ deleteAll: true }),
          });
          const data = parseAdminOperation(await res.json());
          if (!data) throw new Error('Response could not be read. Reload to check the result.');
          if (res.ok && data.deletedCount !== undefined) {
            toast.success(`Deleted ${data.deletedCount} feedback messages`);
            fetchFeedback();
          } else {
            toast.error(data.error || 'Failed to delete all feedback');
          }
        } catch (error) {
          console.error('Delete all feedback error:', error);
          toast.error('Failed to delete all feedback');
        } finally {
          setLoading(false);
        }
      },
      isDangerous: true,
    });
  };

  if (!isActive) return null;
  return (<div className="space-y-6">
    <AdminReadError message={readError} onRetry={fetchFeedback} busy={feedbackLoading} />
    <div className="flex items-center justify-between">
      <h2 className="text-2xl font-bold">User Feedback</h2>
      {feedbackList.length > 0 && (
        <Button
          variant="destructive"
          onClick={deleteAllFeedback}
          disabled={feedbackLoading || loading}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete All
        </Button>
      )}
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Feedback Messages ({feedbackList.length})</CardTitle>
        <CardDescription>User feedback and suggestions</CardDescription>
      </CardHeader>
      <CardContent>
        {feedbackLoading ? (
          <LoadingSpinner text="Loading feedback..." />
        ) : feedbackList.length === 0 ? (
          <div className="text-center py-12">
            <MessageCircle className="w-12 h-12 mx-auto text-muted-foreground opacity-50 mb-4" />
            <p className="text-muted-foreground">No feedback yet</p>
            <p className="text-sm text-muted-foreground mt-1">User feedback will appear here</p>
          </div>
        ) : (
          <ScrollArea className="space-y-3 max-h-[600px] overflow-y-auto">
            {feedbackList.map((feedback) => (
              <div
                key={feedback.id}
                className="border rounded-lg p-4 space-y-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Address and Timestamp */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-sm font-mono text-muted-foreground break-all">
                        {feedback.address}
                      </span>
                      <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded whitespace-nowrap">
                        {new Date(feedback.createdAt).toLocaleDateString()} {new Date(feedback.createdAt).toLocaleTimeString()}
                      </span>
                    </div>

                    {/* Wallet Profile Data */}
                    <div className="grid grid-cols-2 gap-2 gap-x-3 mb-3 p-2 bg-muted/30 rounded text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-muted-foreground text-xs">Wallet Type</span>
                        <span className="font-semibold text-sm">{feedback.walletType === 'coinbase-smart' ? 'Coinbase Smart' : feedback.walletType === 'other-smart' ? 'Smart Wallet' : feedback.walletType === 'eip7702-delegated' ? 'Delegated EOA (EIP-7702)' : 'EOA'}</span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-muted-foreground text-xs">Smart Wallet</span>
                        <span className="font-semibold text-sm">{feedback.isSmartWallet ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-muted-foreground text-xs">Mini App</span>
                        <span className="font-semibold text-sm">{feedback.isMiniApp ? 'Yes' : 'No'}</span>
                      </div>
                      {feedback.farcasterDetails && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground text-xs">Farcaster</span>
                          <span className="font-semibold text-sm truncate">
                            {feedback.farcasterDetails.username || feedback.farcasterDetails.displayName || `FID: ${feedback.farcasterDetails.fid}`}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Feedback Message */}
                    <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                      {feedback.message}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete feedback from ${feedback.username || feedback.address || 'anonymous user'}`}
                    onClick={() => deleteFeedback(feedback.id)}
                    disabled={loading}
                    className="mt-2 h-11 w-11 shrink-0 p-0"
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
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
