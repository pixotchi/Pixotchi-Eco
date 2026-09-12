'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle, FileText, Gift, RefreshCw, Shield, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAdminRead } from '@/hooks/useAdminRead';
import { parseAdminAirdrop, parseAdminOperation } from '@/lib/admin-api-data';
import { toast } from 'react-hot-toast';
import { type AdminSectionProps, AdminReadError } from './admin-section-shared';

const AIRDROP_ACTION_CLASS = 'h-auto min-h-11 max-w-full whitespace-normal px-[min(1rem,4vw)] leading-snug [&>svg]:shrink-0';

export function AdminAirdropSection({ adminKey, isActive, showConfirmDialog }: AdminSectionProps) {
  const { data: airdropData, loading: readLoading, error: readError, reload } = useAdminRead({ adminKey, isActive, endpoint: '/api/airdrop/manage', parse: parseAdminAirdrop, label: 'Airdrop' });
  const [mutationLoading, setAirdropLoading] = useState(false);
  const airdropLoading = readLoading || mutationLoading;
  const [airdropCsv, setAirdropCsv] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isActive) return null;
  return (<div className="space-y-6">
    <AdminReadError message={readError} onRetry={reload} busy={readLoading} />
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <h2 className="min-w-0 text-2xl font-bold [overflow-wrap:anywhere]">Airdrop Management</h2>
      <div className="flex max-w-full flex-wrap gap-2">
        <Button
          variant="outline"
          className={AIRDROP_ACTION_CLASS}
          onClick={reload}
          disabled={airdropLoading}
        >
          <RefreshCw className={`w-4 h-4 ${airdropLoading ? 'animate-spin' : ''}`} />
          <span className="min-w-0 [overflow-wrap:anywhere]">Refresh</span>
        </Button>
        {airdropData?.recipients && airdropData.recipients.length > 0 && (
          <Button
            variant="destructive"
            className={AIRDROP_ACTION_CLASS}
            onClick={() => showConfirmDialog({
              title: 'Clear unattempted allocations?',
              description: 'Remove unclaimed allocations that have never been attempted? Claim history will be preserved.',
              confirmText: 'Clear Unattempted',
              isDangerous: true,
              onConfirm: async () => {
                if (airdropLoading) return;
                setAirdropLoading(true);
                try {
                  const res = await fetch('/api/airdrop/manage', {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${adminKey}` }
                  });
                  const data = parseAdminOperation(await res.json());
                  if (res.ok && data?.success) {
                    toast.success(`Removed ${data.deletedCount ?? 0}; preserved ${data.protectedCount ?? 0} claim records; ${data.conflictCount ?? 0} concurrent changes skipped`);
                    await reload();
                  } else {
                    toast.error('Failed to clear airdrop data');
                  }
                } catch {
                  toast.error('Failed to clear airdrop data');
                } finally {
                  setAirdropLoading(false);
                }
              },
            })}
            disabled={airdropLoading}
          >
            <Trash2 className="w-4 h-4" />
            <span className="min-w-0 [overflow-wrap:anywhere]">Clear Unattempted</span>
          </Button>
        )}
      </div>
    </div>

    {/* Upload CSV */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Upload Eligibility List
        </CardTitle>
        <CardDescription>
          CSV format: address,seed,leaf,pixotchi (amounts in tokens, not wei)
          {' '}Replaces unattempted allocations. Existing claim history is preserved, including recipients omitted from the CSV.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder={`address,seed,leaf,pixotchi
0x123...,100,50,0
0x456...,0,200,10`}
          aria-label="Eligibility list CSV"
          value={airdropCsv}
          onChange={(e) => setAirdropCsv(e.target.value)}
          rows={6}
          className="font-mono text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            className={AIRDROP_ACTION_CLASS}
            onClick={async () => {
              if (!airdropCsv.trim()) {
                toast.error('Please enter CSV data');
                return;
              }
              setAirdropLoading(true);
              try {
                const res = await fetch('/api/airdrop/manage', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminKey}`
                  },
                  body: JSON.stringify({ csv: airdropCsv })
                });
                const data = parseAdminOperation(await res.json());
                if (!data) throw new Error('Response could not be read. Reload to check the result.');
                if (res.ok && data.success && data.totalRecipients !== undefined) {
                  toast.success(`Saved ${(data.createdCount ?? 0) + (data.updatedCount ?? 0)} allocations; preserved ${data.protectedCount ?? 0} claim records; ${data.conflictCount ?? 0} concurrent changes skipped`);
                  setAirdropCsv('');
                  // Refresh data
                  await reload();
                } else {
                  toast.error(data.error || 'Upload failed');
                  if (data.validationErrors?.length) {
                    console.error('Validation errors:', data.validationErrors);
                  }
                }
              } catch {
                toast.error('Upload failed');
              } finally {
                setAirdropLoading(false);
              }
            }}
            disabled={airdropLoading || !airdropCsv.trim()}
          >
            <Upload className="w-4 h-4" />
            <span className="min-w-0 [overflow-wrap:anywhere]">Upload CSV</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            aria-label="Eligibility CSV file"
            disabled={airdropLoading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  setAirdropCsv(typeof ev.target?.result === 'string' ? ev.target.result : '');
                };
                reader.onerror = () => toast.error('Could not read this file. Please choose it again.');
                reader.readAsText(file);
              }
            }}
          />
          <Button type="button" variant="outline" className={AIRDROP_ACTION_CLASS} disabled={airdropLoading} onClick={() => fileInputRef.current?.click()}>
            <FileText className="w-4 h-4" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">Load File</span>
          </Button>
        </div>
      </CardContent>
    </Card>

    {/* Server Wallet Status */}
    {airdropData?.meta?.balances && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(['SEED', 'LEAF', 'PIXOTCHI'] as const).map((token) => {
          const key = token.toLowerCase() as 'seed' | 'leaf' | 'pixotchi';
          const balance = parseFloat(airdropData.meta.balances?.[key] || '0');
          const remaining = airdropData.meta.requirements?.[key]?.remaining || 0;
          const isInsufficient = balance < remaining;

          return (
            <Card key={token} className={isInsufficient ? 'border-destructive/50' : ''}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  {token} Balance
                  {isInsufficient && <AlertTriangle className="w-4 h-4 text-destructive" />}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{balance.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1 space-y-1">
                  <div className="flex justify-between">
                    <span>Total Needed:</span>
                    <span className="font-medium text-foreground">
                      {airdropData.meta.requirements?.[key]?.total.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Remaining:</span>
                    <span className={`font-medium ${isInsufficient ? 'text-destructive' : 'text-foreground'}`}>
                      {remaining.toLocaleString()}
                    </span>
                  </div>
                  {isInsufficient && (
                    <div className="text-destructive font-semibold text-[10px] mt-1">
                      Insufficient funds! Need {(remaining - balance).toLocaleString()} more.
                    </div>
                  )}
                </div>
                <ProgressBar
                  label={`${token} airdrop funding`}
                  value={Number.isFinite(balance) ? (balance / (remaining || 1)) * 100 : 0}
                  className={`mt-3 h-1.5 border-0 bg-muted shadow-none [&>div]:bg-none [&>div]:shadow-none ${isInsufficient ? '[&>div]:bg-destructive' : '[&>div]:bg-primary'}`}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    )}

    {/* Stats & Recipients */}
    {airdropData && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Recipients ({airdropData.recipients?.length || 0})</span>
            <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <Shield className="w-3 h-3" />
              <span className="font-mono">{airdropData.meta?.serverWallet}</span>
            </div>
          </CardTitle>
          {airdropData.meta && (
            <CardDescription>
              Claimed: {airdropData.meta.claimedCount || 0} / {airdropData.meta.totalRecipients || 0}
              {airdropData.meta.uploadedAt && (
                <span className="ml-2 text-xs">
                  • Uploaded {formatDistanceToNow(airdropData.meta.uploadedAt, { addSuffix: true })}
                </span>
              )}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {airdropData.recipients?.length > 0 ? (
            <ScrollArea className="space-y-2 max-h-[400px] overflow-y-auto">
              <div className="grid grid-cols-6 gap-2 text-xs font-medium text-muted-foreground sticky top-0 bg-background py-2 border-b">
                <div className="col-span-2">Address</div>
                <div>SEED</div>
                <div>LEAF</div>
                <div>PIXOTCHI</div>
                <div>Status</div>
              </div>
              {airdropData.recipients.map((r) => (
                <div key={r.address} className="grid grid-cols-6 gap-2 text-sm py-2 border-b border-border/50 hover:bg-muted/50">
                  <div className="col-span-2 font-mono text-xs truncate" title={r.address}>
                    {r.address.slice(0, 8)}...{r.address.slice(-6)}
                  </div>
                  <div>{r.seed}</div>
                  <div>{r.leaf}</div>
                  <div>{r.pixotchi}</div>
                  <div>
                    {r.claimed ? (
                      <span className="text-[hsl(var(--success-strong))] flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Claimed
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Pending</span>
                    )}
                  </div>
                </div>
              ))}
            </ScrollArea>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Gift className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No airdrop data loaded</p>
              <p className="text-sm">Upload a CSV to get started</p>
            </div>
          )}
        </CardContent>
      </Card>
    )}
  </div>);
}
