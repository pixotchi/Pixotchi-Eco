import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { CdpClient } from '@coinbase/cdp-sdk';
import { PIXOTCHI_NFT_ADDRESS, PIXOTCHI_TOKEN_ADDRESS, EVM_EVENT_SIGNATURES, EVM_TOPICS } from '@/lib/contracts';
import { encodeFunctionData, maxUint256, createPublicClient } from 'viem';
import { base as baseChain } from 'viem/chains';
import { createResilientTransport } from '@/lib/rpc-transport';

// We reuse the CdpClient from agent mint logic if possible, or new instance
let cdp: CdpClient | null = null;
function getClient() {
  if (!cdp) {
    cdp = new CdpClient();
  }
  return cdp;
}

// Cache for agent smart account
let agentSmartAccount: any = null;

const CLAIM_LOCK_PREFIX = 'claim_lock:';

/**
 * Strain IDs eligible for free claim:
 * - Flora (1) - Sold out
 * - Taki (2) - Available
 * - Rosa (3) - Available
 * - Zest (4) - Available (Default)
 * - TYJ (5) - NOT eligible (requires JESSE token)
 */
const ELIGIBLE_STRAINS = [1, 2, 3, 4];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userAddress, verificationToken, provider, strainId } = body;

    if (!userAddress || !verificationToken || !provider) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Validate user address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    // 1. Check if token already claimed
    const claimKey = `verified_claims:${verificationToken}`;
    const existingClaim = await redis?.get(claimKey);

    if (existingClaim) {
      return NextResponse.json({ error: 'This verification has already claimed a plant.' }, { status: 400 });
    }

    // 2. Check distributed lock to prevent race conditions
    const lockKey = `${CLAIM_LOCK_PREFIX}${verificationToken}`;
    // Try to set lock with 120s TTL (longer for multi-step operation). If exists, returns 0 (false)
    const acquired = await redis?.set(lockKey, 'locked', { nx: true, ex: 120 });
    
    if (!acquired) {
       return NextResponse.json({ error: 'Claim in progress. Please wait.' }, { status: 429 });
    }

    try {
      const client = getClient();

      // Get or create agent smart account
      if (!agentSmartAccount) {
        const owner = await client.evm.getOrCreateAccount({ name: 'pixotchi-agent' });
        agentSmartAccount = await client.evm.getOrCreateSmartAccount({
          name: 'pixotchi-agent-sa-sp',
          owner,
          enableSpendPermissions: true, // Reuse the same account
        });
      }

      // 3. Validate strain ID
      const targetStrainId = strainId ? Number(strainId) : 4; // Default Zest
      if (!ELIGIBLE_STRAINS.includes(targetStrainId)) {
        return NextResponse.json({ 
          error: `Strain ${targetStrainId} is not eligible for free claim. Eligible strains: ${ELIGIBLE_STRAINS.join(', ')}` 
        }, { status: 400 });
      }

      // 4. Prepare Mint Transaction
      // Agent pays SEED + Gas

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
        args: [BigInt(targetStrainId)],
      });

      console.log(`[CLAIM] Minting strain ${targetStrainId} for ${userAddress} via Agent...`);

      const mintOp = await client.evm.sendUserOperation({
        smartAccount: agentSmartAccount,
        network: 'base',
        calls: [
          { to: PIXOTCHI_TOKEN_ADDRESS, value: BigInt(0), data: approveData },
          { to: PIXOTCHI_NFT_ADDRESS, value: BigInt(0), data: mintData }
        ]
      });

      const mintReceipt = await agentSmartAccount.waitForUserOperation(mintOp);
      if (mintReceipt.status !== 'complete') {
        throw new Error('Mint transaction failed');
      }

      console.log(`[CLAIM] Mint complete, tx: ${mintReceipt.transactionHash}`);

      // 5. Parse minted tokenId from Transfer event logs
      let mintedTokenId: bigint | null = null;
      
      try {
        const publicClient = createPublicClient({ chain: baseChain, transport: createResilientTransport() });
        const txReceipt = await publicClient.waitForTransactionReceipt({ 
          hash: mintReceipt.transactionHash as `0x${string}` 
        });
        
        const TRANSFER_SIG = EVM_EVENT_SIGNATURES.ERC20_TRANSFER;
        const zeroAddressTopic = EVM_TOPICS.ZERO_ADDRESS_TOPIC;
        const agentTopic = `0x000000000000000000000000${agentSmartAccount.address.slice(2).toLowerCase()}`;
        
        for (const log of txReceipt.logs || []) {
          if (`${log.address}`.toLowerCase() !== PIXOTCHI_NFT_ADDRESS.toLowerCase()) continue;
          const topics = log.topics as string[];
          if (!topics || topics.length < 4) continue;
          if (topics[0].toLowerCase() !== TRANSFER_SIG) continue;
          
          // ERC721 Transfer: topics[1]=from, topics[2]=to, topics[3]=tokenId
          // Mint = Transfer from 0x0 to agent
          if (topics[1].toLowerCase() === zeroAddressTopic && topics[2].toLowerCase() === agentTopic) {
            try {
              mintedTokenId = BigInt(topics[3]);
              console.log(`[CLAIM] Parsed minted token ID: ${mintedTokenId}`);
              break;
            } catch {}
          }
        }
      } catch (parseError) {
        console.error('[CLAIM] Error parsing mint logs:', parseError);
      }

      if (!mintedTokenId) {
        // Mint succeeded but couldn't parse token ID - still mark as claimed to prevent double mint
        console.error('[CLAIM] Could not parse token ID from mint transaction');
        
        await redis?.set(claimKey, JSON.stringify({
          userAddress,
          txHash: mintReceipt.transactionHash,
          timestamp: Date.now(),
          strainId: targetStrainId,
          status: 'mint_complete_transfer_pending',
          error: 'Could not parse token ID'
        }));

        return NextResponse.json({ 
          success: true, 
          status: 'partial',
          txHash: mintReceipt.transactionHash,
          message: 'Plant minted but transfer pending. Contact support if plant does not appear in your wallet.' 
        });
      }

      // 6. Transfer the minted NFT to the user
      console.log(`[CLAIM] Transferring token ${mintedTokenId} to ${userAddress}...`);

      const transferData = encodeFunctionData({
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
        args: [
          agentSmartAccount.address as `0x${string}`, 
          userAddress as `0x${string}`, 
          mintedTokenId
        ],
      });

      // Wait a bit for indexers/nodes to catch up with the Mint
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Retry logic for transfer to handle propagation delays
      let transferSuccess = false;
      let transferTxHash: string | null = null;
      let transferError: Error | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[CLAIM] Transfer attempt ${attempt}/3...`);
          
          const transferOp = await client.evm.sendUserOperation({
            smartAccount: agentSmartAccount,
            network: 'base',
            calls: [{ to: PIXOTCHI_NFT_ADDRESS, value: BigInt(0), data: transferData }],
          });
          
          const transferReceipt = await agentSmartAccount.waitForUserOperation(transferOp);
          
          if (transferReceipt.status === 'complete') {
            transferSuccess = true;
            transferTxHash = transferReceipt.transactionHash;
            console.log(`[CLAIM] Transfer successful, tx: ${transferTxHash}`);
            break;
          } else {
            throw new Error('Transfer UserOp status not complete');
          }
        } catch (e: any) {
          console.warn(`[CLAIM] Transfer attempt ${attempt} failed:`, e?.message || e);
          transferError = e;
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
          }
        }
      }

      // 7. Mark as claimed in Redis
      const claimRecord = {
        userAddress,
        mintTxHash: mintReceipt.transactionHash,
        transferTxHash: transferTxHash,
        tokenId: mintedTokenId.toString(),
        timestamp: Date.now(),
        strainId: targetStrainId,
        status: transferSuccess ? 'complete' : 'transfer_failed',
        transferError: transferSuccess ? null : (transferError?.message || 'Unknown error'),
      };

      await redis?.set(claimKey, JSON.stringify(claimRecord));

      if (transferSuccess) {
        return NextResponse.json({ 
          success: true,
          status: 'complete',
          mintTxHash: mintReceipt.transactionHash,
          transferTxHash: transferTxHash,
          tokenId: mintedTokenId.toString(),
          message: 'Plant claimed and transferred successfully!' 
        });
      } else {
        // Mint succeeded but transfer failed after retries
        console.error('[CLAIM] Failed to transfer token after retries:', transferError);
        
        return NextResponse.json({ 
          success: true,
          status: 'partial',
          mintTxHash: mintReceipt.transactionHash,
          tokenId: mintedTokenId.toString(),
          message: `Plant minted (ID: ${mintedTokenId}) but transfer failed. Contact support to retrieve your plant.`,
          error: transferError?.message || 'Transfer failed after retries'
        });
      }

    } catch (err: any) {
      console.error('[CLAIM] Claim error:', err);
      return NextResponse.json({ error: err.message || 'Claim failed' }, { status: 500 });
    } finally {
      // Release lock
      await redis?.del(lockKey);
    }

  } catch (error: any) {
    console.error('[CLAIM] Outer error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
