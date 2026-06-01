export const queryKeys = {
  balances: (address: string | null | undefined) =>
    ["balances", address?.toLowerCase() ?? "anonymous"] as const,
  activity: (view: string, address: string | null | undefined) =>
    ["activity", view, address?.toLowerCase() ?? "all"] as const,
  leaderboard: (board: string, address: string | null | undefined) =>
    ["leaderboard", board, address?.toLowerCase() ?? "all"] as const,
  mint: (mintType: string, address: string | null | undefined) =>
    ["mint", mintType, address?.toLowerCase() ?? "anonymous"] as const,
} as const;

export type QueryKey = readonly UntypedValue[];

