export const queryKeys = {
  balances: (address: string | null | undefined) =>
    ["balances", address?.toLowerCase() ?? "anonymous"] as const,
  activity: (view: string, address: string | null | undefined) =>
    ["activity", view, address?.toLowerCase() ?? "all"] as const,
  leaderboard: (board: string, address: string | null | undefined) =>
    ["leaderboard", board, address?.toLowerCase() ?? "all"] as const,
  mint: (mintType: string, address: string | null | undefined) =>
    ["mint", mintType, address?.toLowerCase() ?? "anonymous"] as const,
  plantsByOwner: (address: string | null | undefined) =>
    ["plantsByOwner", address?.toLowerCase() ?? "anonymous"] as const,
  landsByOwner: (address: string | null | undefined) =>
    ["landsByOwner", address?.toLowerCase() ?? "anonymous"] as const,
  landById: (address: string | null | undefined, landId: bigint | number | string | null | undefined) =>
    ["landById", address?.toLowerCase() ?? "anonymous", landId?.toString() ?? "none"] as const,
  buildingsByLand: (address: string | null | undefined, landId: bigint | number | string | null | undefined) =>
    ["buildingsByLand", address?.toLowerCase() ?? "anonymous", landId?.toString() ?? "none"] as const,
  // Global (not owner-scoped): the map renders every minted plot.
  landSupply: () => ["landSupply"] as const,
  landLeaderboard: () => ["landLeaderboard"] as const,
} as const;

export type QueryKey = readonly UntypedValue[];

