// Baccarat ABI for BaccaratFacet
export const baccaratAbi = [
    {
        type: 'event',
        name: 'BaccaratBetPlaced',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'betType', type: 'uint8', indexed: false },
            { name: 'amount', type: 'uint256', indexed: false },
            { name: 'revealBlock', type: 'uint256', indexed: false },
            { name: 'bettingToken', type: 'address', indexed: false },
        ],
    },
    {
        type: 'event',
        name: 'BaccaratRoundResult',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'betType', type: 'uint8', indexed: false },
            { name: 'outcome', type: 'uint8', indexed: false },
            { name: 'won', type: 'bool', indexed: false },
            { name: 'playerTotal', type: 'uint8', indexed: false },
            { name: 'bankerTotal', type: 'uint8', indexed: false },
            { name: 'payout', type: 'uint256', indexed: false },
            { name: 'bettingToken', type: 'address', indexed: false },
        ],
    },
    {
        type: 'event',
        name: 'BaccaratRoundCards',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'playerCard1', type: 'uint8', indexed: false },
            { name: 'playerCard2', type: 'uint8', indexed: false },
            { name: 'playerCard3', type: 'uint8', indexed: false },
            { name: 'playerCardCount', type: 'uint8', indexed: false },
            { name: 'bankerCard1', type: 'uint8', indexed: false },
            { name: 'bankerCard2', type: 'uint8', indexed: false },
            { name: 'bankerCard3', type: 'uint8', indexed: false },
            { name: 'bankerCardCount', type: 'uint8', indexed: false },
        ],
    },
    {
        type: 'event',
        name: 'BaccaratBetExpired',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'forfeitedAmount', type: 'uint256', indexed: false },
            { name: 'bettingToken', type: 'address', indexed: false },
        ],
    },
    {
        type: 'event',
        name: 'BaccaratConfigUpdated',
        inputs: [
            { name: 'enabled', type: 'bool', indexed: false },
            { name: 'bankerCommissionBps', type: 'uint16', indexed: false },
            { name: 'tiePayoutMultiplier', type: 'uint8', indexed: false },
        ],
    },
    {
        type: 'event',
        name: 'BaccaratTokenConfigUpdated',
        inputs: [
            { name: 'token', type: 'address', indexed: true },
            { name: 'minBet', type: 'uint256', indexed: false },
            { name: 'maxBet', type: 'uint256', indexed: false },
            { name: 'rewardPool', type: 'address', indexed: false },
            { name: 'enabled', type: 'bool', indexed: false },
        ],
    },
    {
        type: 'event',
        name: 'BaccaratTokenRemoved',
        inputs: [{ name: 'token', type: 'address', indexed: true }],
    },
    {
        type: 'function',
        name: 'baccaratPlaceBet',
        inputs: [
            { name: 'landId', type: 'uint256' },
            { name: 'betType', type: 'uint8' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'baccaratPlaceBetWithToken',
        inputs: [
            { name: 'landId', type: 'uint256' },
            { name: 'token', type: 'address' },
            { name: 'betType', type: 'uint8' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'baccaratReveal',
        inputs: [{ name: 'landId', type: 'uint256' }],
        outputs: [
            { name: 'outcome', type: 'uint8' },
            { name: 'payout', type: 'uint256' },
        ],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'baccaratGetConfig',
        inputs: [],
        outputs: [
            { name: 'enabled', type: 'bool' },
            { name: 'bankerCommissionBps', type: 'uint16' },
            { name: 'tiePayoutMultiplier', type: 'uint8' },
        ],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'baccaratGetTokenConfig',
        inputs: [{ name: 'token', type: 'address' }],
        outputs: [
            { name: 'supported', type: 'bool' },
            { name: 'minBet', type: 'uint256' },
            { name: 'maxBet', type: 'uint256' },
            { name: 'rewardPool', type: 'address' },
            { name: 'enabled', type: 'bool' },
        ],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'baccaratGetActiveGame',
        inputs: [{ name: 'landId', type: 'uint256' }],
        outputs: [
            { name: 'isActive', type: 'bool' },
            { name: 'player', type: 'address' },
            { name: 'betType', type: 'uint8' },
            { name: 'betAmount', type: 'uint256' },
            { name: 'revealBlock', type: 'uint256' },
            { name: 'canReveal', type: 'bool' },
            { name: 'isExpired', type: 'bool' },
            { name: 'bettingToken', type: 'address' },
        ],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'baccaratGetStats',
        inputs: [{ name: 'landId', type: 'uint256' }],
        outputs: [
            { name: 'totalWagered', type: 'uint256' },
            { name: 'totalWon', type: 'uint256' },
            { name: 'gamesPlayed', type: 'uint256' },
        ],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'baccaratGetStatsByToken',
        inputs: [
            { name: 'landId', type: 'uint256' },
            { name: 'token', type: 'address' },
        ],
        outputs: [
            { name: 'totalWagered', type: 'uint256' },
            { name: 'totalWon', type: 'uint256' },
            { name: 'gamesPlayed', type: 'uint256' },
        ],
        stateMutability: 'view',
    },
] as const;

export enum BaccaratBetType {
    PLAYER = 0,
    BANKER = 1,
    TIE = 2,
}

export enum BaccaratOutcome {
    PLAYER = 0,
    BANKER = 1,
    TIE = 2,
}

export const BACCARAT_BET_LABELS: Record<BaccaratBetType, string> = {
    [BaccaratBetType.PLAYER]: 'Player',
    [BaccaratBetType.BANKER]: 'Banker',
    [BaccaratBetType.TIE]: 'Tie',
};

export const BACCARAT_OUTCOME_LABELS: Record<BaccaratOutcome, string> = {
    [BaccaratOutcome.PLAYER]: 'Player',
    [BaccaratOutcome.BANKER]: 'Banker',
    [BaccaratOutcome.TIE]: 'Tie',
};

export function getBaccaratBetLabel(betType: BaccaratBetType): string {
    return BACCARAT_BET_LABELS[betType] ?? 'Unknown';
}

export function getBaccaratOutcomeLabel(outcome: BaccaratOutcome): string {
    return BACCARAT_OUTCOME_LABELS[outcome] ?? 'Unknown';
}

export function getBaccaratPayoutLabel(betType: BaccaratBetType): string {
    if (betType === BaccaratBetType.BANKER) return '1.95x return';
    if (betType === BaccaratBetType.TIE) return '9x return';
    return '2x return';
}
