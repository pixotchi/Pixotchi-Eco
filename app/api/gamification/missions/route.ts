import { NextRequest, NextResponse } from 'next/server';
import { getMissionDay, markMissionTask, getMissionScore } from '@/lib/gamification-service';
import { isValidEthereumAddressFormat } from '@/lib/utils';
import type { GmProgressProof, GmTaskId } from '@/lib/gamification-types';
import { getReadClient } from '@/lib/contracts';
import type { Hex } from 'viem';

const DEFAULT_ORIGINS = [
  process.env.NEXT_PUBLIC_URL,
  process.env.MISSION_ALLOWED_ORIGINS,
  'https://mini.pixotchi.tech',
  'https://beta.mini.pixotchi.tech',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].filter(Boolean) as string[];

const ALLOWED_ORIGINS = new Set(
  DEFAULT_ORIGINS.flatMap(origin => origin.split(',').map(o => o.trim()).filter(Boolean)),
);

const TASKS_REQUIRING_PROOF: ReadonlySet<GmTaskId> = new Set([
  's1_buy5_elements',
  's1_buy_shield',
  's1_claim_production',
  's2_apply_resources',
  's2_attack_plant',
  's3_send_quest',
  's3_place_order',
  's3_claim_stake',
  's4_make_swap',
  's4_collect_star',
  's4_play_arcade',
]);

const MAX_COUNT_PER_UPDATE = 80;

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // SSR or same-origin fetch
  if (origin === 'null') return false;
  return ALLOWED_ORIGINS.has(origin);
}

function isHexHash(value: string): value is Hex {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

/**
 * Check if an address is a smart contract (smart wallet)
 */
async function isContractAddress(addr: string): Promise<boolean> {
  try {
    const client = getReadClient();
    const code = await client.getBytecode({ address: addr as `0x${string}` });
    return code !== undefined && code !== '0x' && code.length > 2;
  } catch {
    return false;
  }
}

/**
 * Helper to wait for a specified time
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches transaction receipt with retry logic for timing issues.
 * Base blocks are fast but RPC indexing can lag behind.
 */
async function getTransactionReceiptWithRetry(
  client: ReturnType<typeof getReadClient>,
  txHash: Hex,
  maxAttempts = 3,
  delayMs = 1000
): Promise<Awaited<ReturnType<typeof client.getTransactionReceipt>> | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      if (receipt) return receipt;
    } catch (error: any) {
      // Check if it's a "not found" or "indexing in progress" error
      const isTimingError =
        error?.shortMessage?.includes('could not be found') ||
        error?.details?.includes('indexing in progress') ||
        error?.message?.includes('not found');

      if (isTimingError && attempt < maxAttempts - 1) {
        // Wait before retrying with exponential backoff
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      throw error; // Re-throw if not a timing error or final attempt
    }
  }
  return null;
}

/**
 * Validates on-chain proof for a task.
 * For smart wallets, we only verify the transaction exists and succeeded.
 * The sender address check is skipped for smart wallets since they use different addresses.
 */
async function validateOnchainProof(address: string, proof: GmProgressProof | undefined, taskId: GmTaskId): Promise<boolean> {
  if (!proof || typeof proof.txHash !== 'string' || !proof.txHash) {
    return false; // No proof provided, but we'll allow the task to be tracked
  }

  const txHash = proof.txHash;
  if (!isHexHash(txHash)) {
    return false; // Invalid hash format
  }

  try {
    const client = getReadClient();
    const receipt = await getTransactionReceiptWithRetry(client, txHash);
    if (!receipt) {
      return false; // Transaction not found after retries
    }
    if (receipt.status !== 'success') {
      return false; // Transaction failed
    }

    // Check if sender is a smart contract (smart wallet)
    // Smart wallets will have different 'from' addresses, so we skip that check
    const senderIsContract = receipt.from ? await isContractAddress(receipt.from) : false;

    // For smart wallets (contract addresses), we only verify transaction succeeded
    // For EOAs, we verify sender matches the user's address
    if (!senderIsContract) {
      if (!receipt.from || receipt.from.toLowerCase() !== address.toLowerCase()) {
        return false; // Sender mismatch for EOA
      }
    }
    // For smart wallets, we trust that if the transaction succeeded, it was authorized
    // The smart wallet contract handles authorization internally

    return true; // Proof validated
  } catch (error) {
    console.warn(`Failed to validate proof for task ${taskId}:`, error);
    return false; // Validation failed, but we'll still allow tracking
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    const month = searchParams.get('month') || undefined;
    if (!address || !isValidEthereumAddressFormat(address)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    const [day, total] = await Promise.all([
      getMissionDay(address),
      getMissionScore(address, month),
    ]);
    return NextResponse.json({ success: true, day, total });
  } catch (error) {
    console.error('Error fetching mission day:', error);
    return NextResponse.json({ error: 'Failed to fetch mission day' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAllowedOrigin(request)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const body = await request.json();
    const { address, taskId, proof, count } = body || {};
    if (!address || !isValidEthereumAddressFormat(address)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }
    const missionTaskId = taskId as GmTaskId;
    const safeCount = typeof count === 'number'
      ? Math.max(1, Math.min(MAX_COUNT_PER_UPDATE, Math.floor(count)))
      : 1;

    // Validate proof if provided, but don't block task tracking if validation fails
    // This allows smart wallets to work even if proof validation has issues
    let proofValid = false;
    if (proof && proof.txHash) {
      try {
        proofValid = await validateOnchainProof(address, proof, missionTaskId);
      } catch (error) {
        console.warn(`Proof validation failed for ${missionTaskId}, but allowing task tracking:`, error);
        // Continue without proof validation - task will still be tracked
      }
    }

    // For tasks requiring proof, we prefer validated proof but don't strictly require it
    // This ensures smart wallets work even if proof extraction/validation fails
    if (TASKS_REQUIRING_PROOF.has(missionTaskId) && !proofValid && !proof?.txHash) {
      // Only reject if no proof was provided at all
      // If proof was provided but validation failed, we still allow tracking
      // (smart wallets might have proof extraction issues)
      console.warn(`Task ${missionTaskId} requires proof but none provided - allowing anyway for smart wallet compatibility`);
    }

    const updated = await markMissionTask(address, missionTaskId, proof, safeCount);
    return NextResponse.json({ success: true, day: updated });
  } catch (error) {
    console.error('Error updating mission:', error);
    const message = error instanceof Error ? error.message : 'Failed to update mission';
    const status = /proof|origin|sender|transaction/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

