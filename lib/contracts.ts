import { fenceV2Abi } from '@/public/abi/fence-v2-abi';
import { stakingAbi } from '@/public/abi/staking-abi';
import UniswapAbi from '@/public/abi/Uniswap.json';
import { encodeFunctionData,formatUnits,getAddress,keccak256,parseUnits,toBytes,toHex,WalletClient } from 'viem';
import { base } from 'viem/chains';
import { leafAbi } from '../public/abi/leaf-abi';
import { landAbi } from '../public/abi/pixotchi-v3-abi';
import { BaseRpcError,getBaseReadClient,waitForBaseReceipt } from './base-rpc';
import { appendBuilderSuffix } from './builder-code';
import { CLIENT_ENV } from './env-config';
import { PIXOTCHI_SOLANA_CONFIG, SOLANA_TWIN_ADAPTER_ABI } from './solana-constants';
import {
BarracksConfig,
BarracksConfigV2,
BarracksLandState,
BarracksLandStateV2,
BarracksRaidPreview,
BarracksRaidPreviewV2,
BarracksRaidReport,
BarracksRaidReportV2,
FenceV2State,
GardenItem,
Land,
Plant,
ShopItem,
Strain,
} from './types';

export const LAND_CONTRACT_ADDRESS = getAddress(CLIENT_ENV.LAND_CONTRACT_ADDRESS);
export const LEAF_CONTRACT_ADDRESS = getAddress(CLIENT_ENV.LEAF_CONTRACT_ADDRESS);
export const STAKE_CONTRACT_ADDRESS = getAddress(CLIENT_ENV.STAKE_CONTRACT_ADDRESS);
export const PIXOTCHI_NFT_ADDRESS = getAddress('0xeb4e16c804AE9275a655AbBc20cD0658A91F9235');
export const PIXOTCHI_TOKEN_ADDRESS = getAddress('0x546D239032b24eCEEE0cb05c92FC39090846adc7');
export const CREATOR_TOKEN_ADDRESS = getAddress('0xa2ef17bb7eea1143196678337069dfa24d37d2ac');
export const CRYPTICPOET_TOKEN_ADDRESS = getAddress('0x787b7B7117848C1F9Fc79A8Fa543202c231C1Edb');
// Known token addresses for reference
export const JESSE_TOKEN_ADDRESS = getAddress('0x50f88fe97f72cd3e75b9eb4f747f59bceba80d59');
export const BATCH_ROUTER_ADDRESS = CLIENT_ENV.BATCH_ROUTER_ADDRESS ? getAddress(CLIENT_ENV.BATCH_ROUTER_ADDRESS) : undefined as UntypedValue as `0x${string}`;
export const UNISWAP_ROUTER_ADDRESS = getAddress('0x327Df1E6de05895d2ab08513aaDD9313Fe505d86'); // BaseSwap Router (Uniswap V2 Fork)
export const WETH_ADDRESS = getAddress('0x4200000000000000000000000000000000000006');
export const FENCE_V2_EXTENSION_ADDRESS = PIXOTCHI_NFT_ADDRESS;

export const getPlantNameChangePrice = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<bigint | null> => {
  if (!PIXOTCHI_SOLANA_CONFIG.twinAdapter) return null;

  try {
    return await readClient.readContract({
      address: getAddress(PIXOTCHI_SOLANA_CONFIG.twinAdapter),
      abi: SOLANA_TWIN_ADAPTER_ABI,
      functionName: 'getNameChangePriceInSeed',
      args: [],
    }) as bigint;
  } catch (error) {
    console.warn('getPlantNameChangePrice failed:', error);
    return null;
  }
};

const isFenceItemName = (name: UntypedValue): boolean => {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  return lower.includes('fence') || lower.includes('shield');
};

// Derive Fence V2 state from extensions (since Fence V2 writes to the same storage)
// This eliminates the need for a separate RPC call to fenceV2GetPurchaseStats
const deriveFenceV2StateFromExtensions = (extensions: UntypedValue[]): FenceV2State | null => {
  if (!Array.isArray(extensions)) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  let maxEffectUntil = 0;
  let hasActiveFence = false;

  // Find the fence with the latest expiry time
  for (const extension of extensions) {
    const owned = extension?.shopItemOwned || [];
    if (!Array.isArray(owned)) continue;
    for (const item of owned) {
      if (!isFenceItemName(item?.name)) continue;
      const effectUntil = Number(item?.effectUntil ?? 0);
      if (!Number.isFinite(effectUntil) || effectUntil <= 0) continue;

      if (effectUntil > maxEffectUntil) {
        maxEffectUntil = effectUntil;
      }

      // Check if this fence is currently active
      if (item?.effectIsOngoingActive && effectUntil > nowSec) {
        hasActiveFence = true;
      }
    }
  }

  if (maxEffectUntil === 0) return null;

  const secondsRemaining = Math.max(0, maxEffectUntil - nowSec);
  const totalDaysPurchased = secondsRemaining > 0 ? Math.ceil(secondsRemaining / (24 * 60 * 60)) : 0;
  const isActive = hasActiveFence && maxEffectUntil > nowSec;

  return {
    activeUntil: maxEffectUntil,
    isActive,
    v1Active: false, // V1 is deprecated, all fences in extensions are V2
    totalDaysPurchased,
    quotedDays: null,
    isMirroringV1: false,
  };
};

// Common constants
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000001';
export const USDC_ADDRESS = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');

// EVM event signatures for log parsing
export const EVM_EVENT_SIGNATURES = {
  // ERC20 Transfer(address indexed from, address indexed to, uint256 value)
  ERC20_TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
} as const;

// Topic constants for log filtering
export const EVM_TOPICS = {
  ZERO_ADDRESS_TOPIC: '0x0000000000000000000000000000000000000000000000000000000000000000',
} as const;

// Address validation pattern
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Centralized ABI definitions to avoid duplication
export const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }]
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }]
  }
] as const;

