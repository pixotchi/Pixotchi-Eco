// Blackjack ABI for Diamond contract
export const blackjackAbi = [
    // Game functions
    {
        name: 'blackjackBet',
        type: 'function',
        inputs: [
            { name: 'landId', type: 'uint256' },
            { name: 'amount', type: 'uint256' }
        ],
        outputs: [],
        stateMutability: 'nonpayable'
    },
    {
        name: 'blackjackDeal',
        type: 'function',
        inputs: [
            { name: 'landId', type: 'uint256' },
            { name: 'insuranceAmount', type: 'uint256' }
        ],
        outputs: [],
        stateMutability: 'nonpayable'
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "landId", "type": "uint256" },
            { "internalType": "uint8", "name": "handIndex", "type": "uint8" },
            { "internalType": "uint8", "name": "action", "type": "uint8" }
        ],
        "name": "blackjackRequestAction",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "landId", "type": "uint256" }
        ],
        "name": "blackjackRevealAction",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },

    // View functions
    {
        "inputs": [
            { "internalType": "uint256", "name": "landId", "type": "uint256" }
        ],
        "name": "blackjackGetGameBasic",
        outputs: [
            { internalType: 'bool', name: 'isActive', type: 'bool' },
            { internalType: 'address', name: 'player', type: 'address' },
            { internalType: 'uint8', name: 'phase', type: 'uint8' },
            { internalType: 'uint256', name: 'betAmount', type: 'uint256' },
            { internalType: 'uint8', name: 'activeHandCount', type: 'uint8' },
            { internalType: 'bool', name: 'hasSplit', type: 'bool' },
            { internalType: 'uint8', name: 'dealerUpCard', type: 'uint8' },
            { internalType: 'bool', name: 'hasPendingAction', type: 'bool' },
            { internalType: 'uint256', name: 'actionCommitBlock', type: 'uint256' },
            { internalType: 'uint8', name: 'currentHandIndex', type: 'uint8' }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        name: 'blackjackGetGameHands',
        type: 'function',
        inputs: [{ name: 'landId', type: 'uint256' }],
        outputs: [
            { name: 'hand1Cards', type: 'uint8[]' },
            { name: 'hand1Value', type: 'uint8' },
            { name: 'hand2Cards', type: 'uint8[]' },
            { name: 'hand2Value', type: 'uint8' },
            { name: 'canReveal', type: 'bool' },
            { name: 'isExpired', type: 'bool' }
        ],
        stateMutability: 'view'
    },
    {
        name: 'blackjackGetActions',
        type: 'function',
        inputs: [
            { name: 'landId', type: 'uint256' },
            { name: 'handIndex', type: 'uint8' }
        ],
        outputs: [
            { name: 'canHit', type: 'bool' },
            { name: 'canStand', type: 'bool' },
            { name: 'canDouble', type: 'bool' },
            { name: 'canSplit', type: 'bool' },
            { name: 'canSurrender', type: 'bool' },
            { name: 'canInsurance', type: 'bool' }
        ],
        stateMutability: 'view'
    },
    {
        name: 'blackjackGetDealerHand',
        type: 'function',
        inputs: [{ name: 'landId', type: 'uint256' }],
        outputs: [
            { name: 'dealerCards', type: 'uint8[]' },
            { name: 'dealerValue', type: 'uint8' }
        ],
        stateMutability: 'view'
    },
    {
        name: 'blackjackGetConfig',
        type: 'function',
        inputs: [],
        outputs: [
            { name: 'minBet', type: 'uint256' },
            { name: 'maxBet', type: 'uint256' },
            { name: 'bettingToken', type: 'address' },
            { name: 'rewardPool', type: 'address' },
            { name: 'enabled', type: 'bool' },
            { name: 'requiredLevel', type: 'uint8' }
        ],
        stateMutability: 'view'
    },
    {
        name: 'blackjackGetStats',
        type: 'function',
        inputs: [{ name: 'landId', type: 'uint256' }],
        outputs: [
            { name: 'totalWagered', type: 'uint256' },
            { name: 'totalWon', type: 'uint256' },
            { name: 'gamesPlayed', type: 'uint256' },
            { name: 'blackjacksHit', type: 'uint256' }
        ],
        stateMutability: 'view'
    },
    {
        name: 'blackjackIsAvailable',
        type: 'function',
        inputs: [{ name: 'landId', type: 'uint256' }],
        outputs: [
            { name: 'available', type: 'bool' },
            { name: 'currentLevel', type: 'uint8' },
            { name: 'requiredLevel', type: 'uint8' }
        ],
        stateMutability: 'view'
    },

    // Events
    {
        name: 'BlackjackBetPlaced',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'amount', type: 'uint256', indexed: false }
        ]
    },
    {
        name: 'BlackjackDealt',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'playerCard1', type: 'uint8', indexed: false },
            { name: 'playerCard2', type: 'uint8', indexed: false },
            { name: 'dealerUpCard', type: 'uint8', indexed: false },
            { name: 'playerHandValue', type: 'uint8', indexed: false },
            { name: 'canInsurance', type: 'bool', indexed: false }
        ]
    },
    {
        name: 'BlackjackHit',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'handIndex', type: 'uint8', indexed: false },
            { name: 'newCard', type: 'uint8', indexed: false },
            { name: 'newHandValue', type: 'uint8', indexed: false },
            { name: 'busted', type: 'bool', indexed: false }
        ]
    },
    {
        name: 'BlackjackSplit',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'hand1Card', type: 'uint8', indexed: false },
            { name: 'hand2Card', type: 'uint8', indexed: false }
        ]
    },
    {
        name: 'BlackjackInsurance',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'insuranceAmount', type: 'uint256', indexed: false },
            { name: 'won', type: 'bool', indexed: false }
        ]
    },
    {
        name: 'BlackjackResult',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'result', type: 'uint8', indexed: false },
            { name: 'playerFinalValue', type: 'uint8', indexed: false },
            { name: 'dealerFinalValue', type: 'uint8', indexed: false },
            { name: 'payout', type: 'uint256', indexed: false }
        ]
    },
    {
        name: 'BlackjackExpired',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'forfeitedAmount', type: 'uint256', indexed: false }
        ]
    },
    // Issue #10: New event for action commit tracking
    {
        name: 'BlackjackActionRequested',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'handIndex', type: 'uint8', indexed: false },
            { name: 'action', type: 'uint8', indexed: false },
            { name: 'commitBlock', type: 'uint256', indexed: false }
        ]
    },
    // Complete game result with full card arrays for frontend display
    {
        name: 'BlackjackGameComplete',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'player', type: 'address', indexed: true },
            { name: 'result', type: 'uint8', indexed: false },
            { name: 'playerCards', type: 'uint8[]', indexed: false },
            { name: 'splitCards', type: 'uint8[]', indexed: false },
            { name: 'dealerCards', type: 'uint8[]', indexed: false },
            { name: 'playerFinalValue', type: 'uint8', indexed: false },
            { name: 'splitFinalValue', type: 'uint8', indexed: false },
            { name: 'dealerFinalValue', type: 'uint8', indexed: false },
            { name: 'payout', type: 'uint256', indexed: false }
        ]
    },
    // Dealer draws a card during dealer play phase
    {
        name: 'BlackjackDealerHit',
        type: 'event',
        inputs: [
            { name: 'landId', type: 'uint256', indexed: true },
            { name: 'newCard', type: 'uint8', indexed: false },
            { name: 'dealerValue', type: 'uint8', indexed: false }
        ]
    },

    // Server-signed randomness functions
    {
        name: 'blackjackDealWithRandom',
        type: 'function',
        inputs: [
            { name: 'landId', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
            { name: 'randomSeed', type: 'bytes32' },
            { name: 'nonce', type: 'uint256' },
            { name: 'signature', type: 'bytes' }
        ],
        outputs: [],
        stateMutability: 'nonpayable'
    },
    {
        name: 'blackjackActionWithRandom',
        type: 'function',
        inputs: [
            { name: 'landId', type: 'uint256' },
            { name: 'handIndex', type: 'uint8' },
            { name: 'action', type: 'uint8' },
            { name: 'randomSeed', type: 'bytes32' },
            { name: 'nonce', type: 'uint256' },
            { name: 'signature', type: 'bytes' }
        ],
        outputs: [],
        stateMutability: 'nonpayable'
    },
    {
        name: 'blackjackGetNonce',
        type: 'function',
        inputs: [{ name: 'landId', type: 'uint256' }],
        outputs: [{ name: 'nonce', type: 'uint256' }],
        stateMutability: 'view'
    },
    {
        name: 'blackjackGetRandomnessSigner',
        type: 'function',
        inputs: [],
        outputs: [{ name: 'signer', type: 'address' }],
        stateMutability: 'view'
    }
] as const;

