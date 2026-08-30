import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import type { TransactionCall } from '@/lib/types';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [{ name: 'strain', type: 'uint256' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const getPlantMintCall = (strain: number): TransactionCall => ({
  address: PIXOTCHI_NFT_ADDRESS,
  abi: PIXOTCHI_NFT_ABI,
  functionName: 'mint',
  args: [BigInt(strain)],
});