export const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const barracksAbi = [
  {
    type: 'function',
    name: 'barracksGetConfig',
    stateMutability: 'view',
    inputs: [],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'initialized', type: 'bool' },
        { name: 'enabled', type: 'bool' },
        { name: 'buildToken', type: 'address' },
        { name: 'buildCost', type: 'uint256' },
        { name: 'buildReceiver', type: 'address' },
        { name: 'trainingToken', type: 'address' },
        { name: 'trainingCost', type: 'uint256' },
        { name: 'trainingReceiver', type: 'address' },
        { name: 'trainingTimePerTroop', type: 'uint256' },
        { name: 'attackCooldown', type: 'uint256' },
        { name: 'defenseCooldown', type: 'uint256' },
        { name: 'lootPercentageBps', type: 'uint16' },
        { name: 'casualtyScaleBps', type: 'uint16' },
        { name: 'successfulRaidXP', type: 'uint256' },
        { name: 'successfulDefenseXP', type: 'uint256' },
        { name: 'troopAttackStrength', type: 'uint256' },
        { name: 'troopDefenseStrength', type: 'uint256' },
        { name: 'troopCarryPoints', type: 'uint256' },
        { name: 'troopCarryLifetime', type: 'uint256' },
        { name: 'maxTroopsPerLand', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksGetConfigV2',
    stateMutability: 'view',
    inputs: [],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'initialized', type: 'bool' },
        { name: 'enabled', type: 'bool' },
        { name: 'buildToken', type: 'address' },
        { name: 'buildCost', type: 'uint256' },
        { name: 'buildReceiver', type: 'address' },
        { name: 'attackCooldown', type: 'uint256' },
        { name: 'defenseCooldown', type: 'uint256' },
        { name: 'lootPercentageBps', type: 'uint16' },
        { name: 'casualtyScaleBps', type: 'uint16' },
        { name: 'successfulRaidXP', type: 'uint256' },
        { name: 'successfulDefenseXP', type: 'uint256' },
        {
          name: 'swordsman',
          type: 'tuple',
          components: [
            { name: 'trainingToken', type: 'address' },
            { name: 'trainingCost', type: 'uint256' },
            { name: 'trainingReceiver', type: 'address' },
            { name: 'trainingTimePerTroop', type: 'uint256' },
            { name: 'troopAttackStrength', type: 'uint256' },
            { name: 'troopDefenseStrength', type: 'uint256' },
            { name: 'troopCarryPoints', type: 'uint256' },
            { name: 'troopCarryLifetime', type: 'uint256' },
            { name: 'maxTroopsPerLand', type: 'uint256' },
          ],
        },
        {
          name: 'phalanx',
          type: 'tuple',
          components: [
            { name: 'trainingToken', type: 'address' },
            { name: 'trainingCost', type: 'uint256' },
            { name: 'trainingReceiver', type: 'address' },
            { name: 'trainingTimePerTroop', type: 'uint256' },
            { name: 'troopAttackStrength', type: 'uint256' },
            { name: 'troopDefenseStrength', type: 'uint256' },
            { name: 'troopCarryPoints', type: 'uint256' },
            { name: 'troopCarryLifetime', type: 'uint256' },
            { name: 'maxTroopsPerLand', type: 'uint256' },
          ],
        },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksGetLandState',
    stateMutability: 'view',
    inputs: [{ name: 'landId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'isBuilt', type: 'bool' },
        { name: 'stationedTroops', type: 'uint256' },
        { name: 'trainingQueueAmount', type: 'uint256' },
        { name: 'readyToClaimTroops', type: 'uint256' },
        { name: 'trainingStartedAt', type: 'uint256' },
        { name: 'trainingEndsAt', type: 'uint256' },
        { name: 'nextTroopReadyAt', type: 'uint256' },
        { name: 'lastAttackAt', type: 'uint256' },
        { name: 'lastDefendedAt', type: 'uint256' },
        { name: 'attackCooldownEndsAt', type: 'uint256' },
        { name: 'defenseCooldownEndsAt', type: 'uint256' },
        { name: 'totalTroops', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksGetLandStateV2',
    stateMutability: 'view',
    inputs: [{ name: 'landId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'isBuilt', type: 'bool' },
        { name: 'stationedSwordsmanTroops', type: 'uint256' },
        { name: 'stationedPhalanxTroops', type: 'uint256' },
        { name: 'trainingQueueTroopType', type: 'uint8' },
        { name: 'trainingQueueAmount', type: 'uint256' },
        { name: 'readyToClaimSwordsmanTroops', type: 'uint256' },
        { name: 'readyToClaimPhalanxTroops', type: 'uint256' },
        { name: 'trainingStartedAt', type: 'uint256' },
        { name: 'trainingEndsAt', type: 'uint256' },
        { name: 'nextTroopReadyAt', type: 'uint256' },
        { name: 'lastAttackAt', type: 'uint256' },
        { name: 'lastDefendedAt', type: 'uint256' },
        { name: 'attackCooldownEndsAt', type: 'uint256' },
        { name: 'defenseCooldownEndsAt', type: 'uint256' },
        { name: 'totalSwordsmanTroops', type: 'uint256' },
        { name: 'totalPhalanxTroops', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksGetEligibleAttackableLandIds',
    stateMutability: 'view',
    inputs: [{ name: 'attackerLandId', type: 'uint256' }],
    outputs: [{ name: 'landIds', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'barracksGetLastOutgoingReport',
    stateMutability: 'view',
    inputs: [{ name: 'landId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'raidId', type: 'uint256' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'attackerLandId', type: 'uint256' },
        { name: 'defenderLandId', type: 'uint256' },
        { name: 'attackerWon', type: 'bool' },
        { name: 'troopsSent', type: 'uint256' },
        { name: 'attackerTroopsBefore', type: 'uint256' },
        { name: 'defenderTroopsBefore', type: 'uint256' },
        { name: 'attackerTroopsLost', type: 'uint256' },
        { name: 'defenderTroopsLost', type: 'uint256' },
        { name: 'survivingAttackers', type: 'uint256' },
        { name: 'survivingDefenders', type: 'uint256' },
        { name: 'attackerPower', type: 'uint256' },
        { name: 'defenderPower', type: 'uint256' },
        { name: 'pendingPointsSettled', type: 'uint256' },
        { name: 'pendingLifetimeSettled', type: 'uint256' },
        { name: 'pointsStolen', type: 'uint256' },
        { name: 'lifetimeStolen', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksGetLastOutgoingReportV2',
    stateMutability: 'view',
    inputs: [{ name: 'landId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'raidId', type: 'uint256' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'attackerLandId', type: 'uint256' },
        { name: 'defenderLandId', type: 'uint256' },
        { name: 'attackerWon', type: 'bool' },
        { name: 'swordsmenSent', type: 'uint256' },
        { name: 'phalanxSent', type: 'uint256' },
        { name: 'attackerSwordsmenBefore', type: 'uint256' },
        { name: 'attackerPhalanxBefore', type: 'uint256' },
        { name: 'defenderSwordsmenBefore', type: 'uint256' },
        { name: 'defenderPhalanxBefore', type: 'uint256' },
        { name: 'attackerSwordsmenLost', type: 'uint256' },
        { name: 'attackerPhalanxLost', type: 'uint256' },
        { name: 'defenderSwordsmenLost', type: 'uint256' },
        { name: 'defenderPhalanxLost', type: 'uint256' },
        { name: 'survivingAttackerSwordsmen', type: 'uint256' },
        { name: 'survivingAttackerPhalanx', type: 'uint256' },
        { name: 'survivingDefenderSwordsmen', type: 'uint256' },
        { name: 'survivingDefenderPhalanx', type: 'uint256' },
        { name: 'attackerPower', type: 'uint256' },
        { name: 'defenderPower', type: 'uint256' },
        { name: 'pendingPointsSettled', type: 'uint256' },
        { name: 'pendingLifetimeSettled', type: 'uint256' },
        { name: 'pointsStolen', type: 'uint256' },
        { name: 'lifetimeStolen', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksGetLastIncomingReport',
    stateMutability: 'view',
    inputs: [{ name: 'landId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'raidId', type: 'uint256' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'attackerLandId', type: 'uint256' },
        { name: 'defenderLandId', type: 'uint256' },
        { name: 'attackerWon', type: 'bool' },
        { name: 'troopsSent', type: 'uint256' },
        { name: 'attackerTroopsBefore', type: 'uint256' },
        { name: 'defenderTroopsBefore', type: 'uint256' },
        { name: 'attackerTroopsLost', type: 'uint256' },
        { name: 'defenderTroopsLost', type: 'uint256' },
        { name: 'survivingAttackers', type: 'uint256' },
        { name: 'survivingDefenders', type: 'uint256' },
        { name: 'attackerPower', type: 'uint256' },
        { name: 'defenderPower', type: 'uint256' },
        { name: 'pendingPointsSettled', type: 'uint256' },
        { name: 'pendingLifetimeSettled', type: 'uint256' },
        { name: 'pointsStolen', type: 'uint256' },
        { name: 'lifetimeStolen', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksGetLastIncomingReportV2',
    stateMutability: 'view',
    inputs: [{ name: 'landId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'raidId', type: 'uint256' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'attackerLandId', type: 'uint256' },
        { name: 'defenderLandId', type: 'uint256' },
        { name: 'attackerWon', type: 'bool' },
        { name: 'swordsmenSent', type: 'uint256' },
        { name: 'phalanxSent', type: 'uint256' },
        { name: 'attackerSwordsmenBefore', type: 'uint256' },
        { name: 'attackerPhalanxBefore', type: 'uint256' },
        { name: 'defenderSwordsmenBefore', type: 'uint256' },
        { name: 'defenderPhalanxBefore', type: 'uint256' },
        { name: 'attackerSwordsmenLost', type: 'uint256' },
        { name: 'attackerPhalanxLost', type: 'uint256' },
        { name: 'defenderSwordsmenLost', type: 'uint256' },
        { name: 'defenderPhalanxLost', type: 'uint256' },
        { name: 'survivingAttackerSwordsmen', type: 'uint256' },
        { name: 'survivingAttackerPhalanx', type: 'uint256' },
        { name: 'survivingDefenderSwordsmen', type: 'uint256' },
        { name: 'survivingDefenderPhalanx', type: 'uint256' },
        { name: 'attackerPower', type: 'uint256' },
        { name: 'defenderPower', type: 'uint256' },
        { name: 'pendingPointsSettled', type: 'uint256' },
        { name: 'pendingLifetimeSettled', type: 'uint256' },
        { name: 'pointsStolen', type: 'uint256' },
        { name: 'lifetimeStolen', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksPreviewRaid',
    stateMutability: 'view',
    inputs: [
      { name: 'attackerLandId', type: 'uint256' },
      { name: 'defenderLandId', type: 'uint256' },
      { name: 'troopsToSend', type: 'uint256' },
    ],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'statusCode', type: 'uint8' },
        { name: 'attackerWon', type: 'bool' },
        { name: 'troopsRequested', type: 'uint256' },
        { name: 'attackerTroopsBefore', type: 'uint256' },
        { name: 'defenderTroopsBefore', type: 'uint256' },
        { name: 'attackerTroopsLost', type: 'uint256' },
        { name: 'defenderTroopsLost', type: 'uint256' },
        { name: 'survivingAttackers', type: 'uint256' },
        { name: 'survivingDefenders', type: 'uint256' },
        { name: 'attackerPower', type: 'uint256' },
        { name: 'defenderPower', type: 'uint256' },
        { name: 'pendingPoints', type: 'uint256' },
        { name: 'pendingLifetime', type: 'uint256' },
        { name: 'carryPointsCap', type: 'uint256' },
        { name: 'carryLifetimeCap', type: 'uint256' },
        { name: 'estimatedPointsLoot', type: 'uint256' },
        { name: 'estimatedLifetimeLoot', type: 'uint256' },
        { name: 'attackerCooldownEndsAt', type: 'uint256' },
        { name: 'defenderCooldownEndsAt', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksPreviewRaidV2',
    stateMutability: 'view',
    inputs: [
      { name: 'attackerLandId', type: 'uint256' },
      { name: 'defenderLandId', type: 'uint256' },
      { name: 'swordsmenToSend', type: 'uint256' },
      { name: 'phalanxToSend', type: 'uint256' },
    ],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'statusCode', type: 'uint8' },
        { name: 'attackerWon', type: 'bool' },
        { name: 'swordsmenRequested', type: 'uint256' },
        { name: 'phalanxRequested', type: 'uint256' },
        { name: 'attackerSwordsmenBefore', type: 'uint256' },
        { name: 'attackerPhalanxBefore', type: 'uint256' },
        { name: 'defenderSwordsmenBefore', type: 'uint256' },
        { name: 'defenderPhalanxBefore', type: 'uint256' },
        { name: 'attackerSwordsmenLost', type: 'uint256' },
        { name: 'attackerPhalanxLost', type: 'uint256' },
        { name: 'defenderSwordsmenLost', type: 'uint256' },
        { name: 'defenderPhalanxLost', type: 'uint256' },
        { name: 'survivingAttackerSwordsmen', type: 'uint256' },
        { name: 'survivingAttackerPhalanx', type: 'uint256' },
        { name: 'survivingDefenderSwordsmen', type: 'uint256' },
        { name: 'survivingDefenderPhalanx', type: 'uint256' },
        { name: 'attackerPower', type: 'uint256' },
        { name: 'defenderPower', type: 'uint256' },
        { name: 'pendingPoints', type: 'uint256' },
        { name: 'pendingLifetime', type: 'uint256' },
        { name: 'carryPointsCap', type: 'uint256' },
        { name: 'carryLifetimeCap', type: 'uint256' },
        { name: 'estimatedPointsLoot', type: 'uint256' },
        { name: 'estimatedLifetimeLoot', type: 'uint256' },
        { name: 'attackerCooldownEndsAt', type: 'uint256' },
        { name: 'defenderCooldownEndsAt', type: 'uint256' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'barracksBuild',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'landId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'barracksTrainTroops',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'landId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'barracksTrainTroopsV2',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'landId', type: 'uint256' },
      { name: 'troopType', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'barracksClaimTroops',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'landId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'barracksAttack',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'attackerLandId', type: 'uint256' },
      { name: 'defenderLandId', type: 'uint256' },
      { name: 'troopsToSend', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'barracksAttackV2',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'attackerLandId', type: 'uint256' },
      { name: 'defenderLandId', type: 'uint256' },
      { name: 'swordsmenToSend', type: 'uint256' },
      { name: 'phalanxToSend', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'barracksForceFinishTrainingV2',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'landId', type: 'uint256' }],
    outputs: [
      { name: 'troopType', type: 'uint8' },
      { name: 'finishedAmount', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'barracksAdminAddTroopsV2',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'landId', type: 'uint256' },
      { name: 'troopType', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'barracksAdminAddTroopsToAllBuiltV2',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'troopType', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'landsAffected', type: 'uint256' }],
  },
] as const;

export const BOX_GAME_ABI = [
  {
    inputs: [{ name: "nftID", type: "uint256" }],
    name: "boxGameGetCoolDownTimePerNFT",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "nftID", type: "uint256" }],
    name: "boxGameGetCoolDownTimeWithStar",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "nftID", type: "uint256" },
      { name: "seed", type: "uint256" },
    ],
    name: "boxGamePlay",
    outputs: [
      { name: "points", type: "uint256" },
      { name: "timeExtension", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "nftID", type: "uint256" },
      { name: "seed", type: "uint256" },
    ],
    name: "boxGamePlayWithStar",
    outputs: [
      { name: "points", type: "uint256" },
      { name: "timeExtension", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const SPIN_GAME_ABI = [
  {
    inputs: [],
    name: "getCoolDownTime",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getStarCost",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "index", type: "uint256" }],
    name: "getReward",
    outputs: [
      { name: "pointsDelta", type: "int256" },
      { name: "timeExtension", type: "uint256" },
      { name: "leafAmount", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "nftID", type: "uint256" }],
    name: "spinGameV2GetCoolDownTimePerNFT",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "nftId", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ],
    name: "spinGameV2Commit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "nftId", type: "uint256" },
      { name: "secret", type: "bytes32" },
    ],
    name: "spinGameV2Play",
    outputs: [
      { name: "pointsDelta", type: "int256" },
      { name: "timeAdded", type: "uint256" },
      { name: "leafAmount", type: "uint256" },
      { name: "rewardIndex", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// Kill Cooldown Extension ABI (for onchain rate limiting)
export const KILL_COOLDOWN_ABI = [
  {
    inputs: [{ name: "wallet", type: "address" }],
    name: "canKill",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "wallet", type: "address" }],
    name: "getKillCooldownRemaining",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getKillCooldownSeconds",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "isKillCooldownEnabled",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type PixotchiReadClient = ReturnType<typeof getBaseReadClient>;

export const getReadClient = (): PixotchiReadClient => getBaseReadClient();

const waitForBaseTransactionSuccess = async (
  hash: `0x${string}`,
): Promise<boolean> => {
  const receipt = await waitForBaseReceipt(hash);
  return receipt.status === 'success';
};

// Retry logic for rate limiting and network issues
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  void maxRetries;
  void baseDelay;
  return fn();
};

// Simplified contract ABIs (only the functions we need)
const PIXOTCHI_NFT_ABI = [
  {
    inputs: [
      { name: 'id', type: 'uint256' }
    ],
    name: 'redeem',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'strain', type: 'uint256' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'getPlantsByOwnerExtended',
    outputs: [{
      name: '', type: 'tuple[]', components: [
        { name: 'id', type: 'uint256' },
        { name: 'name', type: 'string' },
        { name: 'timeUntilStarving', type: 'uint256' },
        { name: 'score', type: 'uint256' },
        { name: 'timePlantBorn', type: 'uint256' },
        { name: 'lastAttackUsed', type: 'uint256' },
        { name: 'lastAttacked', type: 'uint256' },
        { name: 'stars', type: 'uint256' },
        { name: 'strain', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'statusStr', type: 'string' },
        { name: 'level', type: 'uint256' },
        { name: 'owner', type: 'address' },
        { name: 'rewards', type: 'uint256' },
        {
          name: 'extensions', type: 'tuple[]', components: [
            {
              name: 'shopItemOwned', type: 'tuple[]', components: [
                { name: 'id', type: 'uint256' },
                { name: 'name', type: 'string' },
                { name: 'effectUntil', type: 'uint256' },
                { name: 'effectIsOngoingActive', type: 'bool' }
              ]
            }
          ]
        }
      ]
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getAllStrainInfo',
    outputs: [{
      name: '', type: 'tuple[]', components: [
        { name: 'id', type: 'uint256' },
        { name: 'mintPrice', type: 'uint256' },
        { name: 'totalSupply', type: 'uint256' },
        { name: 'totalMinted', type: 'uint256' },
        { name: 'maxSupply', type: 'uint256' },
        { name: 'name', type: 'string' },
        { name: 'isActive', type: 'bool' },
        { name: 'getStrainTotalLeft', type: 'uint256' },
        { name: 'strainInitialTOD', type: 'uint256' }
      ]
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'strainId', type: 'uint256' }],
    name: 'getStrainPaymentInfo',
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'price', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'shopGetAllItems',
    outputs: [{
      name: '', type: 'tuple[]', components: [
        { name: 'id', type: 'uint256' },
        { name: 'name', type: 'string' },
        { name: 'price', type: 'uint256' },
        { name: 'expireTime', type: 'uint256' }
      ]
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getRevivePrice',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'plantId', type: 'uint256' },
      { name: 'itemId', type: 'uint256' }
    ],
    name: 'shopBuyItem',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'airdropGetAliveAndDeadTokenIds',
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenIds', type: 'uint256[]' }],
    name: 'getPlantsInfoExtended',
    outputs: [{
      name: '', type: 'tuple[]', components: [
        { name: 'id', type: 'uint256' },
        { name: 'name', type: 'string' },
        { name: 'timeUntilStarving', type: 'uint256' },
        { name: 'score', type: 'uint256' },
        { name: 'timePlantBorn', type: 'uint256' },
        { name: 'lastAttackUsed', type: 'uint256' },
        { name: 'lastAttacked', type: 'uint256' },
        { name: 'stars', type: 'uint256' },
        { name: 'strain', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'statusStr', type: 'string' },
        { name: 'level', type: 'uint256' },
        { name: 'owner', type: 'address' },
        { name: 'rewards', type: 'uint256' },
        {
          name: 'extensions', type: 'tuple[]', components: [
            {
              name: 'shopItemOwned', type: 'tuple[]', components: [
                { name: 'id', type: 'uint256' },
                { name: 'name', type: 'string' },
                { name: 'effectUntil', type: 'uint256' },
                { name: 'effectIsOngoingActive', type: 'bool' }
              ]
            }
          ]
        }
      ]
    }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'itemId', type: 'uint256' }
    ],
    name: 'buyAccessory',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: '_id', type: 'uint256' },
      { name: '_name', type: 'string' }
    ],
    name: 'setPlantName',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getAllGardenItem',
    outputs: [{
      name: '',
      type: 'tuple[]',
      components: [
        { name: 'id', type: 'uint256' },
        { name: 'name', type: 'string' },
        { name: 'price', type: 'uint256' },
        { name: 'points', type: 'uint256' },
        { name: 'timeExtension', type: 'uint256' }
      ]
    }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Minimal ERC-721 ABI for transfers
const ERC721_MIN_ABI = [
  {
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' }
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' }
    ],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  }
] as const;

const PIXOTCHI_TOKEN_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  }
] as const;

// -------------------- BATCH ROUTER ABI --------------------
const BATCH_ROUTER_ABI = [
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenIds', type: 'uint256[]' }
    ],
    name: 'batchTransfer721',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'tokenIdsPerToken', type: 'uint256[][]' }
    ],
    name: 'batchTransfer721Multi',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// -------------------- STAKING HELPERS --------------------

// Check SEED allowance for staking contract
export const getStakeAllowance = async (ownerAddress: string): Promise<bigint> => {
  const readClient = getReadClient();
  return retryWithBackoff(async () => {
    const allowance = await readClient.readContract({
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'allowance',
      args: [ownerAddress as `0x${string}`, STAKE_CONTRACT_ADDRESS],
    }) as bigint;
    return allowance;
  });
};

export const isStakeApproved = async (ownerAddress: string): Promise<boolean> => {
  try {
    const allowance = await getStakeAllowance(ownerAddress);
    return allowance > BigInt(0);
  } catch {
    return false;
  }
};

// Build approve call for UniversalTransaction
export const buildApproveStakeCall = (): { address: `0x${string}`; abi: UntypedValue; functionName: string; args: UntypedValue[] } => {
  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
  return {
    address: PIXOTCHI_TOKEN_ADDRESS,
    abi: PIXOTCHI_TOKEN_ABI,
    functionName: 'approve',
    args: [STAKE_CONTRACT_ADDRESS, maxApproval],
  } as const;
};

export const buildStakeCall = (amount: string): { address: `0x${string}`; abi: UntypedValue; functionName: string; args: UntypedValue[] } => {
  const amountWei = parseUnits(amount || '0', 18);
  return {
    address: STAKE_CONTRACT_ADDRESS,
    abi: stakingAbi,
    functionName: 'stake',
    args: [amountWei],
  } as const;
};

export const buildUnstakeCall = (amount: string): { address: `0x${string}`; abi: UntypedValue; functionName: string; args: UntypedValue[] } => {
  const amountWei = parseUnits(amount || '0', 18);
  return {
    address: STAKE_CONTRACT_ADDRESS,
    abi: stakingAbi,
    functionName: 'withdraw',
    args: [amountWei],
  } as const;
};

export const buildClaimRewardsCall = (): { address: `0x${string}`; abi: UntypedValue; functionName: string; args: UntypedValue[] } => {
  return {
    address: STAKE_CONTRACT_ADDRESS,
    abi: stakingAbi,
    functionName: 'claimRewards',
    args: [],
  } as const;
};

export const getStakeInfo = async (address: string): Promise<{ staked: bigint; rewards: bigint } | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      const info = await readClient.readContract({
        address: STAKE_CONTRACT_ADDRESS,
        abi: stakingAbi,
        functionName: 'getStakeInfo',
        args: [address as `0x${string}`],
      });
      return info as UntypedValue;
    });
    // Normalize possible return shapes
    if (Array.isArray(result)) {
      const [staked, rewards] = result as [bigint, bigint];
      return { staked, rewards };
    }
    if (typeof result === 'object' && result) {
      const staked = (result.staked ?? result[0]) as bigint;
      const rewards = (result.rewards ?? result[1]) as bigint;
      return { staked, rewards };
    }
    return null;
  } catch (e) {
    console.warn('getStakeInfo failed:', e);
    return null;
  }
};

// Optimized composite fetch for staking-specific data only (no balance duplication)
export const getStakeComposite = async (
  ownerAddress: string,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<{
  stake: { staked: bigint; rewards: bigint } | null;
  approved: boolean;
  rewardRatio: { numerator: bigint; denominator: bigint } | null;
  timeUnit: bigint | null;
  totalStaked: bigint | null;
}> => {
  try {
    const [stakeRes, allowanceRes, rewardRatioRes, timeUnitRes, totalStakedRes] = await retryWithBackoff(async () => {
      const results = await readClient.multicall({
        contracts: [
          {
            address: STAKE_CONTRACT_ADDRESS,
            abi: stakingAbi,
            functionName: 'getStakeInfo',
            args: [ownerAddress as `0x${string}`],
          },
          {
            address: PIXOTCHI_TOKEN_ADDRESS,
            abi: PIXOTCHI_TOKEN_ABI,
            functionName: 'allowance',
            args: [ownerAddress as `0x${string}`, STAKE_CONTRACT_ADDRESS],
          },
          {
            address: STAKE_CONTRACT_ADDRESS,
            abi: stakingAbi,
            functionName: 'getRewardRatio',
            args: [],
          },
          {
            address: STAKE_CONTRACT_ADDRESS,
            abi: stakingAbi,
            functionName: 'getTimeUnit',
            args: [],
          },
          {
            address: STAKE_CONTRACT_ADDRESS,
            abi: stakingAbi,
            functionName: 'stakingTokenBalance',
            args: [],
          },
        ],
        allowFailure: true,
      });
      return results as UntypedValue[];
    });

    let stake: { staked: bigint; rewards: bigint } | null = null;
    const sr = stakeRes?.result as UntypedValue;
    if (Array.isArray(sr)) {
      stake = { staked: sr[0] as bigint, rewards: sr[1] as bigint };
    } else if (sr && typeof sr === 'object') {
      stake = { staked: (sr.staked ?? sr[0]) as bigint, rewards: (sr.rewards ?? sr[1]) as bigint };
    }

    const allowance = (allowanceRes?.result ?? BigInt(0)) as bigint;
    const approved = allowance > BigInt(0);

    let rewardRatio: { numerator: bigint; denominator: bigint } | null = null;
    const rr = rewardRatioRes?.result as UntypedValue;
    const numerator = rr?.numerator ?? rr?.[0];
    const denominator = rr?.denominator ?? rr?.[1];
    if (typeof numerator !== 'undefined' && typeof denominator !== 'undefined') {
      try {
        rewardRatio = {
          numerator: BigInt(numerator),
          denominator: BigInt(denominator),
        };
      } catch {
        rewardRatio = null;
      }
    }

    let timeUnit: bigint | null = null;
    const timeUnitResult = timeUnitRes?.result as UntypedValue;
    if (typeof timeUnitResult !== 'undefined' && timeUnitResult !== null) {
      try {
        timeUnit = BigInt(timeUnitResult);
      } catch {
        timeUnit = null;
      }
    }

    let totalStaked: bigint | null = null;
    const totalStakedRaw = totalStakedRes?.result as UntypedValue;
    if (typeof totalStakedRaw !== 'undefined' && totalStakedRaw !== null) {
      try {
        totalStaked = BigInt(totalStakedRaw);
      } catch {
        totalStaked = null;
      }
    }

    return { stake, approved, rewardRatio, timeUnit, totalStaked };
  } catch (e) {
    console.warn('getStakeComposite failed:', e);
    return { stake: null, approved: false, rewardRatio: null, timeUnit: null, totalStaked: null };
  }
};

// Plant fetching (following main app's exact pattern)
export const getPlantsByOwner = async (
  address: string,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<Plant[]> => {
  return retryWithBackoff(async () => {
    const plants = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'getPlantsByOwnerExtended',
      args: [address as `0x${string}`],
    }) as UntypedValue[];

    // Fence V2 writes to the same extensions storage, so derive it from extensions
    // No need for separate RPC call to fenceV2GetPurchaseStats

    return plants.map((plant: UntypedValue) => {
      const plantId = Number(plant.id);
      const extensions = plant.extensions || [];
      // Derive Fence V2 state directly from extensions (same storage)
      const fenceV2 = deriveFenceV2StateFromExtensions(extensions);

      return {
        id: plantId,
        name: plant.name || '',
        score: Number(plant.score),
        status: Number(plant.status),
        rewards: Number(plant.rewards),
        level: Number(plant.level),
        timeUntilStarving: Number(plant.timeUntilStarving),
        stars: Number(plant.stars),
        strain: Number(plant.strain),
        timePlantBorn: plant.timePlantBorn ? plant.timePlantBorn.toString() : '0',
        lastAttackUsed: plant.lastAttackUsed ? plant.lastAttackUsed.toString() : '0',
        lastAttacked: plant.lastAttacked ? plant.lastAttacked.toString() : '0',
        statusStr: plant.statusStr || '',
        owner: typeof plant.owner === 'string' ? plant.owner.toLowerCase() : String(plant.owner || '').toLowerCase(),
        extensions,
        fenceV2,
      };
    });
  });
};

// Get land balance
export const getLandBalance = async (address: string): Promise<number> => {
  const lands = await getLandsByOwner(address);
  return lands.length;
};

export const getLandSupply = async (): Promise<{ totalSupply: number; maxSupply: number; }> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    const [totalSupply, maxSupply] = await Promise.all([
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'totalSupply',
      }),
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'maxSupply',
      })
    ]);

    return {
      totalSupply: Number(totalSupply as bigint),
      maxSupply: Number(maxSupply as bigint),
    };
  });
};

export const getLandMintPrice = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<bigint> => {
  return retryWithBackoff(async () => {
    const price = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'landGetMintPrice',
    });
    return price as bigint;
  });
};

export const getLandMintStatus = async (address: `0x${string}`): Promise<{ canMint: boolean; reason: string; }> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    const [isPaused, isWhitelistOnly, isWhitelisted] = await Promise.all([
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'accessControlGetPaused',
      }),
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'accessControlGetWhitelistOnly',
      }),
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'accessControlGetWhitelistAddress',
        args: [address],
      }),
    ]);

    if (isPaused) {
      return { canMint: false, reason: 'Minting is currently paused.' };
    }
    if (isWhitelistOnly && !isWhitelisted) {
      return { canMint: false, reason: 'Minting is restricted to whitelisted addresses.' };
    }

    return { canMint: true, reason: '' };
  });
};

