import { useSyncExternalStore } from 'react';

export const A = '0x1111111111111111111111111111111111111111';
export const B = '0x2222222222222222222222222222222222222222';
let owner: string | undefined = A;
let visible = true;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setFixtureOwner(value: string | undefined) { owner = value; listeners.forEach(listener => listener()); }
export function setFixtureVisible(value: boolean) { visible = value; listeners.forEach(listener => listener()); }
export function useAccount() { return { address: useSyncExternalStore(subscribe, () => owner), isConnected: Boolean(owner) }; }
let signatures = 0;
export const useSignMessage = () => ({ signMessageAsync: async () => { signatures += 1; listeners.forEach(listener => listener()); return '0x1234'; } });
export const useFixtureSignatures = () => useSyncExternalStore(subscribe, () => signatures);
export function useTabVisibility() { const current = useSyncExternalStore(subscribe, () => visible); return { isTabVisible: () => current }; }
export const useIsSolanaWallet = () => false;
export const useTwinAddress = () => undefined;
export const useSolanaWallet = () => ({ effectiveAddress: undefined, solanaAddress: undefined });
export const useFrameContext = () => ({ isInMiniApp: false });
const getAccessToken = async () => 'fixture';
export const usePrivy = () => ({ ready: true, authenticated: true, getAccessToken });
export const useIdentityToken = () => ({ identityToken: 'fixture' });
export const useItemCatalogs = () => ({ shopItems: [], gardenItems: [] });
export const useTokenMetadata = () => ({ symbol: 'SEED', decimals: 18, isReady: true });
export const usePrimaryName = () => ({ name: 'Another player' });
export const postMissionProgress = async () => {};
export const useSmartWallet = () => ({ walletType: 'fixture', isSmartWallet: false });
export const useSlideshow = () => ({ start: () => {}, enabled: true });
export const ADDRESS_REGEX = /^0x[0-9a-f]{40}$/i;
export const CREATOR_TOKEN_ADDRESS = A;
export const CRYPTICPOET_TOKEN_ADDRESS = A;
export const JESSE_TOKEN_ADDRESS = A;
export const LEAF_CONTRACT_ADDRESS = A;
export const PIXOTCHI_TOKEN_ADDRESS = A;
export const PUBLIC_CHAT_SESSION_EVENT = 'fixture-session';
export const getCurrentPublicChatSessionForAddress = async (address: string) => new URLSearchParams(location.search).get('missingForA') === '1' && address === A ? null : ({ address, authenticated: true, provider: 'base', method: 'base-siwe' });
export const createBasePublicChatSession = async ({ address }: { address: string }) => getCurrentPublicChatSessionForAddress(address);
export const createFarcasterPublicChatSession = async ({ expectedAddress }: { expectedAddress: string }) => getCurrentPublicChatSessionForAddress(expectedAddress);
export const createPrivyPublicChatSession = createFarcasterPublicChatSession;
export const clearPublicChatSession = async () => {};
export const getMiniAppQuickAuthHeaders = async ({ expectedAddress }: { expectedAddress: string }) => ({ 'x-fixture-owner': expectedAddress });
const recoveries: ((result: { status: 'error'; message: string }) => void)[] = [];
export const requestBaseChatSessionRefresh = () => new Promise(resolve => { recoveries.push(resolve); listeners.forEach(listener => listener()); });
export const useFixtureRecoveryCount = () => useSyncExternalStore(subscribe, () => recoveries.length);
export function failFixtureRecovery() { recoveries.at(-1)?.({ status: 'error', message: 'Fixture recovery failed' }); }
/* eslint-disable @next/next/no-img-element -- External image delivery is not under test. */
export default function Image({ src, alt, width, height, className }: { src: string; alt: string; width?: number; height?: number; className?: string }) { return <img src={src} alt={alt} width={width} height={height} className={className} />; }
