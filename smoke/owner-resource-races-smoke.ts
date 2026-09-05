import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const projectFile = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const smartWalletContext = projectFile('lib/smart-wallet-context.tsx');
assert.match(
  smartWalletContext,
  /ownerKey\s*=\s*address\s*&&\s*isConnected[\s\S]*detectionChainId[\s\S]*address\.toLowerCase\(\)/,
  'smart-wallet detection must be owned by both account and chain',
);
assert.match(
  smartWalletContext,
  /detectionSnapshot\.ownerKey\s*===\s*ownerKey/,
  'smart-wallet values must be render-gated to the current owner',
);
assert.match(
  smartWalletContext,
  /requestGenerationRef\.current\s*!==\s*generation[\s\S]*ownerKeyRef\.current\s*!==\s*requestedOwnerKey/,
  'smart-wallet async commits must check generation and owner identity',
);
assert.match(
  smartWalletContext,
  /const refetch = useCallback\([\s\S]*requestGenerationRef\.current\s*=\s*generation[\s\S]*ownerKeyRef\.current\s*!==\s*requestedOwnerKey/,
  'manual smart-wallet refresh must use the same generation fence',
);

const solanaWalletContext = projectFile('lib/solana-wallet-context.tsx');
assert.match(
  solanaWalletContext,
  /ownerKey\s*=\s*isEnabled\s*&&\s*solanaAddress\s*\?\s*solanaAddress\s*:\s*null/,
  'Solana resources must remain keyed by the linked identity while the signer restores',
);
assert.match(
  solanaWalletContext,
  /isConnected:\s*walletIsConnected/,
  'Solana transaction readiness must remain separate from the linked identity',
);
assert.match(
  solanaWalletContext,
  /isTwinSetup:\s*walletIsConnected\s*&&\s*visibleSnapshot\.twinSetup/,
  'Solana setup must not be presented as ready without a connected signer',
);
assert.match(
  solanaWalletContext,
  /snapshot\.ownerKey\s*===\s*ownerKey/,
  'Solana resources must be render-gated to the current address',
);
assert.match(
  solanaWalletContext,
  /const isCurrentRequest = \(\) =>[\s\S]*requestGenerationRef\.current === generation[\s\S]*ownerKeyRef\.current === requestedOwnerKey/,
  'Solana async commits must check generation and owner identity',
);
assert.doesNotMatch(
  solanaWalletContext,
  /set(?:TwinAddress|TwinInfo|TwinSetup|SolBalance)\(/,
  'Solana resource fields must commit as one owner-stamped snapshot',
);

const balanceCard = projectFile('components/balance-card.tsx');
assert.match(
  balanceCard,
  /profileOwnerAddress\s*=\s*isSolana\s*\?\s*effectiveAddress\s*:\s*\(address \?\? null\)/,
  'Solana profile resources must use the Base Twin owner rather than a stale EVM address',
);

const solanaWalletProvider = projectFile('components/solana/PrivySolanaWalletIdentity.tsx');
assert.match(
  solanaWalletProvider,
  /connectedSolanaWallet[\s\S]*solanaWallets\[0\][\s\S]*linkedSolanaWallet/,
  'Solana identity may fall back to linked accounts while preferring the connected wallet',
);
assert.match(
  solanaWalletProvider,
  /connectedSolanaWallet[\s\S]*solanaAddress[\s\S]*isSolanaEnabled\(\)/,
  'Solana transaction readiness must require a Privy connected wallet object',
);
assert.match(
  balanceCard,
  /profileSnapshot\.ownerKey\s*===\s*profileOwnerKey/,
  'wallet-profile resources must be render-gated to the current owner',
);
assert.match(
  balanceCard,
  /profileRequestGenerationRef\.current\s*!==\s*generation[\s\S]*profileOwnerKeyRef\.current\s*!==\s*requestedOwnerKey/,
  'wallet-profile resource commits must check generation and owner identity',
);
assert.match(
  balanceCard,
  /plantCount:\s*plantsResult\.status === "fulfilled" \? plantsResult\.value\.length : null/,
  'a failed plant read must not retain a previous owner count',
);
assert.match(
  balanceCard,
  /landCount:\s*landsResult\.status === "fulfilled" \? landsResult\.value\.length : null/,
  'a failed land read must not retain a previous owner count',
);
assert.match(
  balanceCard,
  /manualRefreshGenerationRef\.current === generation[\s\S]*profileOwnerKeyRef\.current === requestedOwnerKey/,
  'manual refresh completion must not mutate a replacement owner UI',
);

const walletProfile = projectFile('components/wallet-profile.tsx');
assert.match(
  walletProfile,
  /effectiveSelectedEmbeddedAddress[\s\S]*embeddedWallets\.find\(\(wallet\) => wallet\.address\.toLowerCase\(\) === selected\)/,
  'embedded-wallet selection must be derived from the current Privy wallet list',
);
assert.match(
  walletProfile,
  /exportWallet\(\{ address: effectiveSelectedEmbeddedAddress \}\)/,
  'wallet export must never submit an unreconciled previous-user selection',
);
assert.match(
  walletProfile,
  /checked=\{effectiveSelectedEmbeddedAddress === wallet\.address\}/,
  'the wallet chooser must render the reconciled current-user selection',
);

const broadcastMessages = projectFile('hooks/useBroadcastMessages.ts');
assert.match(
  broadcastMessages,
  /snapshot\.identityKey === identityKey/,
  'broadcast messages must be render-gated to the current identity',
);
assert.match(
  broadcastMessages,
  /lastFetchByIdentityRef = useRef\(new Map<string, number>\(\)\)/,
  'broadcast throttling must be scoped per identity',
);
assert.match(
  broadcastMessages,
  /identityKeyRef\.current !== requestedIdentityKey[\s\S]*requestGenerationRef\.current \+ 1/,
  'a stale broadcast callback must be rejected before it can supersede the current request',
);
assert.match(
  broadcastMessages,
  /new AbortController\(\)[\s\S]*fetch\(url, \{ signal: controller\.signal \}\)/,
  'replacement broadcast requests must abort obsolete network work',
);
assert.match(
  broadcastMessages,
  /requestGenerationRef\.current === generation[\s\S]*identityKeyRef\.current === requestedIdentityKey[\s\S]*activeRequestControllerRef\.current === controller/,
  'broadcast commits must check generation, identity, and active controller',
);
assert.match(
  broadcastMessages,
  /setSnapshot\(\{ identityKey, loading: true, messages: \[\] \}\);[\s\S]*fetchMessagesRef\.current\(\{ force: true \}\)/,
  'an identity change must clear previous messages and bypass another identity throttle',
);
assert.doesNotMatch(
  broadcastMessages,
  /lastFetchRef/,
  'broadcast requests must not share one cross-owner throttle timestamp',
);

const providers = projectFile('app/providers.tsx');
const tasksLoader = providers.slice(
  providers.indexOf('function DeferredTasksInfoDialog()'),
  providers.indexOf('function ProvidersContent('),
);
assert.ok(
  tasksLoader.indexOf('replayOpenRef.current = true;')
    < tasksLoader.indexOf('if (loadingRef.current) return;'),
  'a repeated tasks-open intent must survive an already in-flight chunk import',
);

const warehouse = projectFile('components/building-details/WarehousePanel.tsx');
assert.match(
  warehouse,
  /requestId !== plantsRequestRef\.current[\s\S]*currentOwnerRef\.current !== requestOwner/,
  'warehouse plants must be fenced by request generation and wallet owner',
);
assert.match(
  warehouse,
  /const currentSelectedPlantId = plantsAreCurrent \? selectedPlantId : null;/,
  'warehouse transactions must fail closed until the plant list belongs to the current wallet',
);

const farmerHouse = projectFile('components/building-details/FarmerHousePanel.tsx');
assert.match(
  farmerHouse,
  /requestId !== slotsRequestRef\.current[\s\S]*currentLandIdRef\.current !== requestLandId \|\| currentScopeRef\.current !== scope/,
  'Farmer House quest slots must reject superseded reads and previous land or wallet identities',
);
assert.match(
  farmerHouse,
  /const scope = questResultScope\(address, landId\);/,
  'Farmer House snapshot identity must include the wallet and selected land',
);
assert.match(
  farmerHouse,
  /const currentSlots = slotsScope === scope \? slots : \[\];/,
  'Farmer House must hide slots not stamped for the selected wallet and land',
);
assert.match(
  farmerHouse,
  /if \(currentScopeRef\.current !== scope\) return;[\s\S]*setRecentResults/,
  'a late quest receipt cannot publish a result into another wallet or land panel',
);

const casinoPanel = projectFile('components/building-details/CasinoPanel.tsx');
assert.match(
  casinoPanel,
  /requestId !== casinoStateRequestRef\.current[\s\S]*currentCasinoIdentityRef\.current !== requestIdentity/,
  'casino state must reject stale land and account reads',
);
assert.match(
  casinoPanel,
  /loadedCasinoIdentity !== casinoIdentity/,
  'casino actions must fail closed while the selected land/account snapshot is unresolved',
);

const barracksPanel = projectFile('components/building-details/BarracksPanelV2.tsx');
assert.match(
  barracksPanel,
  /requestId !== stateRequestRef\.current[\s\S]*currentLandIdRef\.current !== requestLandId/,
  'barracks snapshots must reject stale land reads',
);
assert.match(
  barracksPanel,
  /loadedStateLandId !== landId/,
  'barracks actions must fail closed until state belongs to the selected land',
);
assert.match(
  barracksPanel,
  /const currentBuildAllowance = allowancesAreCurrent \? buildAllowance : ZERO_BIGINT;/,
  'barracks approvals must fail closed until allowance data belongs to the current account',
);

const transactionKit = projectFile('components/transactions/transaction-kit.tsx');
assert.match(
  transactionKit,
  /walletClientMatchesAccount[\s\S]*isSmartWalletDetectionLoading[\s\S]*walletType === "UntypedValue"/,
  'transaction routing must remain locked until the current account and wallet type are verified',
);
assert.match(
  transactionKit,
  /currentWalletRoutingIdentityRef\.current !== walletRoutingIdentity/,
  'retained transaction callbacks must not submit through an obsolete wallet classification',
);
assert.match(
  transactionKit,
  /submissionLockMessage === "Retry wallet check"/,
  'a failed wallet classification must expose a safe retry instead of direct submission',
);

const solanaBridgeButton = projectFile('components/transactions/solana-bridge-button.tsx');
assert.match(
  solanaBridgeButton,
  /useConnectWallet[\s\S]*connectWallet\(\{[\s\S]*walletChainType: 'solana-only'/,
  'an authenticated Solana identity must be able to open Privy’s wallet connection modal',
);
assert.match(
  solanaBridgeButton,
  /walletChainType: 'solana-only'/,
  'the bridge connection modal must stay on the Solana-only auth surface',
);
assert.match(
  solanaBridgeButton,
  /canConnectSolanaWallet[\s\S]*\(!disabled \|\| pendingRecord !== null\)[\s\S]*actionDisabled = canConnectSolanaWallet \? false : isDisabled/,
  'wallet connection must remain available for pending recovery while preserving normal disabled guards',
);

console.log('Owner resource race smoke checks passed.');