export const getLandsByOwner = async (
  address: string,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<Land[]> => {
  try {
    // Use the existing Land contract functions from the ABI
    const lands = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'landGetByOwner',
      args: [address as `0x${string}`],
    });

    return lands as Land[];
  } catch (error) {
    throw new BaseRpcError('getLandsByOwner', error);
  }
};

export const getLandById = async (landId: bigint): Promise<Land> => {
  try {
    const client = getReadClient();
    const land = await client.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'landGetById',
      args: [landId],
    });
    return land as Land;
  } catch (error) {
    throw new BaseRpcError('getLandById', error);
  }
};

export const getLandsByIds = async (
  landIds: bigint[],
  options: { chunkSize?: number; readClient?: PixotchiReadClient } = {},
): Promise<Land[]> => {
  if (landIds.length === 0) return [];

  const { chunkSize = 25, readClient = getReadClient() } = options;
  const lands: Land[] = [];

  for (let i = 0; i < landIds.length; i += chunkSize) {
    const chunk = landIds.slice(i, i + chunkSize);
    const chunkResults = await retryWithBackoff(async () => {
      return readClient.multicall({
        allowFailure: true,
        contracts: chunk.map((landId) => ({
          address: LAND_CONTRACT_ADDRESS,
          abi: landAbi,
          functionName: 'landGetById' as const,
          args: [landId],
        })),
      });
    });

    for (const entry of chunkResults) {
      if (entry.status === 'success' && entry.result) {
        lands.push(entry.result as Land);
      }
    }
  }

  return lands;
};

// -------------------- ASSET TRANSFERS --------------------

/**
 * Transfer a batch of plant NFTs to a destination wallet.
 */
export const transferPlants = async (
  walletClient: WalletClient,
  toAddress: string,
  plantIds: number[],
): Promise<{ successIds: number[]; failedIds: number[] }> => {
  if (!walletClient?.account) throw new Error('No account connected');
  const from = walletClient.account.address;
  const to = getAddress(toAddress);

  const successIds: number[] = [];
  const failedIds: number[] = [];

  for (const id of plantIds) {
    try {
      // Encode function data and append builder code suffix for ERC-8021 attribution.
      const encodedData = encodeFunctionData({
        abi: ERC721_MIN_ABI,
        functionName: 'transferFrom',
        args: [from, to, BigInt(id)],
      });
      const dataWithSuffix = appendBuilderSuffix(encodedData);

      const hash = await walletClient.sendTransaction({
        to: PIXOTCHI_NFT_ADDRESS,
        data: dataWithSuffix,
        account: walletClient.account,
        chain: base,
      });
      const success = await waitForBaseTransactionSuccess(hash);
      if (success) successIds.push(id);
      else failedIds.push(id);
    } catch {
      failedIds.push(id);
    }
  }

  return { successIds, failedIds };
};

/**
 * Transfer a batch of land NFTs to a destination wallet.
 */
export const transferLands = async (
  walletClient: WalletClient,
  toAddress: string,
  landTokenIds: bigint[],
): Promise<{ successIds: bigint[]; failedIds: bigint[] }> => {
  if (!walletClient?.account) throw new Error('No account connected');
  const from = walletClient.account.address;
  const to = getAddress(toAddress);

  const successIds: bigint[] = [];
  const failedIds: bigint[] = [];

  for (const id of landTokenIds) {
    try {
      // Encode function data and append builder code suffix for ERC-8021 attribution.
      const encodedData = encodeFunctionData({
        abi: ERC721_MIN_ABI,
        functionName: 'transferFrom',
        args: [from, to, id],
      });
      const dataWithSuffix = appendBuilderSuffix(encodedData);

      const hash = await walletClient.sendTransaction({
        to: LAND_CONTRACT_ADDRESS,
        data: dataWithSuffix,
        account: walletClient.account,
        chain: base,
      });
      const success = await waitForBaseTransactionSuccess(hash);
      if (success) successIds.push(id);
      else failedIds.push(id);
    } catch {
      failedIds.push(id);
    }
  }

  return { successIds, failedIds };
};

/**
 * Transfer all Pixotchi (plants) and Land NFTs owned by the current wallet to a destination address.
 */
export const transferAllAssets = async (
  walletClient: WalletClient,
  ownerAddress: string,
  toAddress: string,
): Promise<{
  plants: { total: number; success: number; failed: number };
  lands: { total: number; success: number; failed: number };
}> => {
  const plants = await getPlantsByOwner(ownerAddress);
  const lands = await getLandsByOwner(ownerAddress);
  const plantIds = plants.map(p => p.id);
  const landIds = lands.map(l => l.tokenId);

  const plantRes = await transferPlants(walletClient, toAddress, plantIds);
  const landRes = await transferLands(walletClient, toAddress, landIds);

  return {
    plants: { total: plantIds.length, success: plantRes.successIds.length, failed: plantRes.failedIds.length },
    lands: { total: landIds.length, success: landRes.successIds.length, failed: landRes.failedIds.length },
  };
};

// Token balance (returns raw bigint for precision)
// Get token balance for any ERC20 token
export const getTokenBalanceForToken = async (
  address: string,
  tokenAddress: `0x${string}`,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<bigint> => {
  return retryWithBackoff(async () => {
    const balance = await readClient.readContract({
      address: tokenAddress,
      abi: PIXOTCHI_TOKEN_ABI, // ERC20 ABI is standard
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    }) as bigint;

    return balance; // Return raw bigint for precision
  });
};

export const getTokenBalance = async (
  address: string,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<bigint> => {
  return getTokenBalanceForToken(address, PIXOTCHI_TOKEN_ADDRESS, readClient);
};

export const getRevivePrice = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<bigint> => {
  return retryWithBackoff(async () => {
    return await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'getRevivePrice',
    }) as bigint;
  });
};

// Helper function for formatted token balance
export const getFormattedTokenBalance = async (address: string): Promise<number> => {
  const balance = await getTokenBalance(address);
  return Number(balance) / 1e18; // Convert from wei to token units
};

// Get formatted token balance for any ERC20 token
export const getFormattedTokenBalanceForToken = async (address: string, tokenAddress: `0x${string}`): Promise<number> => {
  const balance = await getTokenBalanceForToken(address, tokenAddress);
  const readClient = getReadClient();
  let decimals = 18;
  try {
    decimals = await retryWithBackoff(async () => {
      return await readClient.readContract({
        address: tokenAddress,
        abi: PIXOTCHI_TOKEN_ABI,
        functionName: 'decimals',
      }) as number;
    });
  } catch (error) {
    console.warn(`Failed to fetch token decimals for ${tokenAddress}, using 18`, error);
  }
  return Number(balance) / (10 ** decimals);
};