// Game phase enum
export enum BlackjackPhase {
    NONE = 0,
    BETTING = 1,
    PLAYER_TURN = 2,
    RESOLVED = 3
}

// Action enum
export enum BlackjackAction {
    HIT = 0,
    STAND = 1,
    DOUBLE = 2,
    SPLIT = 3,
    SURRENDER = 4
}

// Game result enum
export enum BlackjackResult {
    NONE = 0,
    PLAYER_WIN = 1,
    PLAYER_BLACKJACK = 2,
    DEALER_WIN = 3,
    DEALER_BLACKJACK = 4,
    PUSH = 5,
    PLAYER_BUST = 6,
    SURRENDERED = 7
}

// Card display utilities
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const SUITS = ['♠', '♥', '♦', '♣'] as const;

export function getCardDisplay(cardValue: number): { rank: string; suit: string; color: 'red' | 'black' } {
    const rank = RANKS[cardValue % 13];
    const suit = SUITS[Math.floor(cardValue / 13)];
    const color = suit === '♥' || suit === '♦' ? 'red' : 'black';
    return { rank, suit, color };
}

export function getCardBlackjackValue(cardValue: number): number {
    const rank = (cardValue % 13) + 1;
    if (rank === 1) return 11; // Ace
    if (rank >= 10) return 10; // 10, J, Q, K
    return rank;
}

export function calculateHandValue(cards: number[]): number {
    let value = 0;
    let aces = 0;

    for (const card of cards) {
        const cardVal = getCardBlackjackValue(card);
        if (cardVal === 11) aces++;
        value += cardVal;
    }

    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }

    return value;
}

export function getResultText(result: BlackjackResult): string {
    switch (result) {
        case BlackjackResult.PLAYER_WIN: return 'WIN!';
        case BlackjackResult.PLAYER_BLACKJACK: return 'BLACKJACK!';
        case BlackjackResult.DEALER_WIN: return 'Dealer Wins';
        case BlackjackResult.DEALER_BLACKJACK: return 'Dealer Blackjack';
        case BlackjackResult.PUSH: return 'Push';
        case BlackjackResult.PLAYER_BUST: return 'Bust!';
        case BlackjackResult.SURRENDERED: return 'Surrendered';
        default: return '';
    }
}
