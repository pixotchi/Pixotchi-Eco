import { landAbi as LAND_ABI } from '@/public/abi/pixotchi-v3-abi';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import type { TransactionCall } from '@/lib/types';

export const getLandMintCall = (): TransactionCall => ({
  address: LAND_CONTRACT_ADDRESS,
  abi: LAND_ABI,
  functionName: 'mint',
  args: [],
});