// Get token symbol
export const getTokenSymbol = async (tokenAddress: `0x${string}`): Promise<string> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    try {
      const symbol = await readClient.readContract({
        address: tokenAddress,
        abi: PIXOTCHI_TOKEN_ABI,
        functionName: 'symbol',
      }) as string;
      return symbol;
    } catch {
      // Fallback to truncated address if symbol fetch fails
      return `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
    }
  });
};

// Raw SEED allowance for Land contract interactions (e.g., marketplace)
export const getSeedAllowanceForLand = async (ownerAddress: string): Promise<bigint> => {
  if (!ownerAddress) return BigInt(0);
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    // Use consistent PIXOTCHI_TOKEN_ADDRESS
    return await readClient.readContract({
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'allowance',
      args: [ownerAddress as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;
  });
};

// Raw LEAF allowance for Land contract interactions (e.g., marketplace)
export const getLeafAllowanceForLand = async (ownerAddress: string): Promise<bigint> => {
  if (!ownerAddress) return BigInt(0);
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    return await readClient.readContract({
      address: LEAF_CONTRACT_ADDRESS,
      abi: leafAbi,
      functionName: 'allowance',
      args: [ownerAddress as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;
  });
};

// Check token approval for a specific token and spender
// Check token approval for a specific token and spender
export const checkTokenApprovalForToken = async (
  address: string,
  tokenAddress: `0x${string}`,
  spenderAddress: `0x${string}`
): Promise<bigint> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    const allowance = await readClient.readContract({
      address: tokenAddress,
      abi: PIXOTCHI_TOKEN_ABI, // ERC20 ABI is standard
      functionName: 'allowance',
      args: [address as `0x${string}`, spenderAddress],
    }) as bigint;

    return allowance;
  });
};

// Check token approval (backward compatible, defaults to SEED token)
export const checkTokenApproval = async (address: string, tokenAddress?: `0x${string}`): Promise<bigint> => {
  const token = tokenAddress || PIXOTCHI_TOKEN_ADDRESS;
  return checkTokenApprovalForToken(address, token, PIXOTCHI_NFT_ADDRESS);
};

// Check SEED approval for Land Minting
export const checkLandMintApproval = async (address: string): Promise<bigint> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    // Check SEED (PIXOTCHI_TOKEN_ADDRESS) allowance for Land contract
    const allowance = await readClient.readContract({
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'allowance',
      args: [address as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;

    return allowance;
  });
};

// Check PIXOTCHI (Creator Token) allowance for Land Building Speedups
export const checkLandSpeedUpApproval = async (address: string): Promise<bigint> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    // Check PIXOTCHI (CREATOR_TOKEN_ADDRESS) allowance for Land contract
    const allowance = await readClient.readContract({
      address: CREATOR_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'allowance',
      args: [address as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;

    return allowance;
  });
};

// Check LEAF token allowance for building upgrades
export const checkLeafTokenApproval = async (address: string): Promise<bigint> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    const allowance = await readClient.readContract({
      address: LEAF_CONTRACT_ADDRESS,
      abi: leafAbi,
      functionName: 'allowance',
      args: [address as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;

    return allowance;
  });
};

// Get payment info for a specific strain
export const getStrainPaymentInfo = async (
  strainId: number,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<{ token: `0x${string}`; price: bigint }> => {
  return retryWithBackoff(async () => {
    const result = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'getStrainPaymentInfo',
      args: [BigInt(strainId)],
    }) as [string, bigint];

    return {
      token: getAddress(result[0]),
      price: result[1],
    };
  });
};

// Get strain information (following main app pattern)
export const getStrainInfo = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<Strain[]> => {
  return retryWithBackoff(async () => {
    const strains = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'getAllStrainInfo',
      args: [],
    }) as UntypedValue[];

    // Fetch payment info for each strain in parallel
    const strainsWithPaymentInfo = await Promise.all(
      strains.map(async (strain: UntypedValue) => {
        const strainId = Number(strain.id);
        let paymentToken: `0x${string}` | undefined;
        let paymentPrice: bigint | undefined;

        try {
          const paymentInfo = await getStrainPaymentInfo(strainId, readClient);
          paymentToken = paymentInfo.token;
          paymentPrice = paymentInfo.price;
        } catch (error) {
          // If payment info fetch fails, fall back to default SEED token
          console.warn(`Failed to fetch payment info for strain ${strainId}:`, error);
        }

        return {
          id: strainId,
          name: strain.name || '',
          mintPrice: Number(strain.mintPrice) / 1e18, // Convert from wei
          totalSupply: Number(strain.totalSupply),
          totalMinted: Number(strain.totalMinted),
          maxSupply: Number(strain.maxSupply),
          isActive: Boolean(strain.isActive),
          getStrainTotalLeft: Number(strain.getStrainTotalLeft),
          strainInitialTOD: Number(strain.strainInitialTOD),
          paymentToken,
          paymentPrice,
        };
      })
    );

    return strainsWithPaymentInfo;
  });
};

// Get shop items
export const getShopItems = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<ShopItem[]> => {
  return retryWithBackoff(async () => {
    const items = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'shopGetAllItems',
      args: [],
    }) as UntypedValue[];

    return items.map((item: UntypedValue) => ({
      id: String(item.id),
      name: item.name || '',
      price: Number(item.price) / 1e18, // Convert from wei
      effectTime: Number(item.expireTime),
    }));
  });
};

// Approve token spending
export const approveTokenSpending = async (walletClient: WalletClient): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');

  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

  const hash = await walletClient.writeContract({
    address: PIXOTCHI_TOKEN_ADDRESS,
    abi: PIXOTCHI_TOKEN_ABI,
    functionName: 'approve',
    args: [PIXOTCHI_NFT_ADDRESS, maxApproval],
    account: walletClient.account!,
    chain: base,
  });

  return waitForBaseTransactionSuccess(hash);
};

// Mint plant
export const mintPlant = async (walletClient: WalletClient, strain: number): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'mint',
    args: [BigInt(strain)],
    account: walletClient.account!,
    chain: base,
  });

  return waitForBaseTransactionSuccess(hash);
};

// Claim plant rewards (burns score and resets level)
export const claimPlantRewards = async (walletClient: WalletClient, plantId: number): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  const hash = await walletClient.writeContract({
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'redeem',
    args: [BigInt(plantId)],
    account: walletClient.account!,
    chain: base,
  });
  return waitForBaseTransactionSuccess(hash);
};

// Buy shop item
export const buyShopItem = async (
  walletClient: WalletClient,
  plantId: number,
  itemId: string
): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'shopBuyItem',
    args: [BigInt(plantId), BigInt(itemId)],
    account: walletClient.account!,
    chain: base,
  });

  return waitForBaseTransactionSuccess(hash);
};

// Get all shop items
export const getAllShopItems = async (): Promise<ShopItem[]> => {
  const readClient = getReadClient();

  try {
    const items = await retryWithBackoff(() =>
      readClient.readContract({
        address: PIXOTCHI_NFT_ADDRESS,
        abi: PIXOTCHI_NFT_ABI,
        functionName: 'shopGetAllItems',
      })
    );

    return (items as UntypedValue[]).map((item: UntypedValue) => ({
      id: String(item.id),
      name: item.name || '',
      price: item.price || BigInt(0),
      effectTime: Number(item.expireTime || 0),
    }));
  } catch (error) {
    console.error('Error fetching shop items:', error);
    return [];
  }
};

// Get all garden items
export const getAllGardenItems = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<GardenItem[]> => {
  try {
    const items = await retryWithBackoff(() =>
      readClient.readContract({
        address: PIXOTCHI_NFT_ADDRESS,
        abi: PIXOTCHI_NFT_ABI,
        functionName: 'getAllGardenItem',
      })
    );

    return (items as UntypedValue[]).map((item: UntypedValue) => ({
      id: String(item.id),
      name: item.name || '',
      price: item.price || BigInt(0),
      points: Number(item.points),
      timeExtension: Number(item.timeExtension),
    }));
  } catch (error) {
    console.error('Error fetching garden items:', error);
    return [];
  }
};

// Buy garden item
export const buyGardenItem = async (
  walletClient: WalletClient,
  plantId: number,
  itemId: string
): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'buyAccessory',
    args: [BigInt(plantId), BigInt(itemId)],
    account: walletClient.account!,
    chain: base,
  });

  return waitForBaseTransactionSuccess(hash);
};

// Get swap quote with improved error handling
export const getSwapQuote = async (ethAmount: string): Promise<{ quote: string; error?: string }> => {
  if (!ethAmount || isNaN(Number(ethAmount)) || Number(ethAmount) <= 0) {
    return { quote: "0" };
  }

  const readClient = getReadClient();

  try {
    const amountIn = parseUnits(ethAmount, 18);

    if (amountIn <= BigInt(0)) {
      return { quote: "0", error: "Invalid amount" };
    }

    const amountsOut = await readClient.readContract({
      address: UNISWAP_ROUTER_ADDRESS,
      abi: UniswapAbi,
      functionName: 'getAmountsOut',
      args: [amountIn, [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS]],
    }) as bigint[];

    if (!amountsOut || amountsOut.length < 2 || amountsOut[1] <= BigInt(0)) {
      return { quote: "0", error: "No liquidity available" };
    }

    return { quote: formatUnits(amountsOut[1], 18) };
  } catch (error: UntypedValue) {
    // Log error details for debugging (only in development)
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching swap quote:', error);
    }

    // Provide user-friendly error messages
    let errorMessage = "Unable to get quote";
    if (error?.message?.includes('insufficient reserves')) {
      errorMessage = "Insufficient liquidity";
    } else if (error?.message?.includes('network')) {
      errorMessage = "Network error, please try again";
    } else if (error?.message?.includes('timeout')) {
      errorMessage = "Request timeout, please try again";
    }

    return { quote: "0", error: errorMessage };
  }
};

// Get ETH quote for a specific SEED amount (inverse of getSwapQuote)
// Uses getAmountsIn to calculate how much ETH is needed for exact SEED output
export const getEthQuoteForSeedAmount = async (seedAmount: bigint): Promise<{
  ethAmount: bigint;
  ethAmountWithBuffer: bigint;
  seedAmount: bigint;
  error?: string;
}> => {
  if (seedAmount <= BigInt(0)) {
    return { ethAmount: BigInt(0), ethAmountWithBuffer: BigInt(0), seedAmount: BigInt(0), error: "Invalid seed amount" };
  }

  const readClient = getReadClient();

  try {
    // getAmountsIn returns [inputAmount, outputAmount] for exact output
    const amounts = await readClient.readContract({
      address: UNISWAP_ROUTER_ADDRESS,
      abi: UniswapAbi,
      functionName: 'getAmountsIn',
      args: [seedAmount, [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS]],
    }) as bigint[];

    if (!amounts || amounts.length < 2 || amounts[0] <= BigInt(0)) {
      return { ethAmount: BigInt(0), ethAmountWithBuffer: BigInt(0), seedAmount, error: "No liquidity available" };
    }

    const ethNeeded = amounts[0];
    // Add 6% buffer for slippage protection
    const ethWithBuffer = (ethNeeded * BigInt(106)) / BigInt(100);

    return {
      ethAmount: ethNeeded,
      ethAmountWithBuffer: ethWithBuffer,
      seedAmount,
    };
  } catch (error: UntypedValue) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[getEthQuoteForSeedAmount] Error:', error);
    }

    let errorMessage = "Unable to get ETH quote";
    if (error?.message?.includes('insufficient')) {
      errorMessage = "Insufficient liquidity";
    } else if (error?.message?.includes('network')) {
      errorMessage = "Network error";
    }

    return { ethAmount: BigInt(0), ethAmountWithBuffer: BigInt(0), seedAmount, error: errorMessage };
  }
};

// Execute swap
export const executeSwap = async (walletClient: WalletClient, ethAmount: string): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');

  const readClient = getReadClient();
  const amountIn = parseUnits(ethAmount, 18);

  const amountsOut = await readClient.readContract({
    address: UNISWAP_ROUTER_ADDRESS,
    abi: UniswapAbi,
    functionName: 'getAmountsOut',
    args: [amountIn, [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS]],
  }) as bigint[];

  const amountOutMin = amountsOut[1] * BigInt(95) / BigInt(100); // 5% slippage
  const deadline = Math.floor(Date.now() / 1000) + 60 * 5; // 5 minutes from now

  const hash = await walletClient.writeContract({
    address: UNISWAP_ROUTER_ADDRESS,
    abi: UniswapAbi,
    functionName: 'swapExactETHForTokens',
    args: [
      amountOutMin,
      [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS],
      walletClient.account.address,
      BigInt(deadline)
    ],
    value: amountIn,
    account: walletClient.account,
    chain: base,
  });

  return waitForBaseTransactionSuccess(hash);
};

// -------------------- Fence HELPERS --------------------

export type FenceV2Config = {
  pricePerDay: bigint;
  minDurationDays: number;
  maxDurationDays: number;
};

const normalizeFenceV2Config = (result: UntypedValue): FenceV2Config => {
  const priceRaw = result?.pricePerDay ?? result?.[0] ?? 0;
  const hasExplicitMin =
    typeof result?.minDurationDays !== 'undefined' ||
    typeof result?.minDays !== 'undefined' ||
    typeof result?.[2] !== 'undefined';
  const minRaw = hasExplicitMin
    ? (result?.minDurationDays ?? result?.minDays ?? result?.[1] ?? 1)
    : 1;
  const maxRaw = hasExplicitMin
    ? (result?.maxDurationDays ?? result?.maxDays ?? result?.[2] ?? result?.[1] ?? 30)
    : (result?.maxDurationDays ?? result?.maxDays ?? result?.[1] ?? 30);
  return {
    pricePerDay: BigInt(priceRaw ?? 0),
    minDurationDays: Number(minRaw ?? 0),
    maxDurationDays: Number(maxRaw ?? 0),
  };
};

export const getFenceV2Config = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<FenceV2Config | null> => {
  try {
    const raw = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: FENCE_V2_EXTENSION_ADDRESS,
        abi: fenceV2Abi,
        functionName: 'fenceV2GetConfig',
      });
    });
    return normalizeFenceV2Config(raw);
  } catch (error) {
    console.warn('getFenceV2Config failed:', error);
    return null;
  }
};

export const quoteFenceV2 = async (
  days: number,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<bigint> => {
  if (!Number.isFinite(days) || days <= 0) return BigInt(0);
  try {
    const quote = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: FENCE_V2_EXTENSION_ADDRESS,
        abi: fenceV2Abi,
        functionName: 'fenceV2Quote',
        args: [BigInt(days)],
      });
    });
    if (typeof quote === 'bigint') return quote;
    const numeric = (quote ?? 0) as number | string | bigint;
    return BigInt(numeric);
  } catch (error) {
    console.warn('quoteFenceV2 failed:', error);
    return BigInt(0);
  }
};

export const buildFenceV2PurchaseCall = (plantId: number, days: number): { address: `0x${string}`; abi: typeof fenceV2Abi; functionName: 'fenceV2Purchase'; args: [bigint, bigint] } => {
  return {
    address: FENCE_V2_EXTENSION_ADDRESS,
    abi: fenceV2Abi,
    functionName: 'fenceV2Purchase',
    args: [BigInt(plantId), BigInt(days)],
  };
};

export const buyFenceV2 = async (walletClient: WalletClient, plantId: number, days: number): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  const hash = await walletClient.writeContract({
    address: FENCE_V2_EXTENSION_ADDRESS,
    abi: fenceV2Abi,
    functionName: 'fenceV2Purchase',
    args: [BigInt(plantId), BigInt(days)],
    account: walletClient.account!,
    chain: base,
  });
  return waitForBaseTransactionSuccess(hash);
};

export const setFenceV2PricePerDay = async (walletClient: WalletClient, pricePerDay: bigint): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  const hash = await walletClient.writeContract({
    address: FENCE_V2_EXTENSION_ADDRESS,
    abi: fenceV2Abi,
    functionName: 'fenceV2SetPricePerDay',
    args: [pricePerDay],
    account: walletClient.account!,
    chain: base,
  });
  return waitForBaseTransactionSuccess(hash);
};

// LEAF token balance (returns raw bigint for precision)
export const getLeafBalance = async (
  address: string,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<bigint> => {
  return retryWithBackoff(async () => {
    const balance = await readClient.readContract({
      address: LEAF_CONTRACT_ADDRESS,
      abi: leafAbi,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });

    return balance as bigint;
  });
};

// Building Management Functions
export const getVillageBuildingsByLandId = async (landId: bigint): Promise<UntypedValue[]> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    const buildings = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'villageGetVillageBuildingsByLandId',
      args: [landId],
    });

    return buildings as UntypedValue[];
  });
};

export const getTownBuildingsByLandId = async (landId: bigint): Promise<UntypedValue[]> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    const buildings = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'townGetBuildingsByLandId',
      args: [landId],
    });

    return buildings as UntypedValue[];
  });
};

const normalizeBarracksConfig = (value: UntypedValue): BarracksConfig => ({
  initialized: Boolean(value?.initialized ?? value?.[0] ?? false),
  enabled: Boolean(value?.enabled ?? value?.[1] ?? false),
  buildToken: String(value?.buildToken ?? value?.[2] ?? ZERO_ADDRESS),
  buildCost: BigInt(value?.buildCost ?? value?.[3] ?? 0),
  buildReceiver: String(value?.buildReceiver ?? value?.[4] ?? ZERO_ADDRESS),
  trainingToken: String(value?.trainingToken ?? value?.[5] ?? ZERO_ADDRESS),
  trainingCost: BigInt(value?.trainingCost ?? value?.[6] ?? 0),
  trainingReceiver: String(value?.trainingReceiver ?? value?.[7] ?? ZERO_ADDRESS),
  trainingTimePerTroop: BigInt(value?.trainingTimePerTroop ?? value?.[8] ?? 0),
  attackCooldown: BigInt(value?.attackCooldown ?? value?.[9] ?? 0),
  defenseCooldown: BigInt(value?.defenseCooldown ?? value?.[10] ?? 0),
  lootPercentageBps: Number(value?.lootPercentageBps ?? value?.[11] ?? 0),
  casualtyScaleBps: Number(value?.casualtyScaleBps ?? value?.[12] ?? 0),
  successfulRaidXP: BigInt(value?.successfulRaidXP ?? value?.[13] ?? 0),
  successfulDefenseXP: BigInt(value?.successfulDefenseXP ?? value?.[14] ?? 0),
  troopAttackStrength: BigInt(value?.troopAttackStrength ?? value?.[15] ?? 0),
  troopDefenseStrength: BigInt(value?.troopDefenseStrength ?? value?.[16] ?? 0),
  troopCarryPoints: BigInt(value?.troopCarryPoints ?? value?.[17] ?? 0),
  troopCarryLifetime: BigInt(value?.troopCarryLifetime ?? value?.[18] ?? 0),
  maxTroopsPerLand: BigInt(value?.maxTroopsPerLand ?? value?.[19] ?? 0),
});

const normalizeBarracksTroopConfigV2 = (value: UntypedValue) => ({
  trainingToken: String(value?.trainingToken ?? value?.[0] ?? ZERO_ADDRESS),
  trainingCost: BigInt(value?.trainingCost ?? value?.[1] ?? 0),
  trainingReceiver: String(value?.trainingReceiver ?? value?.[2] ?? ZERO_ADDRESS),
  trainingTimePerTroop: BigInt(value?.trainingTimePerTroop ?? value?.[3] ?? 0),
  troopAttackStrength: BigInt(value?.troopAttackStrength ?? value?.[4] ?? 0),
  troopDefenseStrength: BigInt(value?.troopDefenseStrength ?? value?.[5] ?? 0),
  troopCarryPoints: BigInt(value?.troopCarryPoints ?? value?.[6] ?? 0),
  troopCarryLifetime: BigInt(value?.troopCarryLifetime ?? value?.[7] ?? 0),
  maxTroopsPerLand: BigInt(value?.maxTroopsPerLand ?? value?.[8] ?? 0),
});

const normalizeBarracksConfigV2 = (value: UntypedValue): BarracksConfigV2 => ({
  initialized: Boolean(value?.initialized ?? value?.[0] ?? false),
  enabled: Boolean(value?.enabled ?? value?.[1] ?? false),
  buildToken: String(value?.buildToken ?? value?.[2] ?? ZERO_ADDRESS),
  buildCost: BigInt(value?.buildCost ?? value?.[3] ?? 0),
  buildReceiver: String(value?.buildReceiver ?? value?.[4] ?? ZERO_ADDRESS),
  attackCooldown: BigInt(value?.attackCooldown ?? value?.[5] ?? 0),
  defenseCooldown: BigInt(value?.defenseCooldown ?? value?.[6] ?? 0),
  lootPercentageBps: Number(value?.lootPercentageBps ?? value?.[7] ?? 0),
  casualtyScaleBps: Number(value?.casualtyScaleBps ?? value?.[8] ?? 0),
  successfulRaidXP: BigInt(value?.successfulRaidXP ?? value?.[9] ?? 0),
  successfulDefenseXP: BigInt(value?.successfulDefenseXP ?? value?.[10] ?? 0),
  swordsman: normalizeBarracksTroopConfigV2(value?.swordsman ?? value?.[11]),
  phalanx: normalizeBarracksTroopConfigV2(value?.phalanx ?? value?.[12]),
});

const normalizeBarracksLandState = (value: UntypedValue): BarracksLandState => ({
  isBuilt: Boolean(value?.isBuilt ?? value?.[0] ?? false),
  stationedTroops: BigInt(value?.stationedTroops ?? value?.[1] ?? 0),
  trainingQueueAmount: BigInt(value?.trainingQueueAmount ?? value?.[2] ?? 0),
  readyToClaimTroops: BigInt(value?.readyToClaimTroops ?? value?.[3] ?? 0),
  trainingStartedAt: BigInt(value?.trainingStartedAt ?? value?.[4] ?? 0),
  trainingEndsAt: BigInt(value?.trainingEndsAt ?? value?.[5] ?? 0),
  nextTroopReadyAt: BigInt(value?.nextTroopReadyAt ?? value?.[6] ?? 0),
  lastAttackAt: BigInt(value?.lastAttackAt ?? value?.[7] ?? 0),
  lastDefendedAt: BigInt(value?.lastDefendedAt ?? value?.[8] ?? 0),
  attackCooldownEndsAt: BigInt(value?.attackCooldownEndsAt ?? value?.[9] ?? 0),
  defenseCooldownEndsAt: BigInt(value?.defenseCooldownEndsAt ?? value?.[10] ?? 0),
  totalTroops: BigInt(value?.totalTroops ?? value?.[11] ?? 0),
});

const normalizeBarracksLandStateV2 = (value: UntypedValue): BarracksLandStateV2 => ({
  isBuilt: Boolean(value?.isBuilt ?? value?.[0] ?? false),
  stationedSwordsmanTroops: BigInt(value?.stationedSwordsmanTroops ?? value?.[1] ?? 0),
  stationedPhalanxTroops: BigInt(value?.stationedPhalanxTroops ?? value?.[2] ?? 0),
  trainingQueueTroopType: Number(value?.trainingQueueTroopType ?? value?.[3] ?? 0),
  trainingQueueAmount: BigInt(value?.trainingQueueAmount ?? value?.[4] ?? 0),
  readyToClaimSwordsmanTroops: BigInt(value?.readyToClaimSwordsmanTroops ?? value?.[5] ?? 0),
  readyToClaimPhalanxTroops: BigInt(value?.readyToClaimPhalanxTroops ?? value?.[6] ?? 0),
  trainingStartedAt: BigInt(value?.trainingStartedAt ?? value?.[7] ?? 0),
  trainingEndsAt: BigInt(value?.trainingEndsAt ?? value?.[8] ?? 0),
  nextTroopReadyAt: BigInt(value?.nextTroopReadyAt ?? value?.[9] ?? 0),
  lastAttackAt: BigInt(value?.lastAttackAt ?? value?.[10] ?? 0),
  lastDefendedAt: BigInt(value?.lastDefendedAt ?? value?.[11] ?? 0),
  attackCooldownEndsAt: BigInt(value?.attackCooldownEndsAt ?? value?.[12] ?? 0),
  defenseCooldownEndsAt: BigInt(value?.defenseCooldownEndsAt ?? value?.[13] ?? 0),
  totalSwordsmanTroops: BigInt(value?.totalSwordsmanTroops ?? value?.[14] ?? 0),
  totalPhalanxTroops: BigInt(value?.totalPhalanxTroops ?? value?.[15] ?? 0),
});

const normalizeBarracksRaidReport = (value: UntypedValue): BarracksRaidReport => ({
  raidId: BigInt(value?.raidId ?? value?.[0] ?? 0),
  timestamp: BigInt(value?.timestamp ?? value?.[1] ?? 0),
  attackerLandId: BigInt(value?.attackerLandId ?? value?.[2] ?? 0),
  defenderLandId: BigInt(value?.defenderLandId ?? value?.[3] ?? 0),
  attackerWon: Boolean(value?.attackerWon ?? value?.[4] ?? false),
  troopsSent: BigInt(value?.troopsSent ?? value?.[5] ?? 0),
  attackerTroopsBefore: BigInt(value?.attackerTroopsBefore ?? value?.[6] ?? 0),
  defenderTroopsBefore: BigInt(value?.defenderTroopsBefore ?? value?.[7] ?? 0),
  attackerTroopsLost: BigInt(value?.attackerTroopsLost ?? value?.[8] ?? 0),
  defenderTroopsLost: BigInt(value?.defenderTroopsLost ?? value?.[9] ?? 0),
  survivingAttackers: BigInt(value?.survivingAttackers ?? value?.[10] ?? 0),
  survivingDefenders: BigInt(value?.survivingDefenders ?? value?.[11] ?? 0),
  attackerPower: BigInt(value?.attackerPower ?? value?.[12] ?? 0),
  defenderPower: BigInt(value?.defenderPower ?? value?.[13] ?? 0),
  pendingPointsSettled: BigInt(value?.pendingPointsSettled ?? value?.[14] ?? 0),
  pendingLifetimeSettled: BigInt(value?.pendingLifetimeSettled ?? value?.[15] ?? 0),
  pointsStolen: BigInt(value?.pointsStolen ?? value?.[16] ?? 0),
  lifetimeStolen: BigInt(value?.lifetimeStolen ?? value?.[17] ?? 0),
});

const normalizeBarracksRaidReportV2 = (value: UntypedValue): BarracksRaidReportV2 => ({
  raidId: BigInt(value?.raidId ?? value?.[0] ?? 0),
  timestamp: BigInt(value?.timestamp ?? value?.[1] ?? 0),
  attackerLandId: BigInt(value?.attackerLandId ?? value?.[2] ?? 0),
  defenderLandId: BigInt(value?.defenderLandId ?? value?.[3] ?? 0),
  attackerWon: Boolean(value?.attackerWon ?? value?.[4] ?? false),
  swordsmenSent: BigInt(value?.swordsmenSent ?? value?.[5] ?? 0),
  phalanxSent: BigInt(value?.phalanxSent ?? value?.[6] ?? 0),
  attackerSwordsmenBefore: BigInt(value?.attackerSwordsmenBefore ?? value?.[7] ?? 0),
  attackerPhalanxBefore: BigInt(value?.attackerPhalanxBefore ?? value?.[8] ?? 0),
  defenderSwordsmenBefore: BigInt(value?.defenderSwordsmenBefore ?? value?.[9] ?? 0),
  defenderPhalanxBefore: BigInt(value?.defenderPhalanxBefore ?? value?.[10] ?? 0),
  attackerSwordsmenLost: BigInt(value?.attackerSwordsmenLost ?? value?.[11] ?? 0),
  attackerPhalanxLost: BigInt(value?.attackerPhalanxLost ?? value?.[12] ?? 0),
  defenderSwordsmenLost: BigInt(value?.defenderSwordsmenLost ?? value?.[13] ?? 0),
  defenderPhalanxLost: BigInt(value?.defenderPhalanxLost ?? value?.[14] ?? 0),
  survivingAttackerSwordsmen: BigInt(value?.survivingAttackerSwordsmen ?? value?.[15] ?? 0),
  survivingAttackerPhalanx: BigInt(value?.survivingAttackerPhalanx ?? value?.[16] ?? 0),
  survivingDefenderSwordsmen: BigInt(value?.survivingDefenderSwordsmen ?? value?.[17] ?? 0),
  survivingDefenderPhalanx: BigInt(value?.survivingDefenderPhalanx ?? value?.[18] ?? 0),
  attackerPower: BigInt(value?.attackerPower ?? value?.[19] ?? 0),
  defenderPower: BigInt(value?.defenderPower ?? value?.[20] ?? 0),
  pendingPointsSettled: BigInt(value?.pendingPointsSettled ?? value?.[21] ?? 0),
  pendingLifetimeSettled: BigInt(value?.pendingLifetimeSettled ?? value?.[22] ?? 0),
  pointsStolen: BigInt(value?.pointsStolen ?? value?.[23] ?? 0),
  lifetimeStolen: BigInt(value?.lifetimeStolen ?? value?.[24] ?? 0),
});

const normalizeBarracksRaidPreview = (value: UntypedValue): BarracksRaidPreview => ({
  statusCode: Number(value?.statusCode ?? value?.[0] ?? 0),
  attackerWon: Boolean(value?.attackerWon ?? value?.[1] ?? false),
  troopsRequested: BigInt(value?.troopsRequested ?? value?.[2] ?? 0),
  attackerTroopsBefore: BigInt(value?.attackerTroopsBefore ?? value?.[3] ?? 0),
  defenderTroopsBefore: BigInt(value?.defenderTroopsBefore ?? value?.[4] ?? 0),
  attackerTroopsLost: BigInt(value?.attackerTroopsLost ?? value?.[5] ?? 0),
  defenderTroopsLost: BigInt(value?.defenderTroopsLost ?? value?.[6] ?? 0),
  survivingAttackers: BigInt(value?.survivingAttackers ?? value?.[7] ?? 0),
  survivingDefenders: BigInt(value?.survivingDefenders ?? value?.[8] ?? 0),
  attackerPower: BigInt(value?.attackerPower ?? value?.[9] ?? 0),
  defenderPower: BigInt(value?.defenderPower ?? value?.[10] ?? 0),
  pendingPoints: BigInt(value?.pendingPoints ?? value?.[11] ?? 0),
  pendingLifetime: BigInt(value?.pendingLifetime ?? value?.[12] ?? 0),
  carryPointsCap: BigInt(value?.carryPointsCap ?? value?.[13] ?? 0),
  carryLifetimeCap: BigInt(value?.carryLifetimeCap ?? value?.[14] ?? 0),
  estimatedPointsLoot: BigInt(value?.estimatedPointsLoot ?? value?.[15] ?? 0),
  estimatedLifetimeLoot: BigInt(value?.estimatedLifetimeLoot ?? value?.[16] ?? 0),
  attackerCooldownEndsAt: BigInt(value?.attackerCooldownEndsAt ?? value?.[17] ?? 0),
  defenderCooldownEndsAt: BigInt(value?.defenderCooldownEndsAt ?? value?.[18] ?? 0),
});

const normalizeBarracksRaidPreviewV2 = (value: UntypedValue): BarracksRaidPreviewV2 => ({
  statusCode: Number(value?.statusCode ?? value?.[0] ?? 0),
  attackerWon: Boolean(value?.attackerWon ?? value?.[1] ?? false),
  swordsmenRequested: BigInt(value?.swordsmenRequested ?? value?.[2] ?? 0),
  phalanxRequested: BigInt(value?.phalanxRequested ?? value?.[3] ?? 0),
  attackerSwordsmenBefore: BigInt(value?.attackerSwordsmenBefore ?? value?.[4] ?? 0),
  attackerPhalanxBefore: BigInt(value?.attackerPhalanxBefore ?? value?.[5] ?? 0),
  defenderSwordsmenBefore: BigInt(value?.defenderSwordsmenBefore ?? value?.[6] ?? 0),
  defenderPhalanxBefore: BigInt(value?.defenderPhalanxBefore ?? value?.[7] ?? 0),
  attackerSwordsmenLost: BigInt(value?.attackerSwordsmenLost ?? value?.[8] ?? 0),
  attackerPhalanxLost: BigInt(value?.attackerPhalanxLost ?? value?.[9] ?? 0),
  defenderSwordsmenLost: BigInt(value?.defenderSwordsmenLost ?? value?.[10] ?? 0),
  defenderPhalanxLost: BigInt(value?.defenderPhalanxLost ?? value?.[11] ?? 0),
  survivingAttackerSwordsmen: BigInt(value?.survivingAttackerSwordsmen ?? value?.[12] ?? 0),
  survivingAttackerPhalanx: BigInt(value?.survivingAttackerPhalanx ?? value?.[13] ?? 0),
  survivingDefenderSwordsmen: BigInt(value?.survivingDefenderSwordsmen ?? value?.[14] ?? 0),
  survivingDefenderPhalanx: BigInt(value?.survivingDefenderPhalanx ?? value?.[15] ?? 0),
  attackerPower: BigInt(value?.attackerPower ?? value?.[16] ?? 0),
  defenderPower: BigInt(value?.defenderPower ?? value?.[17] ?? 0),
  pendingPoints: BigInt(value?.pendingPoints ?? value?.[18] ?? 0),
  pendingLifetime: BigInt(value?.pendingLifetime ?? value?.[19] ?? 0),
  carryPointsCap: BigInt(value?.carryPointsCap ?? value?.[20] ?? 0),
  carryLifetimeCap: BigInt(value?.carryLifetimeCap ?? value?.[21] ?? 0),
  estimatedPointsLoot: BigInt(value?.estimatedPointsLoot ?? value?.[22] ?? 0),
  estimatedLifetimeLoot: BigInt(value?.estimatedLifetimeLoot ?? value?.[23] ?? 0),
  attackerCooldownEndsAt: BigInt(value?.attackerCooldownEndsAt ?? value?.[24] ?? 0),
  defenderCooldownEndsAt: BigInt(value?.defenderCooldownEndsAt ?? value?.[25] ?? 0),
});

export const barracksGetConfig = async (): Promise<BarracksConfig | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksGetConfig',
      });
    });
    return normalizeBarracksConfig(result);
  } catch (error) {
    console.warn('Failed to get barracks config:', error);
    return null;
  }
};

export const barracksGetConfigV2 = async (): Promise<BarracksConfigV2 | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksGetConfigV2',
      });
    });
    return normalizeBarracksConfigV2(result);
  } catch (error) {
    console.warn('Failed to get barracks V2 config:', error);
    return null;
  }
};

export const barracksGetLandState = async (landId: bigint): Promise<BarracksLandState | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksGetLandState',
        args: [landId],
      });
    });
    return normalizeBarracksLandState(result);
  } catch (error) {
    console.warn('Failed to get barracks land state:', error);
    return null;
  }
};

export const barracksGetLandStateV2 = async (
  landId: bigint,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<BarracksLandStateV2 | null> => {
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksGetLandStateV2',
        args: [landId],
      });
    });
    return normalizeBarracksLandStateV2(result);
  } catch (error) {
    console.warn('Failed to get barracks V2 land state:', error);
    return null;
  }
};

export const barracksGetEligibleAttackableLandIds = async (attackerLandId: bigint): Promise<bigint[]> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksGetEligibleAttackableLandIds',
        args: [attackerLandId],
      });
    });
    return Array.isArray(result) ? (result as bigint[]) : [];
  } catch (error) {
    console.warn('Failed to get eligible barracks targets:', error);
    return [];
  }
};

export const barracksGetLastOutgoingReport = async (landId: bigint): Promise<BarracksRaidReport | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksGetLastOutgoingReport',
        args: [landId],
      });
    });
    return normalizeBarracksRaidReport(result);
  } catch (error) {
    console.warn('Failed to get last outgoing barracks report:', error);
    return null;
  }
};

export const barracksGetLastOutgoingReportV2 = async (landId: bigint): Promise<BarracksRaidReportV2 | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksGetLastOutgoingReportV2',
        args: [landId],
      });
    });
    return normalizeBarracksRaidReportV2(result);
  } catch (error) {
    console.warn('Failed to get last outgoing barracks V2 report:', error);
    return null;
  }
};

export const barracksGetLastIncomingReport = async (landId: bigint): Promise<BarracksRaidReport | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksGetLastIncomingReport',
        args: [landId],
      });
    });
    return normalizeBarracksRaidReport(result);
  } catch (error) {
    console.warn('Failed to get last incoming barracks report:', error);
    return null;
  }
};

export const barracksGetLastIncomingReportV2 = async (landId: bigint): Promise<BarracksRaidReportV2 | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksGetLastIncomingReportV2',
        args: [landId],
      });
    });
    return normalizeBarracksRaidReportV2(result);
  } catch (error) {
    console.warn('Failed to get last incoming barracks V2 report:', error);
    return null;
  }
};

export const barracksPreviewRaid = async (
  attackerLandId: bigint,
  defenderLandId: bigint,
  troopsToSend: bigint,
): Promise<BarracksRaidPreview | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksPreviewRaid',
        args: [attackerLandId, defenderLandId, troopsToSend],
      });
    });
    return normalizeBarracksRaidPreview(result);
  } catch (error) {
    console.warn('Failed to preview barracks raid:', error);
    return null;
  }
};

export const barracksPreviewRaidV2 = async (
  attackerLandId: bigint,
  defenderLandId: bigint,
  swordsmenToSend: bigint,
  phalanxToSend: bigint,
): Promise<BarracksRaidPreviewV2 | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: barracksAbi,
        functionName: 'barracksPreviewRaidV2',
        args: [attackerLandId, defenderLandId, swordsmenToSend, phalanxToSend],
      });
    });
    return normalizeBarracksRaidPreviewV2(result);
  } catch (error) {
    console.warn('Failed to preview barracks V2 raid:', error);
    return null;
  }
};

export const checkBarracksApproval = async (
  address: string,
  tokenAddress: string,
): Promise<bigint> => {
  return checkTokenApprovalForToken(
    address,
    tokenAddress as `0x${string}`,
    LAND_CONTRACT_ADDRESS,
  );
};

export const buildBarracksBuildCall = (landId: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: barracksAbi,
  functionName: 'barracksBuild' as const,
  args: [landId],
});

export const buildBarracksTrainCall = (landId: bigint, amount: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: barracksAbi,
  functionName: 'barracksTrainTroops' as const,
  args: [landId, amount],
});

export const buildBarracksTrainCallV2 = (landId: bigint, troopType: number, amount: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: barracksAbi,
  functionName: 'barracksTrainTroopsV2' as const,
  args: [landId, troopType, amount],
});

export const buildBarracksClaimCall = (landId: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: barracksAbi,
  functionName: 'barracksClaimTroops' as const,
  args: [landId],
});

export const buildBarracksAttackCall = (
  attackerLandId: bigint,
  defenderLandId: bigint,
  troopsToSend: bigint,
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: barracksAbi,
  functionName: 'barracksAttack' as const,
  args: [attackerLandId, defenderLandId, troopsToSend],
});

export const buildBarracksAttackCallV2 = (
  attackerLandId: bigint,
  defenderLandId: bigint,
  swordsmenToSend: bigint,
  phalanxToSend: bigint,
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: barracksAbi,
  functionName: 'barracksAttackV2' as const,
  args: [attackerLandId, defenderLandId, swordsmenToSend, phalanxToSend],
});

export const buildBarracksForceFinishTrainingCallV2 = (landId: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: barracksAbi,
  functionName: 'barracksForceFinishTrainingV2' as const,
  args: [landId],
});

export const buildBarracksAdminAddTroopsCallV2 = (
  landId: bigint,
  troopType: number,
  amount: bigint,
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: barracksAbi,
  functionName: 'barracksAdminAddTroopsV2' as const,
  args: [landId, troopType, amount],
});

export const buildBarracksAdminAddTroopsToAllBuiltCallV2 = (
  troopType: number,
  amount: bigint,
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: barracksAbi,
  functionName: 'barracksAdminAddTroopsToAllBuiltV2' as const,
  args: [troopType, amount],
});

export interface LandBuildingsBatchResult {
  landId: bigint;
  villageBuildings: UntypedValue[];
  townBuildings: UntypedValue[];
}

export const getLandBuildingsBatch = async (
  landIds: bigint[],
  options: { chunkSize?: number; readClient?: PixotchiReadClient } = {},
): Promise<LandBuildingsBatchResult[]> => {
  if (landIds.length === 0) return [];

  const { chunkSize = 15, readClient = getReadClient() } = options;
  const results: LandBuildingsBatchResult[] = [];

  for (let i = 0; i < landIds.length; i += chunkSize) {
    const chunk = landIds.slice(i, i + chunkSize);
    const contracts = chunk.flatMap((landId) => [
      {
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'villageGetVillageBuildingsByLandId' as const,
        args: [landId],
      },
      {
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'townGetBuildingsByLandId' as const,
        args: [landId],
      },
    ]);

    const chunkResults = await retryWithBackoff(async () => {
      return readClient.multicall({
        allowFailure: true,
        contracts,
      });
    });

    for (let index = 0; index < chunk.length; index++) {
      const landId = chunk[index];
      const villageEntry = chunkResults[index * 2];
      const townEntry = chunkResults[index * 2 + 1];

      const villageBuildings = Array.isArray(villageEntry?.result)
        ? (villageEntry.result as UntypedValue[])
        : [];
      const townBuildings = Array.isArray(townEntry?.result)
        ? (townEntry.result as UntypedValue[])
        : [];

      results.push({
        landId,
        villageBuildings,
        townBuildings,
      });
    }
  }

  return results;
};

// Quest slots
export type QuestSlot = {
  difficulty: number;
  startBlock: bigint;
  endBlock: bigint;
  pseudoRndBlock: bigint;
  coolDownBlock: bigint;
};

export const getQuestSlotsByLandId = async (
  landId: bigint,
  readClient: PixotchiReadClient = getReadClient(),
): Promise<QuestSlot[]> => {
  return retryWithBackoff(async () => {
    const slots = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'questGetByLandId',
      args: [landId],
    });
    // Ensure array of normalized objects
    return (slots as UntypedValue[]).map((s: UntypedValue) => ({
      difficulty: Number(s.difficulty ?? s[0] ?? 0),
      startBlock: BigInt(s.startBlock ?? s[1] ?? 0),
      endBlock: BigInt(s.endBlock ?? s[2] ?? 0),
      pseudoRndBlock: BigInt(s.pseudoRndBlock ?? s[3] ?? 0),
      coolDownBlock: BigInt(s.coolDownBlock ?? s[4] ?? 0),
    })) as QuestSlot[];
  });
};

// Village Building Upgrade Functions
export const upgradeVillageWithLeaf = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'villageUpgradeWithLeaf',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });

  return hash;
};

export const speedUpVillageWithSeed = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'villageSpeedUpWithSeed',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });

  return hash;
};

// Town Building Upgrade Functions
export const upgradeTownWithLeaf = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'townUpgradeWithLeaf',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });

  return hash;
};

export const speedUpTownWithSeed = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'townSpeedUpWithSeed',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });

  return hash;
};

// Village Production Claim Function
export const claimVillageProduction = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'villageClaimProduction',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });

  return hash;
};

// Leaderboard functions
export const getAliveTokenIds = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<number[]> => {
  return retryWithBackoff(async () => {
    const tokenIds = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'airdropGetAliveAndDeadTokenIds',
    }) as bigint[];

    return tokenIds.map(id => Number(id));
  });
};

export const getPlantsInfoExtended = async (
  tokenIds: number[],
  readClient: PixotchiReadClient = getReadClient(),
): Promise<Plant[]> => {
  return retryWithBackoff(async () => {
    const plants = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'getPlantsInfoExtended',
      args: [tokenIds.map(id => BigInt(id))],
    }) as UntypedValue[];

    // Fence V2 writes to the same extensions storage, so derive it from extensions
    // No need for separate RPC call to fenceV2GetPurchaseStats

    return plants.map((plant: UntypedValue) => {
      const plantId = Number(plant.id);
      const extensions = plant.extensions || [];
      // Derive Fence V2 state directly from extensions (same storage)
      const fenceV2 = deriveFenceV2StateFromExtensions(extensions);

      return {
        id: plantId,
        name: plant.name || '',
        score: Number(plant.score),
        status: Number(plant.status),
        rewards: Number(plant.rewards),
        level: Number(plant.level),
        timeUntilStarving: Number(plant.timeUntilStarving),
        stars: Number(plant.stars),
        strain: Number(plant.strain),
        timePlantBorn: plant.timePlantBorn ? plant.timePlantBorn.toString() : '0',
        lastAttackUsed: plant.lastAttackUsed ? plant.lastAttackUsed.toString() : '0',
        lastAttacked: plant.lastAttacked ? plant.lastAttacked.toString() : '0',
        statusStr: plant.statusStr || '',
        owner: plant.owner,
        extensions,
        fenceV2,
      };
    });
  });
};

// Get specific land owner
export const getLandOwner = async (landId: number): Promise<string> => {
  const readClient = getReadClient();
  try {
    const owner = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'ownerOf',
        args: [BigInt(landId)],
      });
    });
    return owner as string;
  } catch (error) {
    throw new BaseRpcError(`getLandOwner:${landId}`, error);
  }
};

// Fetch Lands leaderboard across full supply range
export type LandLeaderboardEntry = { landId: number; experiencePoints: bigint; name: string; owner: string };

export const getLandLeaderboard = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<LandLeaderboardEntry[]> => {
  return retryWithBackoff(async () => {
    // Determine total supply to cover full range
    const totalSupply = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'totalSupply',
    }) as bigint;

    const leaderboard = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'getLeaderboard',
      args: [BigInt(0), totalSupply],
    }) as UntypedValue[];

    return (leaderboard || []).map((entry: UntypedValue) => ({
      landId: Number(entry.landId ?? entry[0] ?? 0),
      experiencePoints: BigInt(entry.experiencePoints ?? entry[1] ?? 0),
      name: String(entry.name ?? entry[2] ?? ''),
      owner: String(entry.owner ?? entry[3] ?? ''), // Explicitly use entry[3] as fallback if named property missing
    }));
  });
};

// -------------------- ROUTER-BASED BULK TRANSFER --------------------

export const routerBatchTransfer = async (
  walletClient: WalletClient,
  toAddress: string,
  plantIds: number[],
  landIds: bigint[],
): Promise<{ hash: `0x${string}`; success: boolean }> => {
  if (!walletClient?.account) throw new Error('No account connected');
  if (!BATCH_ROUTER_ADDRESS) throw new Error('Batch router not configured');
  const to = getAddress(toAddress);

  // Build arguments
  const hasPlants = plantIds.length > 0;
  const hasLands = landIds.length > 0;

  let hash: `0x${string}`;
  let encodedData: `0x${string}`;

  if (hasPlants && hasLands) {
    // Single tx for both collections
    const tokens = [PIXOTCHI_NFT_ADDRESS, LAND_CONTRACT_ADDRESS] as const;
    const tokenIdsPerToken = [
      plantIds.map((id) => BigInt(id)),
      landIds
    ];
    encodedData = encodeFunctionData({
      abi: BATCH_ROUTER_ABI,
      functionName: 'batchTransfer721Multi',
      args: [tokens as UntypedValue as `0x${string}`[], to, tokenIdsPerToken],
    });
  } else if (hasPlants) {
    encodedData = encodeFunctionData({
      abi: BATCH_ROUTER_ABI,
      functionName: 'batchTransfer721',
      args: [PIXOTCHI_NFT_ADDRESS, to, plantIds.map((id) => BigInt(id))],
    });
  } else if (hasLands) {
    encodedData = encodeFunctionData({
      abi: BATCH_ROUTER_ABI,
      functionName: 'batchTransfer721',
      args: [LAND_CONTRACT_ADDRESS, to, landIds],
    });
  } else {
    throw new Error('No assets to transfer');
  }

  // Append builder code suffix for ERC-8021 attribution.
  const dataWithSuffix = appendBuilderSuffix(encodedData);

  hash = await walletClient.sendTransaction({
    to: BATCH_ROUTER_ADDRESS,
    data: dataWithSuffix,
    account: walletClient.account,
    chain: base,
  });

  const success = await waitForBaseTransactionSuccess(hash);
  return { hash, success };
};

// -------------------- KILL COOLDOWN HELPERS --------------------

/**
 * Get kill cooldown status from the onchain KillCooldown extension.
 * @param walletAddress The wallet address to check
 * @returns Object with canKill boolean and remainingSeconds
 */
export const getKillCooldown = async (walletAddress: string): Promise<{ canKill: boolean; remainingSeconds: number }> => {
  const readClient = getReadClient();
  try {
    const [canKillResult, remainingResult] = await retryWithBackoff(async () => {
      const results = await readClient.multicall({
        contracts: [
          {
            address: PIXOTCHI_NFT_ADDRESS,
            abi: KILL_COOLDOWN_ABI,
            functionName: 'canKill',
            args: [walletAddress as `0x${string}`],
          },
          {
            address: PIXOTCHI_NFT_ADDRESS,
            abi: KILL_COOLDOWN_ABI,
            functionName: 'getKillCooldownRemaining',
            args: [walletAddress as `0x${string}`],
          },
        ],
        allowFailure: true,
      });
      return results;
    });

    const canKill = canKillResult?.status === 'success' ? (canKillResult.result as boolean) : true;
    const remainingSeconds = remainingResult?.status === 'success' ? Number(remainingResult.result) : 0;

    return { canKill, remainingSeconds };
  } catch (error) {
    console.warn('Failed to fetch kill cooldown from contract, allowing kills:', error);
    // Graceful degradation: allow kills if contract read fails
    return { canKill: true, remainingSeconds: 0 };
  }
};

// -------------------- CASINO (ROULETTE) HELPERS - MULTI-BET VERSION --------------------

import { casinoAbi,CasinoBetType } from '@/public/abi/casino-abi';

export type CasinoBuildingConfig = {
  buildingToken: string;
  buildingCost: bigint;
};

export type CasinoConfig = {
  minBet: bigint;
  maxBet: bigint;
  bettingToken: string;
  rewardPool: string;
  enabled: boolean;
  maxBetsPerGame: bigint;
};

export type CasinoTokenConfig = {
  supported: boolean;
  minBet: bigint;
  maxBet: bigint;
  rewardPool: string;
  enabled: boolean;
  maxBetsPerGame: bigint;
};

export type CasinoActiveBet = {
  isActive: boolean;
  numBets: bigint;
  totalBetAmount: bigint;
  revealBlock: bigint;
  player: string;
  canReveal: boolean;
  isExpired: boolean;
};

export type CasinoActiveBetV2 = CasinoActiveBet & {
  bettingToken: string;
};

export type CasinoBetDetails = {
  betType: number;
  betNumbers: number[];
  betAmount: bigint;
};

export type CasinoStats = {
  totalWagered: bigint;
  totalWon: bigint;
  gamesPlayed: bigint;
};

/**
 * Check if casino is built on a land
 */
export const casinoIsBuilt = async (landId: bigint): Promise<boolean> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoIsBuilt',
        args: [landId],
      });
    });
    return result as boolean;
  } catch (error) {
    console.warn('Failed to check if casino is built:', error);
    return false;
  }
};

/**
 * Get casino building configuration (token and cost)
 */
export const casinoGetBuildingConfig = async (): Promise<CasinoBuildingConfig | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetBuildingConfig',
      });
    }) as [string, bigint];
    return {
      buildingToken: result[0],
      buildingCost: result[1],
    };
  } catch (error) {
    console.warn('Failed to get casino building config:', error);
    return null;
  }
};

/**
 * Get casino game configuration (bet limits, token, pool, enabled, maxBetsPerGame)
 */
export const casinoGetConfig = async (): Promise<CasinoConfig | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetConfig',
      });
    }) as [bigint, bigint, string, string, boolean, bigint];
    return {
      minBet: result[0],
      maxBet: result[1],
      bettingToken: result[2],
      rewardPool: result[3],
      enabled: result[4],
      maxBetsPerGame: result[5],
    };
  } catch (error) {
    console.warn('Failed to get casino config:', error);
    return null;
  }
};

export const casinoGetSupportedTokens = async (): Promise<string[]> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetSupportedTokens',
      });
    }) as string[];
    return result;
  } catch (error) {
    console.warn('Failed to get casino supported tokens:', error);
    return [];
  }
};

export const casinoGetTokenConfig = async (token: string): Promise<CasinoTokenConfig | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetTokenConfig',
        args: [token as `0x${string}`],
      });
    }) as [boolean, bigint, bigint, string, boolean, bigint];
    return {
      supported: result[0],
      minBet: result[1],
      maxBet: result[2],
      rewardPool: result[3],
      enabled: result[4],
      maxBetsPerGame: result[5],
    };
  } catch (error) {
    console.warn('Failed to get casino token config:', error);
    return null;
  }
};

/**
 * Get active game details for a land (multi-bet version)
 */
export const casinoGetActiveBet = async (landId: bigint): Promise<CasinoActiveBet | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetActiveBet',
        args: [landId],
      });
    }) as [boolean, bigint, bigint, bigint, string, boolean, boolean];
    return {
      isActive: result[0],
      numBets: result[1],
      totalBetAmount: result[2],
      revealBlock: result[3],
      player: result[4],
      canReveal: result[5],
      isExpired: result[6],
    };
  } catch (error) {
    console.warn('Failed to get active bet:', error);
    return null;
  }
};

export const casinoGetActiveBetV2 = async (landId: bigint): Promise<CasinoActiveBetV2 | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetActiveBetV2',
        args: [landId],
      });
    }) as [boolean, bigint, bigint, bigint, string, boolean, boolean, string];
    return {
      isActive: result[0],
      numBets: result[1],
      totalBetAmount: result[2],
      revealBlock: result[3],
      player: result[4],
      canReveal: result[5],
      isExpired: result[6],
      bettingToken: result[7],
    };
  } catch (error) {
    console.warn('Failed to get active bet v2:', error);
    return null;
  }
};

/**
 * Get details of a specific bet within an active game
 */
export const casinoGetBetDetails = async (landId: bigint, betIndex: number): Promise<CasinoBetDetails | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetBetDetails',
        args: [landId, BigInt(betIndex)],
      });
    }) as [number, number[], bigint];
    return {
      betType: result[0],
      betNumbers: result[1],
      betAmount: result[2],
    };
  } catch (error) {
    console.warn('Failed to get bet details:', error);
    return null;
  }
};

/**
 * Get max bets allowed per game
 */
export const casinoGetMaxBets = async (): Promise<bigint> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetMaxBets',
      });
    }) as bigint;
    return result;
  } catch (error) {
    console.warn('Failed to get max bets:', error);
    return BigInt(2); // Default
  }
};

/**
 * Get casino stats for a land
 */
export const casinoGetStats = async (landId: bigint): Promise<CasinoStats | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetStats',
        args: [landId],
      });
    }) as [bigint, bigint, bigint];
    return {
      totalWagered: result[0],
      totalWon: result[1],
      gamesPlayed: result[2],
    };
  } catch (error) {
    console.warn('Failed to get casino stats:', error);
    return null;
  }
};

export const casinoGetStatsByToken = async (landId: bigint, token: string): Promise<CasinoStats | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: casinoAbi,
        functionName: 'casinoGetStatsByToken',
        args: [landId, token as `0x${string}`],
      });
    }) as [bigint, bigint, bigint];
    return {
      totalWagered: result[0],
      totalWon: result[1],
      gamesPlayed: result[2],
    };
  } catch (error) {
    console.warn('Failed to get casino token stats:', error);
    return null;
  }
};

/**
 * Get casino building level for a land
 * Casino is building ID 6 (TownBuildingNaming.CASINO)
 */
export const getCasinoLevel = async (landId: bigint): Promise<number> => {
  const readClient = getReadClient();
  try {
    // Try to get town buildings to find casino level
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: [
          {
            name: 'townGetBuildingsByLandId',
            type: 'function',
            inputs: [{ name: 'landId', type: 'uint256' }],
            outputs: [{
              type: 'tuple[]',
              components: [
                { name: 'id', type: 'uint8' },
                { name: 'level', type: 'uint8' },
                { name: 'maxLevel', type: 'uint8' },
                { name: 'blockHeightUpgradeInitiated', type: 'uint256' },
                { name: 'blockHeightUntilUpgradeDone', type: 'uint256' },
                { name: 'isUpgrading', type: 'bool' },
                { name: 'levelUpgradeCostLeaf', type: 'uint256' },
                { name: 'levelUpgradeCostSeedInstant', type: 'uint256' },
                { name: 'levelUpgradeBlockInterval', type: 'uint256' },
                { name: 'levelUpgradeCostSeed', type: 'uint256' }
              ]
            }],
            stateMutability: 'view'
          }
        ],
        functionName: 'townGetBuildingsByLandId',
        args: [landId],
      });
    }) as UntypedValue as Array<{ id: number; level: number }>;

    // Casino is building ID 6
    const casino = result.find(b => b.id === 6);
    return casino ? casino.level : 0;
  } catch (error) {
    console.warn('Failed to get casino level:', error);
    return 0;
  }
};

/**
 * Build casino on a land (transaction)
 */
export const casinoBuild = async (walletClient: WalletClient, landId: bigint): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: casinoAbi,
    functionName: 'casinoBuild',
    args: [landId],
    account: walletClient.account,
    chain: base,
  });

  return hash;
};

/**
 * Place multiple bets on the casino roulette table (transaction)
 */
export const casinoPlaceBets = async (
  walletClient: WalletClient,
  landId: bigint,
  betTypes: CasinoBetType[],
  betNumbersArray: number[][],
  betAmounts: bigint[]
): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: casinoAbi,
    functionName: 'casinoPlaceBets',
    args: [landId, betTypes, betNumbersArray, betAmounts],
    account: walletClient.account,
    chain: base,
  });

  return hash;
};

export const casinoPlaceBetsWithToken = async (
  walletClient: WalletClient,
  landId: bigint,
  token: string,
  betTypes: CasinoBetType[],
  betNumbersArray: number[][],
  betAmounts: bigint[]
): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: casinoAbi,
    functionName: 'casinoPlaceBetsWithToken',
    args: [landId, token as `0x${string}`, betTypes, betNumbersArray, betAmounts],
    account: walletClient.account,
    chain: base,
  });

  return hash;
};

/**
 * Reveal the casino spin result (transaction)
 * Returns the transaction hash, result must be parsed from receipt logs
 */
export const casinoReveal = async (walletClient: WalletClient, landId: bigint): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');

  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: casinoAbi,
    functionName: 'casinoReveal',
    args: [landId],
    account: walletClient.account,
    chain: base,
  });

  return hash;
};

/**
 * Build call data for casinoBuild (for batched transactions)
 */
export const buildCasinoBuildCall = (landId: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: casinoAbi,
  functionName: 'casinoBuild' as const,
  args: [landId],
});

/**
 * Build call data for casinoPlaceBets (for batched transactions)
 */
export const buildCasinoPlaceBetsCall = (
  landId: bigint,
  betTypes: CasinoBetType[],
  betNumbersArray: number[][],
  betAmounts: bigint[]
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: casinoAbi,
  functionName: 'casinoPlaceBets' as const,
  args: [landId, betTypes, betNumbersArray, betAmounts],
});

export const buildCasinoPlaceBetsWithTokenCall = (
  landId: bigint,
  token: string,
  betTypes: CasinoBetType[],
  betNumbersArray: number[][],
  betAmounts: bigint[]
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: casinoAbi,
  functionName: 'casinoPlaceBetsWithToken' as const,
  args: [landId, token as `0x${string}`, betTypes, betNumbersArray, betAmounts],
});

/**
 * Build call data for casinoReveal (for batched transactions)
 */
export const buildCasinoRevealCall = (landId: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: casinoAbi,
  functionName: 'casinoReveal' as const,
  args: [landId],
});

// Re-export casino types and helpers
export { CasinoBetType };

// ============================================================================
// BACCARAT FUNCTIONS
// ============================================================================

import { baccaratAbi,BaccaratBetType,BaccaratOutcome } from '@/public/abi/baccarat-abi';
export { BaccaratBetType,BaccaratOutcome };

export type BaccaratConfig = {
  enabled: boolean;
  bankerCommissionBps: number;
  tiePayoutMultiplier: number;
};

export type BaccaratTokenConfig = {
  supported: boolean;
  minBet: bigint;
  maxBet: bigint;
  rewardPool: string;
  enabled: boolean;
};

export type BaccaratActiveGame = {
  isActive: boolean;
  player: string;
  betType: BaccaratBetType;
  betAmount: bigint;
  revealBlock: bigint;
  canReveal: boolean;
  isExpired: boolean;
  bettingToken: string;
};

export type BaccaratStats = {
  totalWagered: bigint;
  totalWon: bigint;
  gamesPlayed: bigint;
};

export const baccaratGetConfig = async (): Promise<BaccaratConfig | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: baccaratAbi,
        functionName: 'baccaratGetConfig',
      });
    }) as [boolean, number, number];
    return {
      enabled: result[0],
      bankerCommissionBps: Number(result[1]),
      tiePayoutMultiplier: Number(result[2]),
    };
  } catch (error) {
    console.warn('Failed to get baccarat config:', error);
    return null;
  }
};

export const baccaratGetTokenConfig = async (token: string): Promise<BaccaratTokenConfig | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: baccaratAbi,
        functionName: 'baccaratGetTokenConfig',
        args: [token as `0x${string}`],
      });
    }) as [boolean, bigint, bigint, string, boolean];
    return {
      supported: result[0],
      minBet: result[1],
      maxBet: result[2],
      rewardPool: result[3],
      enabled: result[4],
    };
  } catch (error) {
    console.warn('Failed to get baccarat token config:', error);
    return null;
  }
};

export const baccaratGetActiveGame = async (landId: bigint): Promise<BaccaratActiveGame | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: baccaratAbi,
        functionName: 'baccaratGetActiveGame',
        args: [landId],
      });
    }) as [boolean, string, number, bigint, bigint, boolean, boolean, string];
    return {
      isActive: result[0],
      player: result[1],
      betType: result[2] as BaccaratBetType,
      betAmount: result[3],
      revealBlock: result[4],
      canReveal: result[5],
      isExpired: result[6],
      bettingToken: result[7],
    };
  } catch (error) {
    console.warn('Failed to get baccarat active game:', error);
    return null;
  }
};

export const baccaratGetStats = async (landId: bigint): Promise<BaccaratStats | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: baccaratAbi,
        functionName: 'baccaratGetStats',
        args: [landId],
      });
    }) as [bigint, bigint, bigint];
    return {
      totalWagered: result[0],
      totalWon: result[1],
      gamesPlayed: result[2],
    };
  } catch (error) {
    console.warn('Failed to get baccarat stats:', error);
    return null;
  }
};

export const baccaratGetStatsByToken = async (landId: bigint, token: string): Promise<BaccaratStats | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: baccaratAbi,
        functionName: 'baccaratGetStatsByToken',
        args: [landId, token as `0x${string}`],
      });
    }) as [bigint, bigint, bigint];
    return {
      totalWagered: result[0],
      totalWon: result[1],
      gamesPlayed: result[2],
    };
  } catch (error) {
    console.warn('Failed to get baccarat token stats:', error);
    return null;
  }
};

export const buildBaccaratPlaceBetCall = (
  landId: bigint,
  betType: BaccaratBetType,
  amount: bigint
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: baccaratAbi,
  functionName: 'baccaratPlaceBet' as const,
  args: [landId, betType, amount],
});

export const buildBaccaratPlaceBetWithTokenCall = (
  landId: bigint,
  token: string,
  betType: BaccaratBetType,
  amount: bigint
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: baccaratAbi,
  functionName: 'baccaratPlaceBetWithToken' as const,
  args: [landId, token as `0x${string}`, betType, amount],
});

export const buildBaccaratRevealCall = (landId: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: baccaratAbi,
  functionName: 'baccaratReveal' as const,
  args: [landId],
});

// Standard ERC20 ABI for token approval checks
const erc20ApprovalAbi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

/**
 * Check token allowance for casino operations
 * @param address User wallet address
 * @param tokenAddress The token to check allowance for
 */
export const checkCasinoApproval = async (
  address: string,
  tokenAddress: string
): Promise<bigint> => {
  const readClient = getReadClient();
  return retryWithBackoff(async () => {
    const allowance = await readClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: erc20ApprovalAbi,
      functionName: 'allowance',
      args: [address as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;
    return allowance;
  });
};

/**
 * Approve token spending for casino operations (betting/building)
 * @param walletClient Connected wallet client
 * @param tokenAddress The token to approve
 */
export const approveCasinoTokenSpending = async (
  walletClient: WalletClient,
  tokenAddress: string
): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');

  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

  const hash = await walletClient.writeContract({
    address: tokenAddress as `0x${string}`,
    abi: erc20ApprovalAbi,
    functionName: 'approve',
    args: [LAND_CONTRACT_ADDRESS, maxApproval],
    account: walletClient.account,
    chain: base,
  });

  return waitForBaseTransactionSuccess(hash);
};

// ============================================================================
// BLACKJACK FUNCTIONS
// ============================================================================

import { blackjackAbi,BlackjackAction,BlackjackPhase,BlackjackResult } from '@/public/abi/blackjack-abi';
export { BlackjackAction,BlackjackPhase,BlackjackResult };

// Types
export interface BlackjackGameBasic {
  isActive: boolean;
  player: string;
  phase: BlackjackPhase;
  betAmount: bigint;
  activeHandCount: number;
  hasSplit: boolean;
  dealerUpCard: number;
  hasPendingAction: boolean;
  actionCommitBlock: bigint;
  currentHandIndex: number;
}

export interface BlackjackGameHands {
  hand1Cards: number[];
  hand1Value: number;
  hand2Cards: number[];
  hand2Value: number;
  canReveal: boolean;
  isExpired: boolean;
}

export interface BlackjackActions {
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
  canSplit: boolean;
  canSurrender: boolean;
  canInsurance: boolean;
}

export interface BlackjackGameSnapshot {
  isActive: boolean;
  player: string;
  phase: BlackjackPhase;
  betAmount: bigint;
  activeHandCount: number;
  hasSplit: boolean;
  actionHandIndex: number;
  hand1Cards: number[];
  hand1Value: number;
  hand2Cards: number[];
  hand2Value: number;
  dealerCards: number[];
  dealerValue: number;
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
  canSplit: boolean;
  canSurrender: boolean;
}

export interface BlackjackConfig {
  minBet: bigint;
  maxBet: bigint;
  bettingToken: string;
  rewardPool: string;
  enabled: boolean;
  requiredLevel: number;
}

export interface BlackjackTokenConfig {
  supported: boolean;
  minBet: bigint;
  maxBet: bigint;
  rewardPool: string;
  enabled: boolean;
  requiredLevel: number;
}

export interface BlackjackStats {
  totalWagered: bigint;
  totalWon: bigint;
  gamesPlayed: bigint;
  blackjacksHit: bigint;
}

/**
 * Get basic game state for Blackjack
 */
export const blackjackGetGameBasic = async (landId: bigint): Promise<BlackjackGameBasic | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetGameBasic',
        args: [landId],
      });
    }) as [boolean, string, number, bigint, number, boolean, number, boolean, bigint, number];

    return {
      isActive: result[0],
      player: result[1],
      phase: result[2] as BlackjackPhase,
      betAmount: result[3],
      activeHandCount: result[4],
      hasSplit: result[5],
      dealerUpCard: result[6],
      hasPendingAction: result[7],
      actionCommitBlock: result[8],
      currentHandIndex: result[9],
    };
  } catch (error) {
    console.warn('Failed to get blackjack game basic:', error);
    return null;
  }
};

/**
 * Get complete Blackjack game snapshot in one read call
 */
export const blackjackGetGameSnapshot = async (landId: bigint): Promise<BlackjackGameSnapshot | null> => {
  const readClient = getReadClient();
  try {
    const raw = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetGameSnapshot',
        args: [landId],
      });
    }, 1, 250) as UntypedValue;

    // Support both tuple-object and flat array decoding shapes.
    const snapshot = Array.isArray(raw)
      ? raw
      : (raw?.snapshot ?? raw);

    if (!snapshot) return null;

    if (Array.isArray(snapshot)) {
      return {
        isActive: !!snapshot[0],
        player: String(snapshot[1]),
        phase: Number(snapshot[2]) as BlackjackPhase,
        betAmount: BigInt(snapshot[3]),
        activeHandCount: Number(snapshot[4]),
        hasSplit: !!snapshot[5],
        actionHandIndex: Number(snapshot[6]),
        hand1Cards: Array.isArray(snapshot[7]) ? snapshot[7].map(Number) : [],
        hand1Value: Number(snapshot[8]),
        hand2Cards: Array.isArray(snapshot[9]) ? snapshot[9].map(Number) : [],
        hand2Value: Number(snapshot[10]),
        dealerCards: Array.isArray(snapshot[11]) ? snapshot[11].map(Number) : [],
        dealerValue: Number(snapshot[12]),
        canHit: !!snapshot[13],
        canStand: !!snapshot[14],
        canDouble: !!snapshot[15],
        canSplit: !!snapshot[16],
        canSurrender: !!snapshot[17],
      };
    }

    return {
      isActive: !!snapshot.isActive,
      player: String(snapshot.player),
      phase: Number(snapshot.phase) as BlackjackPhase,
      betAmount: BigInt(snapshot.betAmount),
      activeHandCount: Number(snapshot.activeHandCount),
      hasSplit: !!snapshot.hasSplit,
      actionHandIndex: Number(snapshot.actionHandIndex),
      hand1Cards: Array.isArray(snapshot.hand1Cards) ? snapshot.hand1Cards.map(Number) : [],
      hand1Value: Number(snapshot.hand1Value),
      hand2Cards: Array.isArray(snapshot.hand2Cards) ? snapshot.hand2Cards.map(Number) : [],
      hand2Value: Number(snapshot.hand2Value),
      dealerCards: Array.isArray(snapshot.dealerCards) ? snapshot.dealerCards.map(Number) : [],
      dealerValue: Number(snapshot.dealerValue),
      canHit: !!snapshot.canHit,
      canStand: !!snapshot.canStand,
      canDouble: !!snapshot.canDouble,
      canSplit: !!snapshot.canSplit,
      canSurrender: !!snapshot.canSurrender,
    };
  } catch (error) {
    console.warn('Failed to get blackjack game snapshot:', error);
    return null;
  }
};

/**
 * Get hand cards and values for Blackjack
 */
export const blackjackGetGameHands = async (landId: bigint): Promise<BlackjackGameHands | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetGameHands',
        args: [landId],
      });
    }) as [number[], number, number[], number, boolean, boolean];

    return {
      hand1Cards: result[0].map(Number),
      hand1Value: result[1],
      hand2Cards: result[2].map(Number),
      hand2Value: result[3],
      canReveal: result[4],
      isExpired: result[5],
    };
  } catch (error) {
    console.warn('Failed to get blackjack game hands:', error);
    return null;
  }
};

/**
 * Get available actions for current hand
 */
export const blackjackGetActions = async (landId: bigint, handIndex: number): Promise<BlackjackActions | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetActions',
        args: [landId, handIndex],
      });
    }) as [boolean, boolean, boolean, boolean, boolean, boolean];

    return {
      canHit: result[0],
      canStand: result[1],
      canDouble: result[2],
      canSplit: result[3],
      canSurrender: result[4],
      canInsurance: result[5],
    };
  } catch (error) {
    console.warn('Failed to get blackjack actions:', error);
    return null;
  }
};

/**
 * Get dealer's hand (only full hand after game ends)
 */
export const blackjackGetDealerHand = async (landId: bigint): Promise<{ dealerCards: number[]; dealerValue: number } | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetDealerHand',
        args: [landId],
      });
    }) as [number[], number];

    return {
      dealerCards: result[0].map(Number),
      dealerValue: result[1],
    };
  } catch (error) {
    console.warn('Failed to get blackjack dealer hand:', error);
    return null;
  }
};

export const blackjackGetGameToken = async (landId: bigint): Promise<string | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetGameToken',
        args: [landId],
      });
    }) as string;
    return result;
  } catch (error) {
    console.warn('Failed to get blackjack game token:', error);
    return null;
  }
};

/**
 * Get Blackjack config
 */
export const blackjackGetConfig = async (): Promise<BlackjackConfig | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetConfig',
        args: [],
      });
    }) as [bigint, bigint, string, string, boolean, number];

    return {
      minBet: result[0],
      maxBet: result[1],
      bettingToken: result[2],
      rewardPool: result[3],
      enabled: result[4],
      requiredLevel: result[5],
    };
  } catch (error) {
    console.warn('Failed to get blackjack config:', error);
    return null;
  }
};

export const blackjackGetTokenConfig = async (token: string): Promise<BlackjackTokenConfig | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetTokenConfig',
        args: [token as `0x${string}`],
      });
    }) as [boolean, bigint, bigint, string, boolean, number];

    return {
      supported: result[0],
      minBet: result[1],
      maxBet: result[2],
      rewardPool: result[3],
      enabled: result[4],
      requiredLevel: result[5],
    };
  } catch (error) {
    console.warn('Failed to get blackjack token config:', error);
    return null;
  }
};

/**
 * Get Blackjack stats for a land
 */
export const blackjackGetStats = async (landId: bigint): Promise<BlackjackStats | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetStats',
        args: [landId],
      });
    }) as [bigint, bigint, bigint, bigint];

    return {
      totalWagered: result[0],
      totalWon: result[1],
      gamesPlayed: result[2],
      blackjacksHit: result[3],
    };
  } catch (error) {
    console.warn('Failed to get blackjack stats:', error);
    return null;
  }
};

export const blackjackGetStatsByToken = async (landId: bigint, token: string): Promise<BlackjackStats | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackGetStatsByToken',
        args: [landId, token as `0x${string}`],
      });
    }) as [bigint, bigint, bigint, bigint];

    return {
      totalWagered: result[0],
      totalWon: result[1],
      gamesPlayed: result[2],
      blackjacksHit: result[3],
    };
  } catch (error) {
    console.warn('Failed to get blackjack token stats:', error);
    return null;
  }
};

/**
 * Check if Blackjack is available on a land
 */
export const blackjackIsAvailable = async (landId: bigint): Promise<{ available: boolean; currentLevel: number; requiredLevel: number } | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: blackjackAbi,
        functionName: 'blackjackIsAvailable',
        args: [landId],
      });
    }) as [boolean, number, number];

    return {
      available: result[0],
      currentLevel: result[1],
      requiredLevel: result[2],
    };
  } catch (error) {
    console.warn('Failed to check blackjack availability:', error);
    return null;
  }
};

// ============================================================================
// BLACKJACK BUILD CALLS (for SponsoredTransaction)
// ============================================================================

/**
 * Build call data for blackjackBet
 */
export const buildBlackjackBetCall = (landId: bigint, amount: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: blackjackAbi,
  functionName: 'blackjackBet' as const,
  args: [landId, amount],
});

/**
 * Build call data for blackjackDeal
 */
export const buildBlackjackDealCall = (landId: bigint, insuranceAmount: bigint = BigInt(0)) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: blackjackAbi,
  functionName: 'blackjackDeal' as const,
  args: [landId, insuranceAmount],
});

/**
 * Build call data for blackjackRequestAction
 */
export const buildBlackjackRequestActionCall = (landId: bigint, handIndex: number, action: BlackjackAction) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: blackjackAbi,
  functionName: 'blackjackRequestAction' as const,
  args: [landId, handIndex, action],
});

/**
 * Build call data for blackjackRevealAction
 */
export const buildBlackjackRevealActionCall = (landId: bigint) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: blackjackAbi,
  functionName: 'blackjackRevealAction' as const,
  args: [landId],
});

// ============ Server-Signed Randomness Functions ============

/**
 * Fetch randomness from server for a Blackjack action
 */
export const blackjackFetchRandomness = async (
  landId: bigint,
  action: string,
  playerAddress?: string,
  handIndex?: number,
  bettingToken?: string,
  betAmountWei?: string
): Promise<{
  randomSeed: string;
  nonce: number;
  signature: string;
  expiresAt: number;
  signerAddress: string;
  bettingToken?: string;
  lockedBetAmountWei?: string | null;
}> => {
  const response = await fetch('/api/blackjack/random', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      landId: landId.toString(),
      action,
      playerAddress,
      handIndex,
      bettingToken,
      betAmountWei,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to fetch randomness: ${response.status}`);
  }

  return response.json();
};

