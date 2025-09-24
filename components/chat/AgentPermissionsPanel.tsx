'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAccount } from 'wagmi';
import { createBaseAccountSDK } from '@base-org/account';
import { getRpcConfig } from '@/lib/env-config';
import { createPublicClient, http, parseUnits } from 'viem';
import { base as baseChain } from 'viem/chains';

type PermissionSummary = { 
  token?: string; 
  allowance?: string; 
  periodInDays?: number;
  tokenSymbol?: string;
  allowanceFormatted?: string;
  permissionHash?: string;
};

export default function AgentPermissionsPanel() {
  const { address } = useAccount();
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<PermissionSummary | null>(null);
  const [agentReady, setAgentReady] = useState(false);
  const [spender, setSpender] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<bigint | null>(null);
  const [periodSeconds, setPeriodSeconds] = useState<number | null>(null);
  const [allowanceInput, setAllowanceInput] = useState<string>('');
  
  // Minimal ERC-20 ABI for decimals
  const erc20Abi = [{
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  }] as const;

  async function getTokenDecimals(token: `0x${string}`): Promise<number> {
    try {
      const { endpoints } = getRpcConfig();
      const rpcUrl = endpoints[0];
      const client = createPublicClient({ chain: baseChain, transport: http(rpcUrl) });
      const decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' });
      return Number(decimals);
    } catch {
      return 18;
    }
  }

  const refresh = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const conf = await fetch('/api/agent/config').then(r => r.json()).catch(() => null);
      setAgentReady(Boolean(conf?.agentConfigured));
      const wallet = await fetch('/api/agent/wallet', { method: 'GET' }).then(r => r.json()).catch(() => null);
      if (wallet?.smartAccountAddress) setSpender(wallet.smartAccountAddress);
      if (wallet?.smartAccountAddress) {
        const sdk = createBaseAccountSDK({ appName: 'Pixotchi Agent' } as any);
        const provider = sdk.getProvider();
        try { await provider.request({ method: 'eth_requestAccounts' }); } catch {}
        try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }); } catch {}
        const { fetchPermissions, getPermissionStatus } = await import('@base-org/account/spend-permission' as any);
        const permissions = await fetchPermissions({ account: address as `0x${string}`, chainId: 8453, spender: wallet.smartAccountAddress as `0x${string}`, provider });
        const perm = (permissions as any[])[0] || null;
        setSummary(perm);
        if (perm) {
          try {
            const status = await getPermissionStatus(perm);
            // remainingSpend is in token smallest units
            setRemaining(status?.remainingSpend ?? null);
            setPeriodSeconds(status?.periodRemainingSeconds ?? null);
          } catch {}
        } else {
          setRemaining(null);
          setPeriodSeconds(null);
        }
      } else {
        setSummary(null);
      }
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [address]);

  const formatToken = (wei?: bigint | null) => {
    if (!wei) return '0';
    try { return (Number(wei) / 1e18).toString(); } catch { return '0'; }
  };

  const allowanceNum = (() => {
    try { return summary?.allowanceFormatted ? Number(summary.allowanceFormatted) : undefined; } catch { return undefined; }
  })();

  const usedToday = (() => {
    if (allowanceNum === undefined || remaining == null) return undefined;
    const rem = Number(remaining) / 1e18;
    const used = Math.max(0, allowanceNum - rem);
    return used;
  })();

  const timeLeft = (() => {
    if (periodSeconds == null) return '';
    const s = Math.max(0, periodSeconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  })();

  const allowanceDisplay = summary?.allowanceFormatted
    ? `${summary.allowanceFormatted} ${summary.tokenSymbol || 'SEED'}/day`
    : `0 ${summary?.tokenSymbol || 'SEED'}/day`;

  return (
    <div className="px-3">
      <div className="rounded-md border border-border bg-muted/40 px-2 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground truncate">
            {agentReady ? (
              summary ? (
                <div className="flex flex-col gap-1">
                  <div className="text-foreground">Agent: <span className="font-mono">{spender?.slice(0,6)}...{spender?.slice(-4)}</span></div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-green-600 dark:text-green-400">Daily: {allowanceDisplay}</span>
                    {remaining != null && (
                      <span>Remaining: {formatToken(remaining)} {summary?.tokenSymbol || 'SEED'}</span>
                    )}
                    {usedToday !== undefined && (
                      <span>Used: {usedToday.toFixed(6)} {summary?.tokenSymbol || 'SEED'}</span>
                    )}
                    {periodSeconds != null && (
                      <span>Resets in: {timeLeft}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="text-foreground">Agent: <span className="font-mono">{spender?.slice(0,6)}...{spender?.slice(-4)}</span></div>
                  <div className="flex items-center gap-3">
                    <span>Daily: {allowanceDisplay}</span>
                    <span>No active spend permission.</span>
                  </div>
                </div>
              )
            ) : (
              <>Agent backend not configured.</>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="px-2 py-0.5 text-xs leading-none btn-compact" onClick={refresh} disabled={loading || busy}>Refresh</Button>
            {summary ? (
              <Button size="sm" variant="destructive" className="px-2 py-0.5 text-xs leading-none btn-compact" disabled={busy}
                onClick={async () => {
                  if (!summary) return;
                  try {
                    setBusy(true);
                    const sdk = createBaseAccountSDK({ appName: 'Pixotchi Agent' } as any);
                    const provider = sdk.getProvider();
                    try { await provider.request({ method: 'eth_requestAccounts' }); } catch {}
                    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }); } catch {}
                    const { requestRevoke } = await import('@base-org/account/spend-permission' as any);
                    await requestRevoke({ permission: summary, provider } as any);
                    await refresh();
                  } finally { setBusy(false); }
                }}>Revoke</Button>
            ) : null}
          </div>
        </div>

        {!summary && agentReady && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={allowanceInput}
              onChange={(e) => setAllowanceInput(e.target.value)}
              placeholder="Allowance (SEED/day)"
              className="h-8 text-xs"
            />
            <Button size="sm" className="px-2 py-0.5 text-xs leading-none btn-compact" disabled={!address || !agentReady || !spender || busy}
              onClick={async () => {
                if (!address || !spender) return;
                try {
                  setBusy(true);
                  const SEED = '0x546D239032b24eCEEE0cb05c92FC39090846adc7' as `0x${string}`;
                  const decimals = await getTokenDecimals(SEED);
                  let allowance = parseUnits('200', decimals);
                  if (allowanceInput && !isNaN(Number(allowanceInput))) {
                    allowance = parseUnits(String(allowanceInput), decimals);
                  } else {
                    try {
                      const suggestionResponse = await fetch('/api/agent/config/suggest-allowance?mintsPerDay=10&strainId=1');
                      if (suggestionResponse.ok) {
                        const suggestion = await suggestionResponse.json();
                        allowance = BigInt(suggestion.allowanceInWei);
                      }
                    } catch {}
                  }
                  const sdk = createBaseAccountSDK({ appName: 'Pixotchi Agent' } as any);
                  const provider = sdk.getProvider();
                  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }); } catch {}
                  const { requestSpendPermission } = await import('@base-org/account/spend-permission' as any);
                  await requestSpendPermission({
                    account: address as `0x${string}`,
                    spender: spender as `0x${string}`,
                    token: SEED,
                    chainId: 8453,
                    allowance,
                    periodInDays: 1,
                    provider,
                  });
                  await refresh();
                } finally { setBusy(false); }
              }}>Grant</Button>
          </div>
        )}
      </div>
    </div>
  );
}


