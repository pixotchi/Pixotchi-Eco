import type { ReactNode } from 'react';
export const useIsSolanaWallet = () => false;
const refresh = async () => {};
export const useAccount = () => ({ address: '0x1111111111111111111111111111111111111111' });
export const useBalance = () => ({ data: { value: BigInt("1234567890123456789"), decimals: 18 }, isLoading: false, isError: false, refetch: refresh });
export const useBalances = () => ({ seedBalance: BigInt("1000000000000000001"), leafBalance: BigInt("2000000000000000000"), pixotchiBalance: BigInt("3000000000000000000"), loading: false, seedBalanceStatus: 'ready', leafBalanceStatus: 'ready', pixotchiBalanceStatus: 'ready', refreshBalances: refresh });
export const useSolanaWallet = () => ({ solBalance: BigInt("0"), isLoading: false, refresh });
export const getStakeInfo = async () => ({ staked: BigInt("4000000000000000000"), rewards: BigInt("5000000000000000000") });
export const getPlantsByOwner = async () => [];
export const getLandsByOwner = async () => [];
export const ThemeSelector = () => null;
export const isSolanaAuthAvailable = () => false;
export function BaseAccountSurfaceButton({ onSwitchSurface }: { onSwitchSurface: (surface: 'base') => Promise<void> }) { return <button onClick={() => void onSwitchSurface('base')}>Continue with Base</button>; }
export function SolanaSurfaceButton() { return null; }
export function PrivyProvider({ config, children }: { config: { appearance: { theme: string } }; children: ReactNode }) { return <div data-testid="privy-theme" data-theme={config.appearance.theme}>{children}</div>; }
/* eslint-disable @next/next/no-img-element -- Isolated browser fixture replaces Next image network loading. */
export default function Image({ src, alt }: { src: string; alt: string }) { return <img src={src} alt={alt} />; }

export const sdk = {
  context: Promise.resolve(new URLSearchParams(location.search).has('mini') ? { user: { fid: 123 }, client: { clientFid: 9152 } } : undefined),
  isInMiniApp: async () => new URLSearchParams(location.search).has('mini'),
  actions: { ready: async () => { document.documentElement.dataset.hostReady = 'true'; } },
};