/**
 * Get current nonce for a land (for display/debugging)
 */
export const blackjackGetNonce = async (landId: bigint): Promise<bigint | null> => {
  try {
    const result = await getReadClient().readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: blackjackAbi,
      functionName: 'blackjackGetNonce',
      args: [landId],
    }) as bigint;
    return result;
  } catch (error) {
    console.warn('Failed to get blackjack nonce:', error);
    return null;
  }
};

/**
 * Get randomness signer address from contract
 */
export const blackjackGetRandomnessSigner = async (): Promise<string | null> => {
  try {
    const result = await getReadClient().readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: blackjackAbi,
      functionName: 'blackjackGetRandomnessSigner',
      args: [],
    }) as string;
    return result;
  } catch (error) {
    console.warn('Failed to get randomness signer:', error);
    return null;
  }
};

/**
 * Build call data for blackjackDealWithRandom (combined bet + deal with server randomness)
 */
export const buildBlackjackDealWithRandomCall = (
  landId: bigint,
  amount: bigint,
  randomSeed: string,
  nonce: number,
  signature: string
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: blackjackAbi,
  functionName: 'blackjackDealWithRandom' as const,
  args: [landId, amount, randomSeed as `0x${string}`, BigInt(nonce), signature as `0x${string}`],
});

export const buildBlackjackDealWithRandomForTokenCall = (
  landId: bigint,
  amount: bigint,
  token: string,
  randomSeed: string,
  nonce: number,
  signature: string
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: blackjackAbi,
  functionName: 'blackjackDealWithRandomForToken' as const,
  args: [
    landId,
    amount,
    token as `0x${string}`,
    randomSeed as `0x${string}`,
    BigInt(nonce),
    signature as `0x${string}`,
  ],
});

