import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { ServerThemeProvider } from '@/components/server-theme-provider';
import { useTheme } from 'next-themes';
import { useGameNavigation } from '@/hooks/useGameNavigation';
import { useWebQueryState } from '@/hooks/useWebQueryState';
import { FarmViewProvider, useFarmView } from '@/lib/farm-view-context';
import { navigateToGameTab } from '@/lib/game-navigation';
import { clearAuthCaches } from '@/lib/cache-utils';
import { sessionStorageManager } from '@/lib/session-storage-manager';
import { StatusPageClient } from '@/components/status/StatusPageClient';
import { LoginAuthActions } from '@/components/auth/login-auth-actions';
import { HostWalletBoundary } from '@/components/auth/host-wallet-boundary';
import { disconnectWalletIdentity } from '@/lib/disconnect-wallet-identity';
import { SolanaBootstrapGate } from '@/components/auth/solana-bootstrap-gate';
import { ThemedPrivyProvider } from '@/components/auth/themed-privy-provider';
import { useSolanaBootstrap } from '@/hooks/useSolanaBootstrap';
import { useMiniAppReconnect } from '@/hooks/useMiniAppReconnect';
import { initialAuthState } from '@/lib/auth-controller-state';
import { createRetryableTab } from '@/components/retryable-tab';
import AdminDashboard from '@/app/admin/page';
import BalanceCard from '@/components/balance-card';
import type { StatusSnapshot } from '@/lib/status-snapshot';

const parameters = new URLSearchParams(location.search);
const snapshot: StatusSnapshot = { generatedAt: parameters.has('stale') ? '2020-01-01T00:00:00.000Z' : new Date().toISOString(), overall: 'operational', services: [{ id: 'app', label: 'Ecosystem App', status: 'operational' }] };

function FarmView() {
  const { dashboardView, setDashboardView, mintType, setMintType } = useFarmView();
  return <><button onClick={() => setDashboardView('lands')}>Show lands</button><output aria-label="Farm view">{dashboardView}</output><button onClick={() => { setMintType('land'); navigateToGameTab('mint'); }}>Mint a land</button><output aria-label="Mint type">{mintType}</output></>;
}
function Navigation() {
  const mini = parameters.has('mini');
  const { activeTab, setActiveTab, contentScrollRef, onContentScroll } = useGameNavigation(mini);
  const [filter, setFilter] = useWebQueryState({ key: 'leaderboardFilter', defaultValue: 'all', enabled: !mini, parse: value => value, serialize: value => value === 'all' ? null : value });
  return <><button onClick={() => setActiveTab('dashboard')}>Farm</button><button onClick={() => setActiveTab('swap')}>Swap</button><button onClick={() => setActiveTab('leaderboard')}>Ranking</button><output aria-label="Active tab">{activeTab}</output><input aria-label="Ranking filter" value={filter} onChange={event => setFilter(event.target.value)} /><FarmViewProvider isMiniApp={mini}><FarmView /><div ref={contentScrollRef} onScroll={onContentScroll} data-testid="scroller" style={{ height: 150, overflow: 'auto' }}><div style={{ height: 1200 }}>{activeTab} content</div></div></FarmViewProvider></>;
}

function Auth() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settle, setSettle] = useState<{ resolve: () => void; reject: () => void } | null>(null);
  const [calls, setCalls] = useState(0);
  const connect = () => { setCalls(value => value + 1); return new Promise<void>((resolve, reject) => setSettle({ resolve, reject: () => reject(new Error('Wallet declined sign-in.')) })); };
  const retry = useMiniAppReconnect({ connectors: [{ id: 'farcaster', name: 'Farcaster' }], connect, onPending: setPending, onError: setError });
  return <><LoginAuthActions className="auth-actions" handleMiniAppReconnect={retry} isInMiniApp={!parameters.has('web')} state={{ ...initialAuthState, isMiniConnectRetrying: pending, errorState: error }} isWalletPending={false} isRestoringBaseSession={false} localTestAuthAvailable={false} privyReady switchAuthSurface={async () => { throw new Error('Sign-in service unavailable.'); }} /><output aria-label="Connect calls">{calls}</output><button onClick={() => settle?.resolve()}>Complete sign-in</button><button onClick={() => settle?.reject()}>Reject sign-in</button></>;
}
function DisconnectRace() {
  const [wallet, setWallet] = useState('A');
  const [done, setDone] = useState(false);
  const reconnect = useMiniAppReconnect({ connectors: [{ id: 'farcaster', name: 'Farcaster' }],
    connect: async () => { localStorage.setItem('wagmi.store', 'wallet-B'); sessionStorage.setItem('privy:token', 'wallet-B'); setWallet('B'); },
    onPending: () => {}, onError: () => {} });
  return <><output aria-label="Wallet">{wallet}</output><output aria-label="Cleanup finished">{String(done)}</output>
    <button onClick={() => void disconnectWalletIdentity({ onStart: () => setWallet('disconnected') }).then(() => setDone(true))}>Disconnect identity</button>
    <button onClick={() => void reconnect()}>Attempt direct reconnect</button>
    <LoginAuthActions className="" handleMiniAppReconnect={reconnect} isInMiniApp state={initialAuthState} isWalletPending={false} isRestoringBaseSession={false} localTestAuthAvailable={false} privyReady switchAuthSurface={async () => {}} /></>;
}
let bootstrapAttempts = 0;
async function bootstrap() { bootstrapAttempts++; if (bootstrapAttempts === 1) throw new Error('Chunk unavailable'); return { hasUsableConnectors: true }; }
function Bootstrap() {
  const { state, retry } = useSolanaBootstrap(true, true, bootstrap);
  const [alternate, setAlternate] = useState(false);
  return alternate ? <p>Ethereum selected explicitly</p> : <SolanaBootstrapGate state={state} onRetry={retry} onUseEthereum={() => setAlternate(true)}><p>Solana wallets ready</p></SolanaBootstrapGate>;
}
let tabAttempts = 0;
const RetryTab = createRetryableTab(async () => { tabAttempts++; if (tabAttempts === 1) throw new Error('Chunk unavailable'); return { default: () => <p>Farm loaded successfully</p> }; }, 'Farm');
function ThemeRegistry() {
  const { themes } = useTheme();
  return <output aria-label="Available themes">{themes.join(',')}</output>;
}
function Fixture() {
  switch (parameters.get('scenario')) {
    case 'cache': return <button onClick={async () => { await sessionStorageManager.clearAuthState(); await clearAuthCaches(); }}>Disconnect</button>;
    case 'status': return <StatusPageClient initialSnapshot={snapshot} refreshMinutes={0} showManualRefresh />;
    case 'auth': return <Auth />;
    case 'bootstrap': return <Bootstrap />;
    case 'host-boundary': return <HostWalletBoundary state="unavailable" onRetry={() => {}} onUseEthereum={() => {}}><p>Host wallet mounted</p></HostWalletBoundary>;
    case 'disconnect-race': return <DisconnectRace />;
    case 'theme-registry': return <ServerThemeProvider><ThemeRegistry /></ServerThemeProvider>;
    case 'theme': return <ThemeProvider forcedTheme={parameters.get('theme') ?? 'light'}><ThemedPrivyProvider appId="test"><p>Wallet dialog</p></ThemedPrivyProvider></ThemeProvider>;
    case 'retry': return <><input aria-label="Retained draft" defaultValue="keep this" /><RetryTab /></>;
    case 'admin': return <AdminDashboard />;
    case 'balances': return <BalanceCard variant="wallet-profile" />;
    default: return <Navigation />;
  }
}
createRoot(document.getElementById('root')!).render(<Fixture />);
