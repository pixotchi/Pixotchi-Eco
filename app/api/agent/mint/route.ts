import { NextRequest, NextResponse } from 'next/server';
import { CdpClient } from '@coinbase/cdp-sdk';
import { parseUnits, encodeFunctionData, maxUint256, createPublicClient, http } from 'viem';
import { base as baseChain } from 'viem/chains';
import { PIXOTCHI_TOKEN_ADDRESS, PIXOTCHI_NFT_ADDRESS, EVM_EVENT_SIGNATURES, EVM_TOPICS } from '@/lib/contracts';
import { getRpcConfig } from '@/lib/env-config';

// Create a single CDP client instance per runtime
let cdp: CdpClient | null = null;
function getClient() {
  if (!cdp) {
    // v2 Server Wallet client loads from env automatically when no args are passed
    // Requires: CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
    cdp = new CdpClient();
  }
  return cdp;
}

// Cache for agent smart account
let agentSmartAccount: any = null;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userAddress, count, strainId, totalSeedRequired, preparedSpendCalls } = body;

    if (!userAddress || !count || !totalSeedRequired) {
      return NextResponse.json({ 
        error: 'Missing required parameters: userAddress, count, totalSeedRequired' 
      }, { status: 400 });
    }

    const client = getClient();
    
    // Get or create agent smart account
    if (!agentSmartAccount) {
      const owner = await client.evm.getOrCreateAccount({ name: 'pixotchi-agent' });
      agentSmartAccount = await client.evm.getOrCreateSmartAccount({
        name: 'pixotchi-agent-sa-sp',
        owner,
        enableSpendPermissions: true,
      });
    }

    // If client provided prepared spend calls (Base Account stack), prefer them.
    // Otherwise, fall back to CDP useSpendPermission flow.
    let preCalls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [];

    if (Array.isArray(preparedSpendCalls) && preparedSpendCalls.length > 0) {
      try {
        preCalls = preparedSpendCalls.map((c: any) => ({
          to: c.to as `0x${string}`,
          value: c.value ? BigInt(c.value) : BigInt(0),
          data: (c.data || '0x') as `0x${string}`,
        }));
      } catch (e) {
        return NextResponse.json({ error: 'Invalid preparedSpendCalls format' }, { status: 400 });
      }
    } else {
      // Legacy flow: pull via CDP spend permissions
      const allPermissions = await client.evm.listSpendPermissions({
        address: userAddress as `0x${string}`,
      });

      const agentPermissions = allPermissions.spendPermissions?.filter(
        (p: any) => p.permission.spender.toLowerCase() === agentSmartAccount.address.toLowerCase()
      ) || [];

      if (agentPermissions.length === 0) {
        return NextResponse.json({ 
          error: 'No spend permissions found. Please grant spend permission to the agent first.' 
        }, { status: 400 });
      }

      // Find SEED token permission
      const seedPermission = agentPermissions.find(
        (p: any) => p.permission.token.toLowerCase() === PIXOTCHI_TOKEN_ADDRESS.toLowerCase()
      );

      if (!seedPermission) {
        return NextResponse.json({ 
          error: 'No SEED token spend permission found. Please grant SEED spend permission.' 
        }, { status: 400 });
      }

      const requiredAmount = parseUnits(
        (typeof totalSeedRequired === 'number' ? totalSeedRequired.toFixed(6) : String(totalSeedRequired)),
        18
      );
      const availableAllowance = BigInt(seedPermission.permission.allowance);

      const now = Math.floor(Date.now() / 1000);
      const startTime = typeof seedPermission.permission.start === 'string'
        ? parseInt(seedPermission.permission.start)
        : seedPermission.permission.start;
      const endTime = typeof seedPermission.permission.end === 'string'
        ? parseInt(seedPermission.permission.end)
        : seedPermission.permission.end;
      const isTimeValid = now >= startTime && now <= endTime;
      if (!isTimeValid) {
        return NextResponse.json({ error: 'Spend permission not active (start/end window).' }, { status: 400 });
      }
      if (requiredAmount > availableAllowance) {
        return NextResponse.json({ error: 'Insufficient spend permission allowance.' }, { status: 400 });
      }

      const spendValue = requiredAmount > availableAllowance ? availableAllowance : requiredAmount;

      const spendResult = await agentSmartAccount.useSpendPermission({
        spendPermission: seedPermission.permission,
        value: spendValue.toString(),
        network: 'base',
      });

      const spendReceipt = await agentSmartAccount.waitForUserOperation(spendResult);
      if (spendReceipt.status !== 'complete') {
        return NextResponse.json({ error: 'Spend permission transaction failed' }, { status: 500 });
      }
    }

    // Build approve (SEED -> NFT) and mint calls from Agent Smart Account
    const approveData = encodeFunctionData({
      abi: [{
        type: 'function',
        name: 'approve',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
      }],
      functionName: 'approve',
      args: [PIXOTCHI_NFT_ADDRESS, maxUint256],
    });

    const mintData = encodeFunctionData({
      abi: [{
        type: 'function',
        name: 'mint',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'strain', type: 'uint256' }],
        outputs: [],
      }],
      functionName: 'mint',
      args: [BigInt(strainId || 1)],
    });

    const mintOp = await client.evm.sendUserOperation({
      smartAccount: agentSmartAccount,
      // Force correct network to avoid mismatches in env config
      network: 'base',
      // Intentionally omit paymasterUrl to avoid estimation issues; Agent SA has ETH
      calls: [
        // If present, execute prepared spend calls first (Base Account stack)
        ...preCalls,
        { to: PIXOTCHI_TOKEN_ADDRESS, value: BigInt(0), data: approveData },
        // Mint "count" times
        ...Array.from({ length: Number(count || 1) }, () => ({ to: PIXOTCHI_NFT_ADDRESS, value: BigInt(0), data: mintData })),
      ],
    });

    const mintReceipt = await agentSmartAccount.waitForUserOperation(mintOp);
    if (mintReceipt.status !== 'complete') {
      return NextResponse.json({ error: 'Mint transaction failed' }, { status: 500 });
    }

    // Parse minted tokenIds (Transfer event from 0x0 -> agent)
    let mintedTokenIds: bigint[] = [];
    try {
      const rpc = getRpcConfig();
      const client = createPublicClient({ chain: baseChain, transport: http(rpc.endpoints[0]) });
      const txReceipt = await client.waitForTransactionReceipt({ hash: mintReceipt.transactionHash as `0x${string}` });
      const TRANSFER_SIG = EVM_EVENT_SIGNATURES.ERC20_TRANSFER;
      const zeroAddressTopic = EVM_TOPICS.ZERO_ADDRESS_TOPIC;
      const agentTopic = `0x000000000000000000000000${agentSmartAccount.address.slice(2).toLowerCase()}`;
      for (const log of txReceipt.logs || []) {
        if (`${log.address}`.toLowerCase() !== PIXOTCHI_NFT_ADDRESS.toLowerCase()) continue;
        const topics = log.topics as string[];
        if (!topics || topics.length < 4) continue;
        if (topics[0].toLowerCase() !== TRANSFER_SIG) continue;
        // topics[1]=from, topics[2]=to, topics[3]=tokenId
        if (topics[1].toLowerCase() === zeroAddressTopic && topics[2].toLowerCase() === agentTopic) {
          try {
            const tokenId = BigInt(topics[3]);
            mintedTokenIds.push(tokenId);
          } catch {}
        }
      }
    } catch {}

    // If we minted to the agent, transfer to the user
    if (mintedTokenIds.length > 0 && userAddress) {
      const transferDataList = mintedTokenIds.map((tokenId) => encodeFunctionData({
        abi: [{
          type: 'function',
          name: 'transferFrom',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'tokenId', type: 'uint256' },
          ],
          outputs: [],
        }],
        functionName: 'transferFrom',
        args: [agentSmartAccount.address as `0x${string}`, userAddress as `0x${string}`, tokenId],
      }));

      const transferOp = await client.evm.sendUserOperation({
        smartAccount: agentSmartAccount,
        network: 'base',
        calls: transferDataList.map((data) => ({ to: PIXOTCHI_NFT_ADDRESS, value: BigInt(0), data })),
      });
      const transferReceipt = await agentSmartAccount.waitForUserOperation(transferOp);
      if (transferReceipt.status !== 'complete') {
        return NextResponse.json({ error: 'Transfer to user failed after mint', mintedTokenIds: mintedTokenIds.map(String) }, { status: 500 });
      }
    }

    const mintResult = {
      transactionHash: mintReceipt.transactionHash,
      plantsMinited: count,
      strainId: strainId || 1,
      seedSpent: totalSeedRequired,
      status: 'success',
      mintedTokenIds: mintedTokenIds.map(String),
      transferredTo: userAddress || null,
    };

    return NextResponse.json({
      success: true,
      message: `Successfully minted ${count} plants using ${totalSeedRequired} SEED!`,
      result: mintResult,
      spendTransactionHash: undefined,
    });

  } catch (error: any) {
    console.error('Agent mint error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to execute mint transaction' 
    }, { status: 500 });
  }
}
