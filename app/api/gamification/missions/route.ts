import { NextRequest, NextResponse } from 'next/server';
import { getMissionDay, markMissionTask, getMissionScore } from '@/lib/gamification-service';
import { isValidEthereumAddressFormat } from '@/lib/utils';
import type { GmProgressProof, GmTaskId } from '@/lib/gamification-types';
import { getReadClient } from '@/lib/contracts';
import { keccak256, toHex, type Hex } from 'viem';

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

const USER_OPERATION_EVENT_TOPIC = keccak256(
  toHex('UserOperationEvent(address,bytes32,address,uint256,bool,uint256,uint256)')
).toLowerCase();

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // SSR or same-origin fetch
  if (origin === 'null') return false;
  return ALLOWED_ORIGINS.has(origin);
}

function isHexHash(value: string): value is Hex {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function normalizeAddress(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const hex = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  return hex.length === 42 ? hex : null;
}

function extractUserOperationSender(logs: any[]): string | null {
  if (!Array.isArray(logs)) return null;
  for (const log of logs) {
    const topics = Array.isArray(log?.topics) ? log.topics : [];
    if (topics.length < 2) continue;
    const topic0 = typeof topics[0] === 'string' ? topics[0].toLowerCase() : null;
    if (topic0 !== USER_OPERATION_EVENT_TOPIC) continue;
    const senderTopic = topics[1];
    if (typeof senderTopic === 'string' && senderTopic.length >= 42) {
      return `0x${senderTopic.slice(-40)}`.toLowerCase();
    }
  }
  return null;
}

async function validateOnchainProof(address: string, proof: GmProgressProof | undefined, taskId: GmTaskId) {
  if (!proof || typeof proof.txHash !== 'string' || !proof.txHash) {
    throw new Error(`Transaction proof required for task ${taskId}`);
  }
  const txHash = proof.txHash;
  if (!isHexHash(txHash)) {
    throw new Error('Invalid transaction hash format');
  }

  try {
    const client = getReadClient();
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (!receipt) {
      throw new Error('Transaction not found');
    }
    if (receipt.status !== 'success') {
      throw new Error('Transaction did not succeed');
    }
    const normalizedTarget = normalizeAddress(address);
    if (!normalizedTarget) {
      throw new Error('Invalid wallet address');
    }
    const candidateSenders = new Set<string>();
    const receiptFrom = normalizeAddress(receipt.from);
    if (receiptFrom) candidateSenders.add(receiptFrom);

    const userOpSender = extractUserOperationSender((receipt as any)?.logs ?? []);
    if (userOpSender) candidateSenders.add(userOpSender);

    const metaSender =
      normalizeAddress((proof.meta as any)?.smartAccountAddress) ||
      normalizeAddress((proof.meta as any)?.sender);
    if (metaSender) candidateSenders.add(metaSender);

    if (!candidateSenders.has(normalizedTarget)) {
      throw new Error('Transaction sender mismatch');
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to verify transaction proof');
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

    if (TASKS_REQUIRING_PROOF.has(missionTaskId)) {
      await validateOnchainProof(address, proof, missionTaskId);
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

