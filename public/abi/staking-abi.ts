export const stakingAbi = [
  {
    "inputs": [ { "internalType": "uint256", "name": "amount", "type": "uint256" } ],
    "name": "stake",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "amount", "type": "uint256" } ],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimRewards",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address", "name": "user", "type": "address" } ],
    "name": "getStakeInfo",
    "outputs": [
      { "internalType": "uint256", "name": "staked", "type": "uint256" },
      { "internalType": "uint256", "name": "rewards", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];


