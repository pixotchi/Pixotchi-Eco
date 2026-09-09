import { Activity, useEffect, useRef, useState, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { ServerThemeProvider } from '@/components/server-theme-provider';
import { useTheme } from 'next-themes';
import { useGameNavigation } from '@/hooks/useGameNavigation';
import { useWebQueryState } from '@/hooks/useWebQueryState';
import { parseActivityViewState, useActivityViewState } from '@/hooks/useActivityViewState';
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
import type { Tab } from '@/lib/types';

const parameters = new URLSearchParams(location.search);
const snapshot: StatusSnapshot = { generatedAt: parameters.has('stale') ? '2020-01-01T00:00:00.000Z' : new Date().toISOString(), overall: 'operational', services: [{ id: 'app', label: 'Ecosystem App', status: 'operational' }] };

function FarmView() {
  const { dashboardView, setDashboardView, mintType } = useFarmView();
  return <><button onClick={() => setDashboardView('lands')}>Show lands</button><button onClick={() => setDashboardView('plants')}>Show plants</button><output aria-label="Farm view">{dashboardView}</output><button onClick={() => navigateToGameTab('mint', { mintType: 'land' })}>Mint a land</button><button onClick={() => navigateToGameTab('dashboard', { dashboardView: 'lands' })}>Go to my lands</button><output aria-label="Mint type">{mintType}</output></>;
}

type RankingFilter = 'all' | 'dead' | 'attackable';
function RankingView({ mini, pendingFilter }: { mini: boolean; pendingFilter: RefObject<(filter: RankingFilter) => void> }) {
  const [filter, setFilter] = useWebQueryState<RankingFilter>({ key: 'leaderboardFilter', defaultValue: 'all', enabled: !mini, parse: value => value === 'all' || value === 'dead' || value === 'attackable' ? value : null, serialize: value => value === 'all' ? null : value });
  const [page, setPage] = useWebQueryState({ key: 'leaderboardPage', defaultValue: 1, enabled: !mini, parse: value => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null, serialize: value => value <= 1 ? null : String(value) });
  useEffect(() => {
    // Retain this setter after Activity hides the panel, like a pending async
    // operation completing after navigation. It must not write into another tab.
    pendingFilter.current = setFilter;
  }, [pendingFilter, setFilter]);
  return <section aria-label="Ranking panel"><select aria-label="Ranking filter" value={filter} onChange={event => { setPage(1); setFilter(event.target.value as RankingFilter); }}><option value="all">All</option><option value="dead">Dead</option><option value="attackable">Attackable</option></select><output aria-label="Ranking page">{page}</output><button onClick={() => setPage(value => value + 1)}>Next ranking page</button><input aria-label="Ranking draft" defaultValue="" /></section>;
}

function ActivityView({ mini, activeTab }: { mini: boolean; activeTab: Tab }) {
  const { feeds, setPage, setCategory, setDirection, reset } = useActivityViewState(!mini);
  const [view, setView] = useWebQueryState<'all' | 'my'>({ key: 'activityView', defaultValue: 'all', enabled: !mini, parse: value => value === 'all' || value === 'my' ? value : null, serialize: value => value === 'all' ? null : value });
  const [historyMismatch, setHistoryMismatch] = useState<string | null>(null);
  useEffect(() => {
    if (mini || activeTab !== 'activity') return;
    const params = new URLSearchParams(location.search);
    if (params.get('tab') !== 'activity') return;
    const expected = parseActivityViewState(params.get('activityFeeds'), params);
    // Consumer effects (such as pagination clamping) must see the restored
    // history entry immediately, before they can write a stale retained value.
    if (JSON.stringify(feeds) !== JSON.stringify(expected)) {
      setHistoryMismatch(`Observed ${JSON.stringify(feeds)} while the URL described ${JSON.stringify(expected)}`);
    }
  }, [activeTab, feeds, mini]);
  return <section aria-label="Activity panel"><output aria-label="Activity feeds">{JSON.stringify(feeds)}</output><output aria-label="Activity history mismatch">{historyMismatch ?? 'none'}</output><select aria-label="Activity scope" value={view} onChange={event => setView(event.target.value as 'all' | 'my')}><option value="all">All</option><option value="my">Mine</option></select><button onClick={() => setPage('my', value => value + 1)}>Next personal activity page</button><button onClick={() => setCategory('all', 'casino')}>Show casino activity</button><button onClick={() => { setCategory('my', 'attacks'); setDirection('my', 'incoming'); }}>Show incoming attacks</button><button onClick={() => { reset('all'); reset('my'); setView('all'); }}>Reset activity</button></section>;
}

function Navigation() {
  const mini = parameters.has('mini');
  const { activeTab, setActiveTab, contentScrollRef, onContentScroll } = useGameNavigation(mini);
  const [connected, setConnected] = useState(false);
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set([activeTab]));
  const pendingFilter = useRef<(filter: RankingFilter) => void>(() => {});
  if (!visited.has(activeTab)) setVisited(new Set(visited).add(activeTab));
  // Match the app: the navigation hook mounts before the connected Farm provider.
  useEffect(() => setConnected(true), []);
  return <><button onClick={() => setActiveTab('dashboard')}>Farm</button><button onClick={() => setActiveTab('mint')}>Mint</button><button onClick={() => setActiveTab('swap')}>Swap</button><button onClick={() => setActiveTab('leaderboard')}>Ranking</button><button onClick={() => setActiveTab('activity')}>Activity</button><button onClick={() => pendingFilter.current('attackable')}>Complete background Ranking change</button><output aria-label="Active tab">{activeTab}</output>{connected && <FarmViewProvider isMiniApp={mini}><FarmView /><Activity mode={activeTab === 'leaderboard' ? 'visible' : 'hidden'}>{visited.has('leaderboard') && <RankingView mini={mini} pendingFilter={pendingFilter} />}</Activity><Activity mode={activeTab === 'activity' ? 'visible' : 'hidden'}>{visited.has('activity') && <ActivityView mini={mini} activeTab={activeTab} />}</Activity><div ref={contentScrollRef} onScroll={onContentScroll} data-testid="scroller" style={{ height: 150, overflow: 'auto' }}><div style={{ height: 1200 }}>{activeTab} content</div></div></FarmViewProvider>}</>;
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