/**
 * Build call data for blackjackActionWithRandom (action with server randomness)
 */
export const buildBlackjackActionWithRandomCall = (
  landId: bigint,
  handIndex: number,
  action: BlackjackAction,
  randomSeed: string,
  nonce: number,
  signature: string
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: blackjackAbi,
  functionName: 'blackjackActionWithRandom' as const,
  args: [landId, handIndex, action, randomSeed as `0x${string}`, BigInt(nonce), signature as `0x${string}`],
});

// ============================================================================
// FARMER HOUSE QUESTS — BATCH READS, CALL BUILDERS, REWARD SOURCE RESOLUTION
// ============================================================================

/**
 * Quest difficulty levels, matching the onchain `QuestDifficultyLevel` enum.
 * Durations mirror `LibQuestStorage.initializeQuestStorage()` at Base 2s blocks.
 */
export const QUEST_DIFFICULTIES = [
  { id: 0, label: 'Easy', durationHours: 3 },
  { id: 1, label: 'Med', durationHours: 6 },
  { id: 2, label: 'Hard', durationHours: 12 },
] as const;

export type QuestDifficultyId = (typeof QUEST_DIFFICULTIES)[number]['id'];

export const isQuestDifficultyId = (value: unknown): value is QuestDifficultyId =>
  value === 0 || value === 1 || value === 2;

