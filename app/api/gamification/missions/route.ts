import { NextRequest, NextResponse } from 'next/server';
import {
  ChatAuthError,
  createChatAuthRequiredResponse,
  createChatAuthErrorResponse,
  getChatSessionOrQuickAuthFromRequest,
} from '@/lib/chat-auth';
import {
  getMissionDay,
  markMissionTask,
  getMissionScore,
  assertMissionProofUnused,
  MissionProofAlreadyUsedError,
  MissionProofPersistenceError,
} from '@/lib/gamification-service';
import { isValidEthereumAddressFormat } from '@/lib/utils';
import { isGmTaskId } from '@/lib/gamification-types';
import {
  missionTaskRequiresProof,
  validateMissionProofEvidence,
  type MissionEvidenceLog,
} from '@/lib/gamification-proof';
import {
  getReadClient,
  getShopItems,
  LAND_CONTRACT_ADDRESS,
  PIXOTCHI_NFT_ADDRESS,
} from '@/lib/contracts';
import { parseAbi, type Address, type Hex } from 'viem';
import { getGamificationPolicy } from '@/lib/gamification-feature';
import { getBaseTransactionReceipt } from '@/lib/base-rpc';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';

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

const MAX_COUNT_PER_UPDATE = 120;
const MAX_POST_BODY_CHARS = 2_048;
const PROOF_VERIFICATION_LIMIT_PER_MINUTE = 20;
const PROOF_VERIFICATION_IP_LIMIT_PER_MINUTE = 40;
const ERC721_ACCESS_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getApproved(uint256 tokenId) view returns (address)',
]);

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === 'null') return false;
  return ALLOWED_ORIGINS.has(origin);
}

function isHexHash(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseCanonicalProof(value: unknown): { txHash: Hex } | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'txHash' || !isHexHash(value.txHash)) return null;
  return { txHash: value.txHash.toLowerCase() as Hex };
}

