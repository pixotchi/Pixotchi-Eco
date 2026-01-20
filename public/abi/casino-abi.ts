// Casino (Roulette) ABI for RouletteFacet - Multi-Bet Version
export const casinoAbi = [
    // ============ Events ============
    {
        "type": "event",
        "name": "CasinoConfigUpdated",
        "inputs": [
            { "name": "minBet", "type": "uint256", "indexed": false },
            { "name": "maxBet", "type": "uint256", "indexed": false },
            { "name": "bettingToken", "type": "address", "indexed": false },
            { "name": "rewardPool", "type": "address", "indexed": false },
            { "name": "enabled", "type": "bool", "indexed": false },
            { "name": "maxBetsPerGame", "type": "uint256", "indexed": false }
        ]
    },
    {
        "type": "event",
        "name": "CasinoBuildingConfigUpdated",
        "inputs": [
            { "name": "buildingToken", "type": "address", "indexed": false },
            { "name": "buildingCost", "type": "uint256", "indexed": false }
        ]
    },
    {
        "type": "event",
        "name": "CasinoBuilt",
        "inputs": [
            { "name": "landId", "type": "uint256", "indexed": true },
            { "name": "builder", "type": "address", "indexed": true },
            { "name": "token", "type": "address", "indexed": false },
            { "name": "cost", "type": "uint256", "indexed": false }
        ]
    },
    {
        "type": "event",
        "name": "RouletteBetPlaced",
        "inputs": [
            { "name": "landId", "type": "uint256", "indexed": true },
            { "name": "player", "type": "address", "indexed": true },
            { "name": "betType", "type": "uint8", "indexed": false },
            { "name": "amount", "type": "uint256", "indexed": false },
            { "name": "betIndex", "type": "uint256", "indexed": false },
            { "name": "revealBlock", "type": "uint256", "indexed": false }
        ]
    },
    {
        "type": "event",
        "name": "RouletteSpinResult",
        "inputs": [
            { "name": "landId", "type": "uint256", "indexed": true },
            { "name": "player", "type": "address", "indexed": true },
            { "name": "winningNumber", "type": "uint8", "indexed": false },
            { "name": "won", "type": "bool", "indexed": false },
            { "name": "payout", "type": "uint256", "indexed": false }
        ]
    },
    {
        "type": "event",
        "name": "RouletteBetExpired",
        "inputs": [
            { "name": "landId", "type": "uint256", "indexed": true },
            { "name": "player", "type": "address", "indexed": true },
            { "name": "forfeitedAmount", "type": "uint256", "indexed": false }
        ]
    },
    // ============ Building Functions ============
    {
        "type": "function",
        "name": "casinoBuild",
        "inputs": [{ "name": "landId", "type": "uint256" }],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoIsBuilt",
        "inputs": [{ "name": "landId", "type": "uint256" }],
        "outputs": [{ "name": "built", "type": "bool" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "casinoGetBuildingConfig",
        "inputs": [],
        "outputs": [
            { "name": "buildingToken", "type": "address" },
            { "name": "buildingCost", "type": "uint256" }
        ],
        "stateMutability": "view"
    },
    // ============ Game Functions (Multi-Bet) ============
    {
        "type": "function",
        "name": "casinoPlaceBets",
        "inputs": [
            { "name": "landId", "type": "uint256" },
            { "name": "betTypes", "type": "uint8[]" },
            { "name": "betNumbersArray", "type": "uint8[][]" },
            { "name": "betAmounts", "type": "uint256[]" }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoReveal",
        "inputs": [{ "name": "landId", "type": "uint256" }],
        "outputs": [
            { "name": "winningNumber", "type": "uint8" },
            { "name": "payout", "type": "uint256" }
        ],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoGetActiveBet",
        "inputs": [{ "name": "landId", "type": "uint256" }],
        "outputs": [
            { "name": "isActive", "type": "bool" },
            { "name": "numBets", "type": "uint256" },
            { "name": "totalBetAmount", "type": "uint256" },
            { "name": "revealBlock", "type": "uint256" },
            { "name": "player", "type": "address" },
            { "name": "canReveal", "type": "bool" },
            { "name": "isExpired", "type": "bool" }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "casinoGetBetDetails",
        "inputs": [
            { "name": "landId", "type": "uint256" },
            { "name": "betIndex", "type": "uint256" }
        ],
        "outputs": [
            { "name": "betType", "type": "uint8" },
            { "name": "betNumbers", "type": "uint8[]" },
            { "name": "betAmount", "type": "uint256" }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "casinoGetConfig",
        "inputs": [],
        "outputs": [
            { "name": "minBet", "type": "uint256" },
            { "name": "maxBet", "type": "uint256" },
            { "name": "bettingToken", "type": "address" },
            { "name": "rewardPool", "type": "address" },
            { "name": "enabled", "type": "bool" },
            { "name": "maxBetsPerGame", "type": "uint256" }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "casinoGetStats",
        "inputs": [{ "name": "landId", "type": "uint256" }],
        "outputs": [
            { "name": "totalWagered", "type": "uint256" },
            { "name": "totalWon", "type": "uint256" },
            { "name": "gamesPlayed", "type": "uint256" }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "casinoHasBuilding",
        "inputs": [{ "name": "landId", "type": "uint256" }],
        "outputs": [{ "name": "hasBuilding", "type": "bool" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "casinoGetPayoutMultiplier",
        "inputs": [{ "name": "betType", "type": "uint8" }],
        "outputs": [{ "name": "multiplier", "type": "uint256" }],
        "stateMutability": "pure"
    },
    {
        "type": "function",
        "name": "casinoGetMaxBets",
        "inputs": [],
        "outputs": [{ "name": "maxBets", "type": "uint256" }],
        "stateMutability": "view"
    },
    // ============ Admin Functions ============
    {
        "type": "function",
        "name": "casinoSetLimits",
        "inputs": [
            { "name": "minBet", "type": "uint256" },
            { "name": "maxBet", "type": "uint256" }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoSetMaxBets",
        "inputs": [{ "name": "maxBets", "type": "uint256" }],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoSetBettingToken",
        "inputs": [{ "name": "token", "type": "address" }],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoSetRewardPool",
        "inputs": [{ "name": "pool", "type": "address" }],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoSetEnabled",
        "inputs": [{ "name": "enabled", "type": "bool" }],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoSetConfig",
        "inputs": [
            { "name": "minBet", "type": "uint256" },
            { "name": "maxBet", "type": "uint256" },
            { "name": "bettingToken", "type": "address" },
            { "name": "rewardPool", "type": "address" },
            { "name": "enabled", "type": "bool" },
            { "name": "maxBetsPerGame", "type": "uint256" }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoSetBuildingCost",
        "inputs": [
            { "name": "token", "type": "address" },
            { "name": "cost", "type": "uint256" }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "casinoInitializeMultiBet",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
    }
] as const;

// Bet type enum matching the contract
export enum CasinoBetType {
    STRAIGHT = 0,    // Single number (35:1)
    SPLIT = 1,       // Two adjacent numbers (17:1)
    STREET = 2,      // Three numbers in a row (11:1)
    CORNER = 3,      // Four numbers in a square (8:1)
    SIX_LINE = 4,    // Six numbers, two rows (5:1)
    DOZEN = 5,       // 1-12, 13-24, or 25-36 (2:1)
    COLUMN = 6,      // Column of 12 numbers (2:1)
    RED = 7,         // Red numbers (1:1)
    BLACK = 8,       // Black numbers (1:1)
    ODD = 9,         // Odd numbers (1:1)
    EVEN = 10,       // Even numbers (1:1)
    LOW = 11,        // Numbers 1-18 (1:1)
    HIGH = 12        // Numbers 19-36 (1:1)
}

export const CASINO_PAYOUT_MULTIPLIERS: Record<CasinoBetType, number> = {
    [CasinoBetType.STRAIGHT]: 35,
    [CasinoBetType.SPLIT]: 17,
    [CasinoBetType.STREET]: 11,
    [CasinoBetType.CORNER]: 8,
    [CasinoBetType.SIX_LINE]: 5,
    [CasinoBetType.DOZEN]: 2,
    [CasinoBetType.COLUMN]: 2,
    [CasinoBetType.RED]: 1,
    [CasinoBetType.BLACK]: 1,
    [CasinoBetType.ODD]: 1,
    [CasinoBetType.EVEN]: 1,
    [CasinoBetType.LOW]: 1,
    [CasinoBetType.HIGH]: 1
};

// Red numbers in European roulette
export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

// Helper to get bet type name
export const BET_TYPE_NAMES: Record<CasinoBetType, string> = {
    [CasinoBetType.STRAIGHT]: 'Straight',
    [CasinoBetType.SPLIT]: 'Split',
    [CasinoBetType.STREET]: 'Street',
    [CasinoBetType.CORNER]: 'Corner',
    [CasinoBetType.SIX_LINE]: 'Six Line',
    [CasinoBetType.DOZEN]: 'Dozen',
    [CasinoBetType.COLUMN]: 'Column',
    [CasinoBetType.RED]: 'Red',
    [CasinoBetType.BLACK]: 'Black',
    [CasinoBetType.ODD]: 'Odd',
    [CasinoBetType.EVEN]: 'Even',
    [CasinoBetType.LOW]: '1-18',
    [CasinoBetType.HIGH]: '19-36'
};