/**
 * Lifecycle state of a single farmer slot.
 *
 * Ordering mirrors the require() chain in LibQuest, so the UI can never offer an
 * action the contract would reject. Every one of these preconditions is
 * monotonic in block.number - once a slot is startable it stays startable -
 * which is what makes it safe to bundle a whole scan atomically without the
 * batch reverting on timing drift between simulation and inclusion.
 */
export type QuestSlotState =
  | 'available'
  | 'in_progress'
  | 'ready_to_commit'
  | 'committed'
  | 'cooldown';

export type QuestSlotSnapshot = QuestSlot & {
  landId: bigint;
  slotIndex: number;
  state: QuestSlotState;
};

export const getQuestSlotState = (slot: QuestSlot, currentBlock: bigint): QuestSlotState => {
  if (slot.coolDownBlock !== BigInt(0) && currentBlock < slot.coolDownBlock) return 'cooldown';
  if (slot.startBlock === BigInt(0)) return 'available';
  if (slot.pseudoRndBlock !== BigInt(0)) return 'committed';
  if (currentBlock <= slot.endBlock) return 'in_progress';
  return 'ready_to_commit';
};

const normalizeQuestSlot = (raw: UntypedValue): QuestSlot => ({
  difficulty: Number(raw?.difficulty ?? raw?.[0] ?? 0),
  startBlock: BigInt(raw?.startBlock ?? raw?.[1] ?? 0),
  endBlock: BigInt(raw?.endBlock ?? raw?.[2] ?? 0),
  pseudoRndBlock: BigInt(raw?.pseudoRndBlock ?? raw?.[3] ?? 0),
  coolDownBlock: BigInt(raw?.coolDownBlock ?? raw?.[4] ?? 0),
});

