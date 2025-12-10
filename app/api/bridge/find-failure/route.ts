/**
 * Find Failed Bridge Transaction API
 * 
 * Finds the failed relay transaction on Base for a given message hash.
 * GET /api/bridge/find-failure?hash=<messageHash>
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;
const BRIDGE_CONTRACT = '0x3eff766C76a1be2Ce1aCF2B69c78bCae257D5188' as Address;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const messageHash = searchParams.get('hash');

  if (!messageHash) {
    return NextResponse.json({ error: 'Missing hash parameter' }, { status: 400 });
  }

  try {
    const publicClient = createPublicClient({ 
      chain: base, 
      transport: http(BASE_RPC) 
    });

    // Get the current block number
    const currentBlock = await publicClient.getBlockNumber();
    
    // Search in chunks of 5000 blocks (within RPC limits)
    // Look back ~2 days worth of blocks (Base ~2s blocks = ~86400 blocks/day)
    const CHUNK_SIZE = BigInt(5000);
    const MAX_BLOCKS_BACK = BigInt(50000); // ~1 day
    const fromBlock = currentBlock - MAX_BLOCKS_BACK;

    console.log(`Searching for events from block ${fromBlock} to ${currentBlock} in chunks of ${CHUNK_SIZE}`);

    // Search in chunks to avoid RPC limits
    const failedEvents: any[] = [];
    const successEvents: any[] = [];

    for (let start = fromBlock; start < currentBlock; start += CHUNK_SIZE) {
      const end = start + CHUNK_SIZE > currentBlock ? currentBlock : start + CHUNK_SIZE;
      
      try {
        const [failed, success] = await Promise.all([
          publicClient.getLogs({
            address: BRIDGE_CONTRACT,
            event: parseAbiItem('event FailedToRelayMessage(address indexed submitter, bytes32 indexed messageHash)'),
            args: { messageHash: messageHash as `0x${string}` },
            fromBlock: start,
            toBlock: end,
          }),
          publicClient.getLogs({
            address: BRIDGE_CONTRACT,
            event: parseAbiItem('event MessageSuccessfullyRelayed(address indexed submitter, bytes32 indexed messageHash)'),
            args: { messageHash: messageHash as `0x${string}` },
            fromBlock: start,
            toBlock: end,
          }),
        ]);
        
        failedEvents.push(...failed);
        successEvents.push(...success);
        
        // If we found events, we can stop searching older blocks
        if (failed.length > 0 || success.length > 0) break;
      } catch (e) {
        console.warn(`Chunk ${start}-${end} failed:`, e);
        // Continue to next chunk
      }
    }

    if (failedEvents.length === 0 && successEvents.length === 0) {
      return NextResponse.json({
        status: 'NO_EVENTS_FOUND',
        messageHash,
        hint: 'No relay attempts found for this message hash in the last 7 days',
        manualCheck: `https://basescan.org/address/${BRIDGE_CONTRACT}#events`,
      });
    }

    // Get transaction details for failed events
    const failedTxs = await Promise.all(
      failedEvents.map(async (event) => {
        const tx = await publicClient.getTransaction({ hash: event.transactionHash });
        const receipt = await publicClient.getTransactionReceipt({ hash: event.transactionHash });
        
        return {
          transactionHash: event.transactionHash,
          blockNumber: Number(event.blockNumber),
          submitter: event.args.submitter,
          gasUsed: receipt.gasUsed.toString(),
          gasLimit: tx.gas.toString(),
          status: receipt.status,
          basescanUrl: `https://basescan.org/tx/${event.transactionHash}`,
        };
      })
    );

    const successTxs = await Promise.all(
      successEvents.map(async (event) => ({
        transactionHash: event.transactionHash,
        blockNumber: Number(event.blockNumber),
        submitter: event.args.submitter,
        basescanUrl: `https://basescan.org/tx/${event.transactionHash}`,
      }))
    );

    // Analyze the failure
    let analysis = '';
    if (failedTxs.length > 0) {
      const lastFailed = failedTxs[failedTxs.length - 1];
      const gasUsed = BigInt(lastFailed.gasUsed);
      const gasLimit = BigInt(lastFailed.gasLimit);
      
      // If gas used is very close to gas limit, it's likely an out-of-gas issue
      if (gasUsed >= gasLimit - BigInt(1000)) {
        analysis = 'OUT_OF_GAS: The transaction ran out of gas. Retry with higher gasLimit.';
      } else {
        analysis = 'REVERT: The inner call reverted. Check the transaction on Basescan for details.';
      }
    }

    return NextResponse.json({
      status: 'FOUND',
      messageHash,
      analysis,
      failedAttempts: failedTxs,
      successfulAttempts: successTxs,
      totalFailures: failedTxs.length,
      wasEventuallySuccessful: successTxs.length > 0,
      recommendation: successTxs.length > 0 
        ? 'Message was eventually relayed successfully!' 
        : 'Retry with higher gas limit (500k-1M recommended)',
    });

  } catch (error) {
    console.error('Find failure error:', error);
    return NextResponse.json({ 
      error: 'Failed to search for events', 
      details: error instanceof Error ? error.message : 'Unknown error',
      manualCheck: `https://basescan.org/address/${BRIDGE_CONTRACT}#events`,
    }, { status: 500 });
  }
}

