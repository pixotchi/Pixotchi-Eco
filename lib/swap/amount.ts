import { formatUnits } from 'viem';
import { parseAmountInput } from '../amount-input';
import { SWAP_TOKEN_MAP } from './constants';
import type { UserSwapTokenId } from './types';

/** Max and quote-to-input transitions retain all executable token precision. */
export const formatEditableAmount = formatUnits;

export function parseInputAmount(amount: string, tokenId: UserSwapTokenId): bigint | null {
  return parseAmountInput(amount, SWAP_TOKEN_MAP[tokenId].decimals);
}
