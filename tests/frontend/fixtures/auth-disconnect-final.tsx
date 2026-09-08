import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createConfig, createConnector, createStorage, useAccount, useConnect, useConnections, useDisconnect } from 'wagmi';
import { reconnect } from 'wagmi/actions';
import { base } from 'viem/chains';
import { custom, type Address } from 'viem';
import { disconnectWalletIdentity } from '@/lib/disconnect-wallet-identity';
import { allowWalletReconnect, useAuthCleanupPending, useWalletReconnectAllowed } from '@/lib/auth-cleanup';
import { SessionWagmiProvider } from '@/components/auth/session-wagmi-provider';
import { AuthCleanupRecovery } from '@/components/auth/auth-cleanup-recovery';
import { useMiniAppReconnect } from '@/hooks/useMiniAppReconnect';

const address: Address = document.getElementById('root')?.dataset.nextOwner === 'B'
  ? '0x2222222222222222222222222222222222222222' : '0x1111111111111111111111111111111111111111';
const params = new URLSearchParams(location.search);
let releaseDisconnect: (() => void) | undefined;
let rejectDisconnect: ((error: Error) => void) | undefined;
let disconnectHeld = params.has('hold-disconnect');
let connectHeld = false;
let releaseConnect: (() => void) | undefined;
let disconnectCalls = 0;
let connectCalls = 0;
let connectorConnected = false;
const provider = { request: async () => { throw new Error('Unexpected RPC in synthetic connector test'); } };
const connector = createConnector((config) => ({
  id: 'synthetic', name: 'Synthetic wallet', type: 'synthetic',
  async connect<Capabilities extends boolean = false>(options?: { withCapabilities?: Capabilities | boolean }) {
    if (connectHeld) await new Promise<void>(resolve => { releaseConnect = resolve; });
    connectorConnected = true;
    document.documentElement.dataset.connectCalls = String(++connectCalls);
    const accounts = options?.withCapabilities ? [{ address, capabilities: {} }] : [address];
    // TypeScript cannot narrow the generic conditional from its runtime flag.
    return { accounts: accounts as unknown as Capabilities extends true ? readonly { address: Address; capabilities: Record<string, unknown> }[] : readonly Address[], chainId: base.id };
  },
  async disconnect() {
    document.documentElement.dataset.disconnectCalls = String(++disconnectCalls);
    if (disconnectHeld) await new Promise<void>((resolve, reject) => { releaseDisconnect = resolve; rejectDisconnect = reject; });
    connectorConnected = false;
    config.emitter.emit('disconnect');
  },
  async getAccounts() { return connectorConnected ? [address] : []; },
  async getChainId() { return base.id; },
  async getProvider() { return provider; },
  async isAuthorized() { return true; },
  onAccountsChanged() {}, onChainChanged() {}, onDisconnect() { config.emitter.emit('disconnect'); },
}));
const storage = createStorage({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
const config = createConfig({ chains: [base], transports: { [base.id]: custom(provider) }, connectors: [connector], ssr: true, storage });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Wallet({ setResult }: { setResult: (result: string) => void }) {
  const account = useAccount();
  const connections = useConnections();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const cleanupPending = useAuthCleanupPending();
  const reconnectAllowed = useWalletReconnectAllowed();
  const [miniPending, setMiniPending] = useState(false);
  const [miniError, setMiniError] = useState<string | null>(null);
  const reconnectMiniApp = useMiniAppReconnect({ connectors, connect: current => connectAsync({ connector: current }), onPending: setMiniPending, onError: setMiniError });
  return <>
    <output aria-label="Wallet connection">{account.status}</output>
    <output aria-label="SDK connection count">{connections.length}</output>
    <output aria-label="Wallet address">{account.address ?? 'none'}</output>
    <output aria-label="Mini App error">{miniError ?? 'none'}</output>
    <output aria-label="Player connection">{reconnectAllowed && account.isConnected ? 'connected' : 'disconnected'}</output>
    <button disabled={cleanupPending} onClick={() => { if (allowWalletReconnect()) void connectAsync({ connector: connectors[0] }); }}>Connect wallet</button>
    <button disabled={cleanupPending || miniPending} onClick={() => void reconnectMiniApp()}>Reconnect Mini App</button>
    <button onClick={() => {
      setResult('pending');
      void disconnectWalletIdentity({ onStart() {}, disconnect: disconnectAsync, logout: params.has('hold-logout') ? () => new Promise<void>(() => {}) : undefined }).then(
        result => setResult(result === null ? 'busy' : result ? 'disconnected' : 'failed'),
        error => setResult(error instanceof Error ? error.message : 'failed'),
      );
    }}>Disconnect wallet</button>
  </>;
}
function App() {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState('idle');
  const [activeConfig, setActiveConfig] = useState(config);
  const pending = useAuthCleanupPending();
  return <QueryClientProvider client={queryClient}>
    <output aria-label="Cleanup status">{pending ? 'pending' : 'idle'}</output>
    <output aria-label="Disconnect result">{result}</output>
    <AuthCleanupRecovery />
    <button onClick={() => { disconnectHeld = false; releaseDisconnect?.(); }}>Release disconnect</button>
    <button onClick={() => { disconnectHeld = false; rejectDisconnect?.(new Error('Wallet refused disconnect')); }}>Reject disconnect</button>
    <button onClick={() => setVersion(value => value + 1)}>Remount provider</button>
    <button onClick={() => { connectHeld = true; }}>Hold next connect</button>
    <button onClick={() => { void reconnect(activeConfig); }}>Start queued provider reconnect</button>
    <button onClick={() => { connectHeld = false; releaseConnect?.(); }}>Release connect</button>
    <button onClick={() => { setActiveConfig(createConfig({ chains: [base], transports: { [base.id]: custom(provider) }, connectors: [connector], ssr: true, storage })); setVersion(value => value + 1); }}>Replace provider config</button>
    <SessionWagmiProvider key={version} config={activeConfig}><Wallet setResult={setResult} /></SessionWagmiProvider>
  </QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