/**
 * Read every farmer slot across many lands in one multicall sweep.
 *
 * questGetByLandId already returns exactly the unlocked slots (the array is
 * sized to the Farmer House level, and empty when there is no Farmer House), so
 * no separate building-level read is needed.
 */
export const getQuestSlotsBatch = async (
  landIds: bigint[],
  options: { chunkSize?: number; readClient?: PixotchiReadClient } = {},
): Promise<QuestSlotsBatchEntry[]> => {
  if (landIds.length === 0) return [];

  const { chunkSize = 40, readClient = getReadClient() } = options;
  const results: QuestSlotsBatchEntry[] = [];

  for (let i = 0; i < landIds.length; i += chunkSize) {
    const chunk = landIds.slice(i, i + chunkSize);
    const chunkResults = await retryWithBackoff(async () =>
      readClient.multicall({
        allowFailure: true,
        contracts: chunk.map((landId) => ({
          address: LAND_CONTRACT_ADDRESS,
          abi: landAbi,
          functionName: 'questGetByLandId' as const,
          args: [landId],
        })),
      }),
    );

    chunk.forEach((landId, index) => {
      const entry = chunkResults[index];
      // A land with no Farmer House legitimately returns an empty array, so a
      // failed read is indistinguishable from "no slots" unless it is reported
      // separately. Without `ok`, one flaky multicall entry silently drops that
      // land's idle farmers out of the batch and nobody can tell.
      const ok = entry?.status === 'success' && Array.isArray(entry.result);
      results.push({
        landId,
        ok,
        slots: ok ? (entry.result as UntypedValue[]).map(normalizeQuestSlot) : [],
      });
    });
  }

  return results;
};

export type QuestSlotsBatchEntry = {
  landId: bigint;
  /** False when this land's read failed, so its slots are unknown, not absent. */
  ok: boolean;
  slots: QuestSlot[];
};

/** Flatten a batch read into per-slot snapshots tagged with their lifecycle state. */
export const toQuestSlotSnapshots = (
  batch: ReadonlyArray<{ landId: bigint; ok?: boolean; slots: QuestSlot[] }>,
  currentBlock: bigint,
): QuestSlotSnapshot[] =>
  batch.flatMap(({ landId, slots }) =>
    slots.map((slot, slotIndex) => ({
      ...slot,
      landId,
      slotIndex,
      state: getQuestSlotState(slot, currentBlock),
    })),
  );

export const buildQuestStartCall = (
  landId: bigint,
  difficulty: QuestDifficultyId,
  slotIndex: number,
) => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: landAbi,
  functionName: 'questStart' as const,
  args: [landId, difficulty, BigInt(slotIndex)],
});

// -------------------- QUEST REWARD SOURCE (onchain authority) --------------------

/**
 * LibConstants.MAINNET_SEED_SEND_ADDRESS / MAINNET_LEAF_SEND_ADDRESS.
 *
 * The contract only falls back to this when its storage override is unset. On
 * Base mainnet the override IS set, so this is a last resort, not the expected
 * answer - do not treat it as "the quest rewards wallet".
 */
export const QUEST_REWARD_FALLBACK_ADDRESS = getAddress('0xd528071FB9dC9715ea8da44e2c4433EAc017d1DB');

/**
 * LibPaymentStorage.DIAMOND_STORAGE_POSITION.
 *
 *   struct Data {
 *     uint256 initializationNumber;  // slot + 0
 *     address seedReceiveAddress;    // slot + 1
 *     address speedUpToken;          // slot + 2
 *     address speedUpTokenReceiver;  // slot + 3
 *     address seedRewardAddress;     // slot + 4
 *     address leafRewardAddress;     // slot + 5
 *   }
 *
 * Two addresses are 40 bytes and cannot share a 32-byte slot, so each field gets
 * its own slot. Diamond storage structs are append-only by convention, which is
 * what keeps these offsets stable across facet upgrades.
 */
const PAYMENT_STORAGE_BASE_SLOT = keccak256(toBytes('eth.pixotchi.land.payment.storage'));
const SEED_REWARD_ADDRESS_SLOT_OFFSET = BigInt(4);
const LEAF_REWARD_ADDRESS_SLOT_OFFSET = BigInt(5);

export type QuestRewardSources = {
  seed: `0x${string}`;
  leaf: `0x${string}`;
  /** False when the storage read failed and a configured fallback was used. */
  resolvedOnchain: boolean;
};

export const getPaymentStorageSlot = (offset: bigint): `0x${string}` =>
  toHex(BigInt(PAYMENT_STORAGE_BASE_SLOT) + offset, { size: 32 });

export const storageWordToAddress = (word: string | null | undefined): `0x${string}` | null => {
  if (!word || word.length < 42) return null;
  const candidate = `0x${word.slice(-40)}`;
  if (/^0x0{40}$/i.test(candidate)) return null;
  try {
    return getAddress(candidate);
  } catch {
    return null;
  }
};

const parseConfiguredAddress = (value: string | undefined): `0x${string}` | null => {
  if (!value) return null;
  try {
    const normalized = getAddress(value.trim());
    return /^0x0{40}$/i.test(normalized) ? null : normalized;
  } catch {
    return null;
  }
};

/**
 * Resolve the wallets that actually fund Farmer House quest rewards.
 *
 * QuestRewardsAdminFacet.setQuestRewardsWallet can rotate these, and the
 * rotation only lands in diamond storage - there is a setter but no getter. The
 * NEXT_PUBLIC_QUEST_*_REWARDS_WALLET env vars are an unreliable mirror: when
 * unset they resolve to the pre-rotation constant, which reads as an empty
 * wallet and makes the Farmer House look broken. Storage is the only authority;
 * env is kept purely as break-glass for a storage read failure.
 */
export const getQuestRewardSources = async (
  readClient: PixotchiReadClient = getReadClient(),
): Promise<QuestRewardSources> => {
  try {
    const [seedWord, leafWord] = await Promise.all([
      readClient.getStorageAt({
        address: LAND_CONTRACT_ADDRESS,
        slot: getPaymentStorageSlot(SEED_REWARD_ADDRESS_SLOT_OFFSET),
      }),
      readClient.getStorageAt({
        address: LAND_CONTRACT_ADDRESS,
        slot: getPaymentStorageSlot(LEAF_REWARD_ADDRESS_SLOT_OFFSET),
      }),
    ]);

    // A zero word is the contract own "use the constant" signal, so mirror it
    // rather than reaching for the env override.
    return {
      seed: storageWordToAddress(seedWord) ?? QUEST_REWARD_FALLBACK_ADDRESS,
      leaf: storageWordToAddress(leafWord) ?? QUEST_REWARD_FALLBACK_ADDRESS,
      resolvedOnchain: true,
    };
  } catch (error) {
    console.warn('getQuestRewardSources: storage read failed, using configured fallback', error);
    return {
      seed: parseConfiguredAddress(CLIENT_ENV.QUEST_SEED_REWARDS_WALLET) ?? QUEST_REWARD_FALLBACK_ADDRESS,
      leaf: parseConfiguredAddress(CLIENT_ENV.QUEST_LEAF_REWARDS_WALLET) ?? QUEST_REWARD_FALLBACK_ADDRESS,
      resolvedOnchain: false,
    };
  }
};
