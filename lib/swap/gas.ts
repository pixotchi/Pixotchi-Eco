import { encodeFunctionData, type Address, type Hex } from 'viem';
import { estimateTotalFee } from 'viem/op-stack';
import type { getBaseReadClient } from '../base-rpc';
import { ERC20_TOKEN_ABI } from './base-swap-abi';
import type { SwapBuildStepResponse } from './types';

type ReadClient = ReturnType<typeof getBaseReadClient>;
type Call = { to: Address; data: Hex; value: bigint };

// Include Base's L1 data fee, L2 execution and operator fee. Leave headroom for
// fee movement while the wallet is open, without imposing a fixed ETH minimum.
export const withSwapFeeBuffer = (fee: bigint) => fee * BigInt(2);

export async function estimateSwapCallFee(client: ReadClient, account: Address, call: Call) {
  return withSwapFeeBuffer(await estimateTotalFee(client, { account, ...call }));
}

export async function estimateNextSwapFee(client: ReadClient, account: Address, built: SwapBuildStepResponse) {
  if (built.approval) {
    const { token, spender, requiredAmount } = built.approval;
    const allowance = await client.readContract({ address: token, abi: ERC20_TOKEN_ABI, functionName: 'allowance', args: [account, spender] });
    if (allowance < BigInt(requiredAmount)) {
      const fee = await estimateSwapCallFee(client, account, {
        to: token, value: BigInt(0), data: encodeFunctionData({ abi: ERC20_TOKEN_ABI, functionName: 'approve', args: [spender, BigInt(requiredAmount)] }),
      });
      // Simulating the swap before approval would revert. Check the actual swap
      // after approval lands, and explicitly label this estimate as approval.
      return { fee, stage: 'approval' as const };
    }
  }
  const fee = await estimateSwapCallFee(client, account, { ...built.transaction, value: BigInt(built.transaction.value) });
  return { fee, stage: 'swap' as const };
}

export async function requireSwapCallFunds(client: ReadClient, account: Address, call: Call) {
  const [fee, balance] = await Promise.all([estimateSwapCallFee(client, account, call), client.getBalance({ address: account })]);
  if (balance < call.value + fee) throw new Error('Not enough ETH for this transaction and its estimated network fee.');
}
