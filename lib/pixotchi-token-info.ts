import { CLIENT_ENV } from './env-config';
import { PIXOTCHI_ADDRESS, SEED_ADDRESS } from './swap/constants';

export const PIXOTCHI_TOKEN_INFO_IDS = ['seed', 'leaf', 'pixotchi'] as const;

export type PixotchiTokenInfoId = typeof PIXOTCHI_TOKEN_INFO_IDS[number];

export type PixotchiTokenInfoBullet = {
  body: string;
  label?: string;
};

export type PixotchiTokenInfoSection = {
  body: string;
  bullets?: readonly PixotchiTokenInfoBullet[];
  iconAlt: string;
  iconSrc: string;
  key: string;
  title: string;
};

export type PixotchiTokenInfo = {
  contractAddress: string;
  iconAlt: string;
  iconSrc: string;
  id: PixotchiTokenInfoId;
  name: string;
  noFinancialAdvice: true;
  note?: string;
  sections: readonly PixotchiTokenInfoSection[];
  summary: string;
  symbol: string;
};

export const INITIAL_SEED_SUPPLY = BigInt(20_000_000) * BigInt(10) ** BigInt(18);
export const PERCENTAGE_BASIS_POINTS = BigInt(10_000);
export const PIXOTCHI_BATCH_CLAIM_BURN_AMOUNT = Number(process.env.NEXT_PUBLIC_BATCH_CLAIM_BURN_AMOUNT || 500);
export const PIXOTCHI_BATCH_CLAIM_MAX_SIZE = Number(process.env.NEXT_PUBLIC_BATCH_CLAIM_MAX_SIZE || 150);

const TOKEN_INFO = {
  seed: {
    contractAddress: SEED_ADDRESS,
    iconAlt: 'SEED token',
    iconSrc: '/PixotchiKit/COIN.svg',
    id: 'seed',
    name: 'Core economy token',
    noFinancialAdvice: true,
    note: 'SEED launched with 20 million tokens. Burning reduces the total supply; no additional SEED can be minted.',
    sections: [
      {
        body: 'SEED spent on plant minting and paid plant actions currently uses a 70% burn rate. The remaining 30% goes to the game\'s rewards wallet.',
        iconAlt: 'Burn',
        iconSrc: '/icons/fire.svg',
        key: 'seed-burn',
        title: '70% In-Game Burn',
      },
      {
        body: 'A 5% tax applies to SEED swaps to sustain the ecosystem and support rewards, development, and liquidity.',
        bullets: [
          { body: 'Helps fund ETH rewards, with each plant\'s share based on its points.', label: '2% to Player Rewards' },
          { body: 'Funds ongoing development and operations.', label: '2% to Project Treasury' },
          { body: 'Added to the SEED/ETH pool for stability.', label: '1% to Liquidity Pool' },
        ],
        iconAlt: 'Tax',
        iconSrc: '/icons/tax.svg',
        key: 'seed-tax',
        title: '5% Buy/Sell Tax',
      },
      {
        body: 'SEED trading taxes help fund ETH rewards for plants. Plant points are used to calculate each plant\'s share of the reward pool.',
        iconAlt: 'Rewards',
        iconSrc: '/icons/ethlogo.svg',
        key: 'seed-rewards',
        title: 'ETH Rewards',
      },
    ],
    summary: 'Used for supported plant mints, paid plant actions, Land minting, and staking to earn LEAF.',
    symbol: 'SEED',
  },
  leaf: {
    contractAddress: CLIENT_ENV.LEAF_CONTRACT_ADDRESS,
    iconAlt: 'LEAF token',
    iconSrc: '/icons/leaf.png',
    id: 'leaf',
    name: 'Land progression resource',
    noFinancialAdvice: true,
    sections: [
      {
        body: 'Stake SEED to earn LEAF over time, then claim it from the staking panel. Spend LEAF on Land buildings and upgrades that unlock production, quests, and other features.',
        bullets: [
          { body: 'Stake SEED to generate LEAF continuously.' },
          { body: 'Seasonal reward programs and airdrops may also distribute LEAF when active.' },
        ],
        iconAlt: 'Staking',
        iconSrc: '/icons/stake-house.png',
        key: 'leaf-staking',
        title: 'Earned Through Staking',
      },
      {
        body: 'LEAF is mainly used for Land development: constructing and upgrading buildings, unlocking higher production tiers, and supporting long-term village efficiency.',
        iconAlt: 'Lands',
        iconSrc: '/icons/village-start.png',
        key: 'leaf-lands',
        title: 'Built For Lands',
      },
      {
        body: 'Trade LEAF for SEED through player-created orders in the Marketplace building. Each order sets its own price and available amount.',
        iconAlt: 'Marketplace',
        iconSrc: '/icons/marketplace.png',
        key: 'leaf-marketplace',
        title: 'In-Game Marketplace',
      },
    ],
    summary: 'An internal progression token earned from staking SEED and used mainly to develop Lands and long-term village systems.',
    symbol: 'LEAF',
  },
  pixotchi: {
    contractAddress: PIXOTCHI_ADDRESS,
    iconAlt: 'PIXOTCHI Creator Coin',
    iconSrc: '/icons/cc.png',
    id: 'pixotchi',
    name: 'Creator Coin layer',
    noFinancialAdvice: true,
    sections: [
      {
        body: 'A Zora Creator Coin adapted for gameplay, adding useful actions beyond open-market trading.',
        iconAlt: 'Zora',
        iconSrc: '/icons/zora.png',
        key: 'pixotchi-creator-coin',
        title: 'Creator Coin, Game-First',
      },
      {
        body: `Pays for speeding up building upgrades after construction starts, Casino plays, and batch claims of up to ${PIXOTCHI_BATCH_CLAIM_MAX_SIZE} buildings for ${PIXOTCHI_BATCH_CLAIM_BURN_AMOUNT} PIXOTCHI. Starting an upgrade costs LEAF separately.`,
        iconAlt: 'Wallet profile',
        iconSrc: '/icons/avatar2-icon.webp',
        key: 'pixotchi-utility',
        title: 'In-Game Utility Layer',
      },
      {
        body: 'PIXOTCHI launched with 1 billion tokens: 50% allocated to market liquidity and 50% allocated to the creator under a five-year vesting schedule.',
        iconAlt: 'PIXOTCHI token',
        iconSrc: '/icons/cc.png',
        key: 'pixotchi-tokenomics',
        title: 'Tokenomics',
      },
    ],
    summary: 'A Zora Creator Coin used for building speed ups, Casino plays, and batch claims.',
    symbol: 'PIXOTCHI',
  },
} as const satisfies Record<PixotchiTokenInfoId, PixotchiTokenInfo>;

export function getPixotchiTokenInfo(token: PixotchiTokenInfoId): PixotchiTokenInfo {
  return TOKEN_INFO[token];
}

export function getAllPixotchiTokenInfo(): PixotchiTokenInfo[] {
  return PIXOTCHI_TOKEN_INFO_IDS.map((token) => TOKEN_INFO[token]);
}
