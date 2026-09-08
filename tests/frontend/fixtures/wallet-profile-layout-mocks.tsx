import { useState, type ImgHTMLAttributes } from 'react';
const refresh = async () => {};
export const useAccount = () => ({ address: '0x1111111111111111111111111111111111111111', connector: { name: 'Local Test Wallet' } });
export const useChainId = () => 8453;
export const useDisconnect = () => ({ disconnectAsync: refresh });
export const useBalance = () => ({ data: { value: BigInt('1234567890123456789'), decimals: 18 }, isLoading: false, isError: false, refetch: refresh });
export const useBalances = () => ({ seedBalance: BigInt('1000000000000000001'), leafBalance: BigInt('2000000000000000000'), pixotchiBalance: BigInt('3000000000000000000'), loading: false, seedBalanceStatus: 'ready', leafBalanceStatus: 'ready', pixotchiBalanceStatus: 'ready', refreshBalances: refresh });
export const usePrivy = () => ({ ready: true, authenticated: false, user: null });
export const useLogin = () => ({ login: refresh });
export const useLogout = () => ({ logout: refresh });
export const useWallets = () => ({ wallets: [] });
export const useIsSolanaWallet = () => false;
export const useSolanaWallet = () => ({ solBalance: BigInt(0), isLoading: false, refresh });
export const usePrimaryName = () => ({ name: null, loading: false });
export const useEnsAvatar = () => ({ avatar: null, loading: false });
export const useAuthSurface = () => ({ resolved: true, surface: 'test' });
export const useFrameContext = () => ({ isInMiniApp: false, context: null });
export const useSmartWallet = () => ({ isSmartWallet: false, walletType: 'eoa', isLoading: false });
export function useEthMode() { const [enabled, setEnabled] = useState(false); return { enabled, setEnabled }; }
export const getStakeInfo = async () => ({ staked: BigInt('4000000000000000000'), rewards: BigInt('5000000000000000000') });
export const getPlantsByOwner = async () => [];
export const getLandsByOwner = async () => [];
export const AirdropClaimCard = () => null;
export const SolanaBridgeBadge = () => null;
export const isSolanaEnabled = () => false;
export const clearOwnerResources = () => {};
export const disconnectWalletIdentity = refresh;
export const sdk = { actions: { close: refresh } };
export const TransferAssetsDialog = () => null;
/* eslint-disable @next/next/no-img-element -- The fixture retains presentation but replaces Next image network processing. */
export default function Image({ alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) { return <img {...props} alt={alt ?? ''} />; }
