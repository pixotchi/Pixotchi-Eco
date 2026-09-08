export * from './social-medium-io';
export { default } from './social-medium-io';
import { A } from './social-medium-io';
const getAccessToken = async () => 'fixture';
const exportWallet = async () => {};
const user = { linkedAccounts: [{ type: 'wallet', address: A, walletClientType: 'privy', chainType: 'ethereum' }] };
export const usePrivy = () => ({ ready: true, authenticated: true, getAccessToken, user, exportWallet });
export const useLogin = () => ({ login: () => {} });
export const useLogout = () => ({ logout: async () => {} });
export const useWallets = () => ({ wallets: [] });
export const useDisconnect = () => ({ disconnect: () => {} });
export const useChainId = () => 8453;
export const useAuthSurface = () => ({ resolved: true, surface: 'privy' });
export const useEthMode = () => ({ isEthMode: false, toggleEthMode: () => {}, isFeatureEnabled: false });
export const SolanaBridgeBadge = () => null;
export const useBalance = () => ({ data: { value: BigInt('1000000000000000'), decimals: 18 }, isLoading: false, isError: false, refetch: async () => {} });
export const useBalances = () => ({ seedBalance: BigInt('1000000000000000000'), leafBalance: BigInt('2000000000000000000'), pixotchiBalance: BigInt('3000000000000000000'),
  loading: false, seedBalanceStatus: 'ready', leafBalanceStatus: 'ready', pixotchiBalanceStatus: 'ready', refreshBalances: async () => {} });
export const useStakingDialog = () => ({ open: false, openDialog: () => {} });
let nextAuth: Promise<void> | null = null;
let finishAuth: (() => void) | undefined;
export function deferNextAuth() { nextAuth = new Promise(resolve => { finishAuth = resolve; }); }
export function releaseAuth() { finishAuth?.(); }
export async function getMiniAppQuickAuthHeaders({ expectedAddress }: { expectedAddress: string }) {
  const pending = nextAuth; nextAuth = null;
  await pending;
  return { 'x-fixture-owner': expectedAddress };
}
