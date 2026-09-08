import {
  GM_SECTION_REWARDS,
  type GmMissionDay,
  type GmSectionKey,
  type GmTaskId,
} from "@/lib/gamification-types";

export type MissionDestination =
  "swap" | "stake" | "chat" | "ranking" | "plants" | "lands";
type MissionDefinition = {
  id: GmTaskId;
  label: string;
  destination: MissionDestination;
  actionLabel: string;
  prerequisite?: string;
  done: (day: GmMissionDay) => boolean;
};
export const MISSION_SECTIONS: readonly {
  key: GmSectionKey;
  title: string;
  tasks: readonly MissionDefinition[];
}[] = [
  {
    key: "s1",
    title: "General",
    tasks: [
      {
        id: "s1_make_swap",
        label: "Make a SEED swap",
        destination: "swap",
        actionLabel: "Open Swap",
        done: (day) => day.s1.makeSwap,
      },
      {
        id: "s1_stake_seed",
        label: "Stake SEED",
        destination: "stake",
        actionLabel: "Open Staking",
        prerequisite: "Requires SEED.",
        done: (day) => day.s1.stakeSeed,
      },
      {
        id: "s1_claim_stake",
        label: "Claim stake rewards",
        destination: "stake",
        actionLabel: "Open Staking",
        prerequisite: "Requires claimable staking rewards.",
        done: (day) => day.s1.claimStake,
      },
      {
        id: "s1_place_order",
        label: "Place a SEED/LEAF order",
        destination: "lands",
        actionLabel: "Open Lands",
        prerequisite: "Select Marketplace in your land’s Town.",
        done: (day) => day.s1.placeOrder,
      },
    ],
  },
  {
    key: "s2",
    title: "Social",
    tasks: [
      {
        id: "s2_follow_player",
        label: "Follow a player",
        destination: "ranking",
        actionLabel: "Find a player",
        prerequisite: "Open a player profile to follow them.",
        done: (day) => day.s2.followPlayer,
      },
      {
        id: "s2_chat_message",
        label: "Send a message in public chat",
        destination: "chat",
        actionLabel: "Open public chat",
        done: (day) => day.s2.chatMessage,
      },
      {
        id: "s2_visit_profile",
        label: "Visit a profile",
        destination: "ranking",
        actionLabel: "Find a player",
        done: (day) => day.s2.visitProfile,
      },
    ],
  },
  {
    key: "s3",
    title: "Land",
    tasks: [
      {
        id: "s3_apply_resources",
        label: "Apply resources or production to a plant",
        destination: "lands",
        actionLabel: "Open Lands",
        prerequisite: "Requires a land, a plant and available resources.",
        done: (day) => day.s3.applyResources,
      },
      {
        id: "s3_send_quest",
        label: "Send a farmer on a quest",
        destination: "lands",
        actionLabel: "Open Lands",
        prerequisite: "Requires a Farmer House with an available farmer.",
        done: (day) => day.s3.sendQuest,
      },
      {
        id: "s3_claim_production",
        label: "Claim production from any building",
        destination: "lands",
        actionLabel: "Open Lands",
        prerequisite: "Requires a producing building with a ready collection.",
        done: (day) => day.s3.claimProduction,
      },
      {
        id: "s3_play_casino_game",
        label: "Play roulette, blackjack, or baccarat",
        destination: "lands",
        actionLabel: "Open Lands",
        prerequisite: "Requires a Casino. Games involve a wager.",
        done: (day) => day.s3.playCasinoGame,
      },
    ],
  },
  {
    key: "s4",
    title: "Plant",
    tasks: [
      {
        id: "s4_buy10_elements",
        label: "Buy at least 10 elements",
        destination: "plants",
        actionLabel: "Open Plants",
        prerequisite: "Requires a plant and payment for its care items.",
        done: (day) => day.s4.buy10,
      },
      {
        id: "s4_buy_shield",
        label: "Buy a shield or fence",
        destination: "plants",
        actionLabel: "Open Plants",
        prerequisite: "Requires a living plant eligible for protection.",
        done: (day) => day.s4.buyShield,
      },
      {
        id: "s4_collect_star",
        label: "Collect a star by killing a plant",
        destination: "ranking",
        actionLabel: "Open Ranking",
        prerequisite: "Find an eligible dead plant and check your cooldown.",
        done: (day) => day.s4.collectStar,
      },
      {
        id: "s4_play_arcade",
        label: "Play Box or Spin in the arcade",
        destination: "plants",
        actionLabel: "Open Plants",
        prerequisite: "Open the Arcade from your plant.",
        done: (day) => day.s4.playArcade,
      },
    ],
  },
];

export function getMissionSections(day: GmMissionDay | null) {
  return MISSION_SECTIONS.map((section) => ({
    ...section,
    reward: GM_SECTION_REWARDS[section.key],
    earned: day?.[section.key].done,
    tasks: section.tasks.map((task) => ({
      ...task,
      done: day ? task.done(day) : undefined,
    })),
  }));
}

export type MissionSummary = {
  day: GmMissionDay;
  total: number;
  streak: { current: number; best: number };
};
export function parseMissionSummary(
  streakPayload: unknown,
  missionPayload: unknown,
): MissionSummary {
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const s = record(record(streakPayload).streak);
  const m = record(missionPayload);
  const day = record(m.day);
  const validNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (
    !validNumber(s.current) ||
    !validNumber(s.best) ||
    !validNumber(m.total) ||
    !validNumber(day.pts) ||
    (day.pts as number) > 100 ||
    typeof day.date !== "string"
  )
    throw new Error("Task progress data is incomplete.");
  const fields = {
    s1: ["makeSwap", "stakeSeed", "claimStake", "placeOrder", "done"],
    s2: ["followPlayer", "chatMessage", "visitProfile", "done"],
    s3: [
      "applyResources",
      "sendQuest",
      "claimProduction",
      "playCasinoGame",
      "done",
    ],
    s4: ["buy10", "buyShield", "collectStar", "playArcade", "done"],
  };
  for (const [section, keys] of Object.entries(fields))
    if (keys.some((key) => typeof record(day[section])[key] !== "boolean"))
      throw new Error("Task checklist data is incomplete.");
  return {
    day: day as GmMissionDay,
    total: m.total as number,
    streak: { current: s.current as number, best: s.best as number },
  };
}
