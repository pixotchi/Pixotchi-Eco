export type GmDay = string; // YYYY-MM-DD UTC

export type GmTaskId =
  | 's1_buy5_elements'
  | 's1_buy_shield'
  | 's1_claim_production'
  | 's2_apply_resources'
  | 's2_attack_plant'
  | 's2_chat_message'
  | 's3_send_quest'
  | 's3_place_order'
  | 's3_claim_stake';

export type GmSectionKey = 's1' | 's2' | 's3';

export type GmMissionDay = {
  date: GmDay;
  s1: {
    buy5: boolean;
    buyElementsCount: number;
    buyShield: boolean;
    claimProduction: boolean;
    done: boolean;
  };
  s2: {
    applyResources: boolean;
    attackPlant: boolean;
    chatMessage: boolean;
    done: boolean;
  };
  s3: {
    sendQuest: boolean;
    placeOrder: boolean;
    claimStake: boolean;
    done: boolean;
  };
  pts: number; // 0..50
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


