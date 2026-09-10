import { decodeFunctionData, getAddress, parseAbi, type Address } from 'viem';
import { readUint } from '../contract-value';
import { BASE_CHAIN_ID, getKyberTokenAddress, getTokenAddress, isAllowedSwapRouter } from './constants';
import { SwapBuildInvalidError, SwapReviewRequiredError } from './errors';
import type { SwapBuildStepResponse, SwapTokenId } from './types';

// Verified MetaAggregationRouterV2 ABI at the allowlisted Base deployment.
// Executor bytes stay opaque: the router itself enforces the recipient's net
// balance increase against desc.minReturnAmount when partial filling is off.
export const KYBER_SWAP_ABI = parseAbi([
  'struct SwapDescription { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }',
  'struct SwapExecution { address callTarget; address approveTarget; bytes targetData; SwapDescription desc; bytes clientData; }',
  'function swap(SwapExecution execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
  'function swapGeneric(SwapExecution execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
  'function swapSimpleMode(address caller, SwapDescription desc, bytes executorData, bytes clientData) returns (uint256 returnAmount, uint256 gasUsed)',
]);

export interface SwapExecutionIntent {
  sender: Address;
  recipient: Address;
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: string;
  minOut: string;
}

const sameAddress = (left: string, right: string) => getAddress(left) === getAddress(right);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Shared server/browser check; no unsafe fallback for unknown router selectors. */
export function validateSwapExecution(built: SwapBuildStepResponse, intent: SwapExecutionIntent): bigint {
  try {
    const { transaction, approval, step } = built;
    if (step.key !== 'step1' || step.kind !== 'kyber'
      || step.sellToken !== intent.sellToken || step.buyToken !== intent.buyToken
      || step.amountIn !== intent.amountIn || transaction.chainId !== BASE_CHAIN_ID
      || !isAllowedSwapRouter(transaction.to)) throw new SwapBuildInvalidError();

    const decoded = decodeFunctionData({ abi: KYBER_SWAP_ABI, data: transaction.data });
    const desc = decoded.functionName === 'swapSimpleMode' ? decoded.args[1] : decoded.args[0].desc;
    const recipient = sameAddress(desc.dstReceiver, ZERO_ADDRESS) ? intent.sender : desc.dstReceiver;
    const native = intent.sellToken === 'ETH';
    const amountIn = readUint(intent.amountIn);
    const requiredMinimum = readUint(intent.minOut);
    if (amountIn === BigInt(0) || requiredMinimum === BigInt(0)
      || !sameAddress(desc.srcToken, getKyberTokenAddress(intent.sellToken))
      || !sameAddress(desc.dstToken, getKyberTokenAddress(intent.buyToken))
      || !sameAddress(recipient, intent.recipient) || desc.amount !== amountIn
      || readUint(transaction.value) !== (native ? amountIn : BigInt(0))
      || (native && decoded.functionName === 'swapSimpleMode')
      // Partial filling scales down the total floor; extra ETH and gas-token
      // burning are not part of a Pixotchi swap. Bit 512 is inert and allowed.
      || (desc.flags & BigInt(0x01 | 0x02 | 0x08 | 0x10)) !== BigInt(0)
      || desc.permit !== '0x' || desc.feeReceivers.length !== 0 || desc.feeAmounts.length !== 0
      || desc.srcReceivers.length !== desc.srcAmounts.length
      || desc.srcAmounts.reduce((sum, amount) => sum + amount, BigInt(0)) > amountIn) throw new SwapBuildInvalidError();

    if (native) {
      if (approval !== null) throw new SwapBuildInvalidError();
    } else if (!approval
      || !sameAddress(approval.token, getTokenAddress(intent.sellToken as Exclude<SwapTokenId, 'ETH'>))
      || !sameAddress(approval.spender, transaction.to)
      || readUint(approval.requiredAmount) !== amountIn) throw new SwapBuildInvalidError();

    if (desc.minReturnAmount < requiredMinimum || readUint(step.minOut) < requiredMinimum) {
      throw new SwapReviewRequiredError();
    }
    if (readUint(step.minOut) > desc.minReturnAmount) throw new SwapBuildInvalidError();
    return desc.minReturnAmount;
  } catch (error) {
    if (error instanceof SwapReviewRequiredError || error instanceof SwapBuildInvalidError) throw error;
    throw new SwapBuildInvalidError();
  }
}
