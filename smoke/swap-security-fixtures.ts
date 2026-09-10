import { encodeFunctionData, type Address } from 'viem';
import { KYBER_SWAP_ABI } from '../lib/swap/calldata';
import { getKyberTokenAddress, getTokenAddress } from '../lib/swap/constants';
import type { SwapBuildStepResponse, SwapQuoteStep } from '../lib/swap/types';

export const swapFixtureSender = '0x1111111111111111111111111111111111111111' as Address;
export const swapFixtureRouter = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5' as Address;

export function createSwapBuildFixture(step: SwapQuoteStep, sender = swapFixtureSender,
  selector: 'swap' | 'swapGeneric' | 'swapSimpleMode' = 'swap', changes: { flags?: bigint; minimum?: bigint;
    recipient?: Address; permit?: `0x${string}`; fee?: boolean; amount?: bigint } = {}): SwapBuildStepResponse {
  const desc = {
    srcToken: getKyberTokenAddress(step.sellToken), dstToken: getKyberTokenAddress(step.buyToken),
    srcReceivers: [] as Address[], srcAmounts: [] as bigint[],
    feeReceivers: changes.fee ? [sender] : [] as Address[], feeAmounts: changes.fee ? [BigInt(1)] : [] as bigint[],
    dstReceiver: changes.recipient ?? sender, amount: changes.amount ?? BigInt(step.amountIn),
    minReturnAmount: changes.minimum ?? BigInt(step.minOut), flags: changes.flags ?? BigInt(512),
    permit: changes.permit ?? '0x' as const,
  };
  const data = selector === 'swapSimpleMode'
    ? encodeFunctionData({ abi: KYBER_SWAP_ABI, functionName: selector, args: [swapFixtureRouter, desc, '0x1234', '0x'] })
    : encodeFunctionData({ abi: KYBER_SWAP_ABI, functionName: selector,
      args: [{ callTarget: swapFixtureRouter, approveTarget: swapFixtureRouter, desc, targetData: '0x1234', clientData: '0x' }] });
  return { step, approval: step.sellToken === 'ETH' ? null : {
    token: getTokenAddress(step.sellToken), spender: swapFixtureRouter, requiredAmount: step.amountIn,
  }, transaction: { to: swapFixtureRouter, data, value: step.sellToken === 'ETH' ? step.amountIn : '0', chainId: 8453 } };
}
