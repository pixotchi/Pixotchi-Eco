export type GmDay = string; // YYYY-MM-DD UTC

export type GmTaskId =
  | 's1_make_swap'
  | 's1_stake_seed'
  | 's1_claim_stake'
  | 's1_place_order'
  | 's2_follow_player'
  | 's2_chat_message'
  | 's2_visit_profile'
  | 's3_apply_resources'
  | 's3_send_quest'
  | 's3_claim_production'
  | 's3_play_casino_game'
  | 's4_buy10_elements'
  | 's4_buy_shield'
  | 's4_collect_star'
  | 's4_play_arcade';

export type GmSectionKey = 's1' | 's2' | 's3' | 's4';

export type GmMissionDay = {
  date: GmDay;
  s1: {
    makeSwap: boolean;
    stakeSeed: boolean;
    claimStake: boolean;
    placeOrder: boolean;
    done: boolean;
  };
  s2: {
    followPlayer: boolean;
    chatMessage: boolean;
    visitProfile: boolean;
    done: boolean;
  };
  s3: {
    applyResources: boolean;
    sendQuest: boolean;
    claimProduction: boolean;
    playCasinoGame: boolean;
    done: boolean;
  };
  s4: {
    buy10: boolean;
    buyElementsCount: number;
    buyShield: boolean;
    collectStar: boolean;
    playArcade: boolean;
    done: boolean;
  };
  pts: number; // 0..100
  completedAt?: number;
};

export type GmStreak = {
  current: number;
  best: number;
  lastActive: GmDay | '';
};

export type GmProgressProof = {
  txHash?: string;
  meta?: Record<string, any>;
};

export type GmLeaderEntry = { address: string; value: number };