function isAllowedMonth(value: string): boolean {
  return /^\d{4}(0[1-9]|1[0-2])$/.test(value) || /^(all|combined|lifetime)$/i.test(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTransactionReceiptWithRetry(
  txHash: Hex,
  maxAttempts = 3,
  delayMs = 1000,
): Promise<Awaited<ReturnType<typeof getBaseTransactionReceipt>> | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const receipt = await getBaseTransactionReceipt(txHash);
      if (receipt) return receipt;
    } catch (error: UntypedValue) {
      const isTimingError =
        error?.shortMessage?.includes('could not be found')
        || error?.details?.includes('indexing in progress')
        || error?.message?.includes('not found');

      if (isTimingError && attempt < maxAttempts - 1) {
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function hasAssetAccess(
  contract: Address,
  address: Address,
  tokenId: bigint,
  blockNumber: bigint,
): Promise<boolean> {
  const client = getReadClient();
  try {
    const [owner, approved] = await Promise.all([
      client.readContract({
        address: contract,
        abi: ERC721_ACCESS_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
        blockNumber,
      }),
      client.readContract({
        address: contract,
        abi: ERC721_ACCESS_ABI,
        functionName: 'getApproved',
        args: [tokenId],
        blockNumber,
      }),
    ]);
    return owner.toLowerCase() === address.toLowerCase()
      || approved.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
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
    if (month && !isAllowedMonth(month)) {
      return NextResponse.json({ error: 'month must be YYYYMM, all, combined, or lifetime' }, { status: 400 });
    }
    const gamificationPolicy = getGamificationPolicy();
    if (!gamificationPolicy.enabled) {
      return NextResponse.json({
        success: true,
        disabled: true,
        message: gamificationPolicy.message,
        day: null,
        total: 0,
      });
    }
    const [day, total] = await Promise.all([
      getMissionDay(address),
      getMissionScore(address, month),
    ]);
    return NextResponse.json({ success: true, day, total });
  } catch (error) {
    console.error('Error fetching mission day:', error);
    if (error instanceof MissionProofPersistenceError) {
      return NextResponse.json(
        {
          error: 'Mission summary is temporarily unavailable',
          code: error.code,
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'private, no-store' },
        },
      );
    }
    return NextResponse.json({ error: 'Failed to fetch mission day' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAllowedOrigin(request)) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
    }

    const contentLength = Number(request.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_POST_BODY_CHARS) {
      return NextResponse.json({ error: 'Request body is too large' }, { status: 413 });
    }
    const rawBody = await request.text();
    if (rawBody.length > MAX_POST_BODY_CHARS) {
      return NextResponse.json({ error: 'Request body is too large' }, { status: 413 });
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    if (!isPlainRecord(body)) {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }
    const { taskId, proof, count } = body;
    if (!isGmTaskId(taskId)) {
      return NextResponse.json({ error: 'Unknown taskId' }, { status: 400 });
    }
    if (count !== undefined && (
      typeof count !== 'number'
      || !Number.isSafeInteger(count)
      || count < 1
      || count > MAX_COUNT_PER_UPDATE
    )) {
      return NextResponse.json({ error: `count must be an integer from 1 to ${MAX_COUNT_PER_UPDATE}` }, { status: 400 });
    }
    const { session, sessionId } = await getChatSessionOrQuickAuthFromRequest(request);

    const gamificationPolicy = getGamificationPolicy();
    if (!gamificationPolicy.enabled) {
      return NextResponse.json({
        success: true,
        disabled: true,
        message: gamificationPolicy.message,
      });
    }

    if (!session) {
      return createChatAuthRequiredResponse({
        clearCookie: Boolean(sessionId),
        message: 'Authentication required.',
      });
    }

    const address = session.address;
    if (!isValidEthereumAddressFormat(address)) {
      return createChatAuthRequiredResponse({
        clearCookie: Boolean(sessionId),
        message: 'Authenticated wallet is invalid.',
      });
    }
    if (!missionTaskRequiresProof(taskId)) {
      if (taskId === 's2_chat_message') {
        return NextResponse.json(
          { error: 'Chat mission progress is recorded only after a stored public message.' },
          { status: 400 },
        );
      }
      if (count !== undefined) {
        return NextResponse.json({ error: 'count is only supported for element purchases' }, { status: 400 });
      }
      const updated = await markMissionTask(address, taskId, undefined, 1);
      return NextResponse.json({ success: true, day: updated });
    }

    const canonicalProof = parseCanonicalProof(proof);
    if (!canonicalProof) {
      return NextResponse.json({ error: 'A valid transaction proof is required' }, { status: 400 });
    }
    if (taskId !== 's4_buy10_elements' && count !== undefined) {
      return NextResponse.json({ error: 'count is only supported for element purchases' }, { status: 400 });
    }

    const rateLimitResponse = await enforceRateLimit(request, {
      failClosed: true,
      scope: 'api:gamification:missions:proof',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request) ?? 'unknown',
          limit: PROOF_VERIFICATION_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: address,
          limit: PROOF_VERIFICATION_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });
    if (rateLimitResponse) return rateLimitResponse;

    // This read is an optimization only; the atomic write in markMissionTask
    // remains the authoritative race-safe replay guard.
    await assertMissionProofUnused(canonicalProof.txHash);

    const receipt = await getTransactionReceiptWithRetry(canonicalProof.txHash);
    if (!receipt || receipt.status !== 'success') {
      return NextResponse.json({ error: 'Transaction proof was not found or did not succeed' }, { status: 403 });
    }

    const client = getReadClient();
    const [transaction, block] = await Promise.all([
      client.getTransaction({ hash: canonicalProof.txHash }),
      client.getBlock({ blockNumber: receipt.blockNumber }),
    ]);
    const proofDay = new Date(Number(block.timestamp) * 1_000).toISOString().slice(0, 10);
    const currentDay = new Date().toISOString().slice(0, 10);
    if (proofDay !== currentDay) {
      return NextResponse.json({ error: 'Transaction proof is not from the current mission day' }, { status: 403 });
    }

    let fenceItemIdsPromise: Promise<Set<string>> | null = null;
    const evidence = await validateMissionProofEvidence(
      address as Address,
      taskId,
      {
        status: receipt.status,
        logs: receipt.logs as MissionEvidenceLog[],
      },
      {
        from: transaction.from,
        to: transaction.to,
        input: transaction.input,
      },
      {
        hasLandAccess: (actor, tokenId) => hasAssetAccess(
          LAND_CONTRACT_ADDRESS,
          actor,
          tokenId,
          receipt.blockNumber,
        ),
        hasPlantAccess: (actor, tokenId) => hasAssetAccess(
          PIXOTCHI_NFT_ADDRESS,
          actor,
          tokenId,
          receipt.blockNumber,
        ),
        isFenceShopItem: async itemId => {
          try {
            fenceItemIdsPromise ??= getShopItems(client).then(items => new Set(
              items
                .filter(item => /(fence|shield)/i.test(item.name))
                .map(item => item.id),
            ));
            return (await fenceItemIdsPromise).has(itemId.toString());
          } catch {
            return false;
          }
        },
      },
    );
    if (!evidence.valid) {
      return NextResponse.json({ error: 'Transaction does not prove this mission task' }, { status: 403 });
    }

    const verifiedCount = taskId === 's4_buy10_elements' ? evidence.count : 1;
    if (taskId === 's4_buy10_elements' && (
      !verifiedCount
      || (count !== undefined && count !== verifiedCount)
    )) {
      return NextResponse.json({ error: 'count does not match the verified purchase events' }, { status: 400 });
    }

    const updated = await markMissionTask(address, taskId, canonicalProof, verifiedCount || 1);
    return NextResponse.json({ success: true, day: updated });
  } catch (error) {
    if (error instanceof ChatAuthError) {
      return createChatAuthErrorResponse(error);
    }
    if (error instanceof MissionProofAlreadyUsedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof MissionProofPersistenceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }

    console.error('Error updating mission:', error);
    return NextResponse.json({ error: 'Failed to update mission' }, { status: 500 });
  }
}
