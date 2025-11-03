export const fenceV2Abi = [
  {
    type: "function",
    name: "fenceV2GetConfig",
    inputs: [],
    outputs: [
      { name: "pricePerDay", type: "uint256" },
      { name: "minDurationDays", type: "uint256" },
      { name: "maxDurationDays", type: "uint256" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "fenceV2EffectUntil",
    inputs: [{ name: "nftId", type: "uint256" }],
    outputs: [{ name: "effectUntil", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "fenceV2IsEffectOngoing",
    inputs: [{ name: "nftId", type: "uint256" }],
    outputs: [{ name: "isActive", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "fenceV2HasFenceV1",
    inputs: [{ name: "nftId", type: "uint256" }],
    outputs: [{ name: "hasFenceV1", type: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "fenceV2Quote",
    inputs: [{ name: "days", type: "uint256" }],
    outputs: [{ name: "cost", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "fenceV2Purchase",
    inputs: [
      { name: "nftId", type: "uint256" },
      { name: "days", type: "uint256" }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "fenceV2SetPricePerDay",
    inputs: [{ name: "pricePerDay", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const;

