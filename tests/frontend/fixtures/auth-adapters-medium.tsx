import { useCallback, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useBaseAuthAdapter } from '@/hooks/useBaseAuthAdapter';
import { useBaseWalletAuthentication } from '@/hooks/useBaseWalletAuthentication';
import { usePrivyAuthAdapter } from '@/hooks/usePrivyAuthAdapter';
import { initialAuthState, authReducer } from '@/lib/auth-controller-state';
import { beginAuthCleanup } from '@/lib/auth-cleanup';
import { sessionStorageManager } from '@/lib/session-storage-manager';
import { completePrivy, rejectPrivy } from './auth-adapters-privy-mock';

const params = new URLSearchParams(location.search);
const address = '0x1111111111111111111111111111111111111111';
const mode = params.get('mode');
const signature = `0x${'ab'.repeat(65)}`;
const capability = () => ({ accounts: [{ address, capabilities: { signInWithEthereum: { message: 'reviewed-sign-in-message', signature: mode === 'malformed' ? 'invalid-signature' : signature } } }] });
const rpcCalls: string[] = [];
const connector = { id: 'baseAccount', name: 'Base', getProvider: async () => ({
  request: async ({ method }: { method: string }) => {
    rpcCalls.push(method); document.documentElement.dataset.rpc = rpcCalls.join(',');
    if (method === 'eth_accounts') return [address];
    if (method === 'wallet_connect') return capability();
    if (method === 'personal_sign') {
      if (mode === 'timeout') return new Promise<never>(() => {});
      return signature;
    }
    throw new Error('Unexpected RPC');
  },
}) };
let releaseSignature: (() => void) | undefined;
const heldSignature = new Promise<void>(resolve => { releaseSignature = resolve; });
const connect = async () => {
  if (mode === 'held-signature') await heldSignature;
  if (mode === 'fallback' || mode === 'timeout') throw Object.assign(new Error('wallet_connect not supported'), { code: 4200 });
  if (mode === 'rpc') return { accounts: [address] };
  return capability();
};
function BaseAdapter() {
  const [status, setStatus] = useState('idle');
  const [authenticatedAddress, setAddress] = useState('none');
  const { completeBaseAuthentication, completeLegacyBaseAuthentication } = useBaseWalletAuthentication({ connectAsync: connect, normalizedAddress: null, surface: 'base', persistBaseAuthenticatedAddress: async value => setAddress(value ?? 'none') });
  return <><output aria-label="Adapter status">{status}</output><output aria-label="Authenticated address">{authenticatedAddress}</output>
    <button onClick={() => releaseSignature?.()}>Release signature</button>
    <button onClick={() => { const release = beginAuthCleanup(); release?.(); }}>Invalidate sign-in</button>
    <button onClick={() => { setStatus('pending'); void (mode === 'legacy' ? completeLegacyBaseAuthentication(connector) : completeBaseAuthentication(connector)).then(() => setStatus('ready'), error => setStatus(error.message)); }}>Authenticate Base</button></>;
}
function PrivyAdapter() {
  const surface = params.has('solana') ? 'privysolana' : 'privy';
  const [state, dispatch] = useReducer(authReducer, { ...initialAuthState, surface, surfaceInitialized: true, expectedPrivyAddress: params.has('owner') ? address : null });
  const adapter = usePrivyAuthAdapter({ state, dispatch, isMiniApp: false, normalizedAddress: params.has('owner') ? address : null, isEvmConnected: params.has('owner'), disconnect: async () => {} });
  return <><output aria-label="Expected address">{state.expectedPrivyAddress ?? 'none'}</output><output aria-label="Auth error">{state.errorState ?? 'none'}</output>
    <button onClick={() => { beginAuthCleanup(); void adapter.persistPrivyAuthenticatedAddress(null); }}>Hold identity cleanup</button>
    <button onClick={() => completePrivy(address)}>Complete Privy</button><button onClick={rejectPrivy}>Reject Privy</button>
    <button onClick={() => { const release = beginAuthCleanup(); release?.(); }}>Invalidate old login</button></>;
}
const fixtureConnectors = [connector];
function BaseController() {
  const [state, dispatch] = useReducer(authReducer, { ...initialAuthState, surface: 'base' as const, surfaceInitialized: true });
  const [owner, setOwner] = useState<string | null>(null);
  const disconnect = useCallback(async () => setOwner(null), []);
  const connectOwner = useCallback(async () => { setOwner(address); if (params.has('hold')) await heldSignature; return capability(); }, []);
  const adapter = useBaseAuthAdapter({ state, dispatch, isMiniApp: false, normalizedAddress: owner, isEvmConnected: Boolean(owner), isWalletConnecting: false, isWalletReconnecting: false, connectors: fixtureConnectors, connectAsync: connectOwner, disconnect });
  return <><output aria-label="Base status">{state.baseAuthStatus}</output><output aria-label="Base error">{state.errorState ?? 'none'}</output><output aria-label="Base owner">{owner ?? 'none'}</output><output aria-label="Base identity">{state.baseAuthenticatedAddress ?? 'none'}</output><button disabled={adapter.isBaseAuthPending}>Connect again</button>
    <button onClick={() => releaseSignature?.()}>Release signature</button><button onClick={() => setOwner('0x2222222222222222222222222222222222222222')}>Switch owner</button></>;
}
async function mount() {
  if (params.has('owner')) await sessionStorageManager.setPrivyAuthenticatedAddress(address);
  if (params.has('controller')) await sessionStorageManager.setAuthSurfaceAndAutologin('base');
  if (params.has('privy')) await sessionStorageManager.setAuthSurfaceAndAutologin(params.has('solana') ? 'privysolana' : 'privy');
  createRoot(document.getElementById('root')!).render(params.has('controller') ? <BaseController /> : params.has('privy') ? <PrivyAdapter /> : <BaseAdapter />);
}
void mount();
