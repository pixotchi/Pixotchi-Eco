import { getBaseReadClient } from '@/lib/base-rpc';
import { getCasinoPolicy } from '@/lib/casino-feature';
import { BLACKJACK_DISABLED_MESSAGE } from '@/lib/casino-policy';
import { blackjackRandomnessLockMismatch,normalizeBlackjackLockBetAmount } from '@/lib/blackjack-randomness-lock.mjs';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { redis,redisCompareAndSetJSON,redisDel,redisGetJSON } from '@/lib/redis';
import { blackjackAbi } from '@/public/abi/blackjack-abi';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { NextRequest,NextResponse } from 'next/server';
import { encodePacked,isAddress,keccak256,type Hex } from 'viem';
import { privateKeyToAccount,signMessage } from 'viem/accounts';

/**
 * Server-Signed Randomness API for Blackjack
 * 
 * This endpoint generates cryptographically secure random seeds and signs them
 * for use in the smart contract. This allows single-transaction gameplay.
 * 
 * ANTI-CHEAT: Once randomness is issued for a (landId, nonce), the same randomness
 * is returned for all subsequent requests until the nonce is consumed onchain.
 * This prevents users from "shopping" for favorable outcomes by canceling and retrying.
 */

// Get the signer private key from environment
const SIGNER_PRIVATE_KEY = process.env.BLACKJACK_RANDOMNESS_SIGNER_KEY;

// Rate limiting: track recent requests per address
const recentRequests = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // Max 30 requests per minute per address
const RANDOMNESS_LIFETIME_SECONDS = 60;
const ACTION_LOCK_TTL_SECONDS = RANDOMNESS_LIFETIME_SECONDS + 45;
const ALLOW_MEMORY_RANDOMNESS_LOCKS = process.env.NODE_ENV !== 'production';

interface CachedRandomness {
    randomSeed: Hex;
    signature: string;
    timestamp: number;
    signerAddress: string;
    actionNum: number;
    handIndex: number;
    bettingToken: string;
    playerAddress: string;
    betAmountWei: string | null;
}

const ACTION_LOCK_KEY_PREFIX = 'blackjack:action-lock:';
const nonceRandomnessCache = new Map<string, CachedRandomness>();
const PHASE_NONE = 0;
const PHASE_PLAYER_TURN = 2;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type BlackjackActionName = 'deal' | 'hit' | 'stand' | 'double' | 'split' | 'surrender';
const BLACKJACK_ACTIONS = new Set<BlackjackActionName>(['deal', 'hit', 'stand', 'double', 'split', 'surrender']);

function isBlackjackActionName(value: UntypedValue): value is BlackjackActionName {
    return typeof value === 'string' && BLACKJACK_ACTIONS.has(value as BlackjackActionName);
}

function getActionLockKey(landId: string, nonce: bigint): string {
    return `${ACTION_LOCK_KEY_PREFIX}${landId}:${nonce.toString()}`;
}

function isCachedRandomness(value: UntypedValue): value is CachedRandomness {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<CachedRandomness>;
    return (
        typeof candidate.randomSeed === 'string' &&
        candidate.randomSeed.startsWith('0x') &&
        typeof candidate.signature === 'string' &&
        typeof candidate.timestamp === 'number' &&
        typeof candidate.signerAddress === 'string' &&
        typeof candidate.actionNum === 'number' &&
        typeof candidate.handIndex === 'number' &&
        typeof candidate.bettingToken === 'string' &&
        typeof candidate.playerAddress === 'string' &&
        (
            candidate.betAmountWei === undefined ||
            candidate.betAmountWei === null ||
            typeof candidate.betAmountWei === 'string'
        )
    );
}

function isExpiredActionLock(lock: CachedRandomness): boolean {
    return Date.now() - lock.timestamp > ACTION_LOCK_TTL_SECONDS * 1000;
}

async function readActionLock(lockKey: string): Promise<{ data: CachedRandomness | null; source: 'redis' | 'memory' | 'none' }> {
    if (redis) {
        const redisLock = await redisGetJSON<CachedRandomness>(lockKey);
        if (isCachedRandomness(redisLock)) {
            if (isExpiredActionLock(redisLock)) {
                await redisDel(lockKey);
                return { data: null, source: 'none' };
            }
            return { data: redisLock, source: 'redis' };
        }
    }

    const memoryLock = nonceRandomnessCache.get(lockKey);
    if (isCachedRandomness(memoryLock)) {
        if (isExpiredActionLock(memoryLock)) {
            nonceRandomnessCache.delete(lockKey);
            return { data: null, source: 'none' };
        }
        return { data: memoryLock, source: 'memory' };
    }

    return { data: null, source: 'none' };
}

async function createActionLockIfAbsent(lockKey: string, payload: CachedRandomness): Promise<{ created: boolean; data: CachedRandomness; source: 'redis' | 'memory' }> {
    if (redis) {
        const serialized = JSON.stringify(payload);
        const created = await redisCompareAndSetJSON(lockKey, null, serialized, ACTION_LOCK_TTL_SECONDS);
        if (created) {
            return { created: true, data: payload, source: 'redis' };
        }

        const existing = await redisGetJSON<CachedRandomness>(lockKey);
        if (isCachedRandomness(existing)) {
            return { created: false, data: existing, source: 'redis' };
        }
    }

    const existing = nonceRandomnessCache.get(lockKey);
    if (isCachedRandomness(existing)) {
        return { created: false, data: existing, source: 'memory' };
    }

    nonceRandomnessCache.set(lockKey, payload);
    return { created: true, data: payload, source: 'memory' };
}

async function cleanupConsumedLock(landId: string, currentNonce: bigint): Promise<void> {
    if (currentNonce == BigInt(0)) return;
    const consumedKey = getActionLockKey(landId, currentNonce - BigInt(1));

    if (redis) {
        await redisDel(consumedKey);
    }
    nonceRandomnessCache.delete(consumedKey);
}

function isLockMismatch(
    cached: CachedRandomness,
    actionNum: number,
    handIndexNum: number,
    bettingToken: string,
    playerAddress: string,
    betAmountWei: string | null
): boolean {
    return blackjackRandomnessLockMismatch(
        cached,
        actionNum,
        handIndexNum,
        bettingToken,
        playerAddress,
        betAmountWei
    );
}

async function deleteActionLock(lockKey: string): Promise<void> {
    if (redis) {
        await redisDel(lockKey);
    }
    nonceRandomnessCache.delete(lockKey);
}

function actionNameFromNum(actionNum: number): BlackjackActionName | null {
    switch (actionNum) {
        case 255: return 'deal';
        case 0: return 'hit';
        case 1: return 'stand';
        case 2: return 'double';
        case 3: return 'split';
        case 4: return 'surrender';
        default: return null;
    }
}

async function validateActionAgainstOnchainState(
    publicClient: UntypedValue,
    landIdBigInt: bigint,
    action: BlackjackActionName,
    handIndexNum: number,
    playerAddress?: string,
    bettingToken?: string,
    betAmountWei?: string | null
): Promise<{ allowed: boolean; reason?: string }> {
    const gameBasic = await publicClient.readContract({
        address: LAND_CONTRACT_ADDRESS as `0x${string}`,
        abi: blackjackAbi,
        functionName: 'blackjackGetGameBasic',
        args: [landIdBigInt],
    }) as [boolean, string, number, bigint, number, boolean, number, boolean, bigint, number];

    const gamePlayer = String(gameBasic[1] || '');
    const phase = Number(gameBasic[2]);
    const activeHandCount = Number(gameBasic[4]);

    if (
        playerAddress &&
        gamePlayer &&
        gamePlayer.toLowerCase() !== ZERO_ADDRESS &&
        gamePlayer.toLowerCase() !== playerAddress.toLowerCase()
    ) {
        return { allowed: false, reason: 'Not your game' };
    }

    if (action === 'deal') {
        if (phase !== PHASE_NONE) {
            return { allowed: false, reason: 'Game already in progress' };
        }
        if (!playerAddress) {
            return { allowed: false, reason: 'playerAddress is required for deal' };
        }
        const [landOwner, approvedAddress] = await Promise.all([
            publicClient.readContract({
                address: LAND_CONTRACT_ADDRESS as `0x${string}`,
                abi: landAbi,
                functionName: 'ownerOf',
                args: [landIdBigInt],
            }) as Promise<string>,
            publicClient.readContract({
                address: LAND_CONTRACT_ADDRESS as `0x${string}`,
                abi: landAbi,
                functionName: 'getApproved',
                args: [landIdBigInt],
            }).catch(() => ZERO_ADDRESS) as Promise<string>,
        ]);

        if (
            landOwner.toLowerCase() !== playerAddress.toLowerCase() &&
            approvedAddress.toLowerCase() !== playerAddress.toLowerCase()
        ) {
            return { allowed: false, reason: 'Only the land owner or approved wallet can start Blackjack on this land' };
        }
        if (!bettingToken) {
            return { allowed: false, reason: 'Betting token is required for deal' };
        }
        if (!betAmountWei) {
            return { allowed: false, reason: 'Bet amount is required for deal' };
        }

        const tokenConfig = await publicClient.readContract({
            address: LAND_CONTRACT_ADDRESS as `0x${string}`,
            abi: blackjackAbi,
            functionName: 'blackjackGetTokenConfig',
            args: [bettingToken as `0x${string}`],
        }) as [boolean, bigint, bigint, string, boolean, number];

        if (!tokenConfig[0] || !tokenConfig[4]) {
            return { allowed: false, reason: 'Selected token is not enabled for Blackjack' };
        }
        const requestedAmount = BigInt(betAmountWei);
        if (requestedAmount < tokenConfig[1]) {
            return { allowed: false, reason: 'Bet amount is below the Blackjack minimum' };
        }
        if (requestedAmount > tokenConfig[2]) {
            return { allowed: false, reason: 'Bet amount is above the Blackjack maximum' };
        }
        return { allowed: true };
    }

    if (phase !== PHASE_PLAYER_TURN) {
        return {
            allowed: false,
            reason: `Game is not in player turn (phase=${phase}, activeHands=${activeHandCount})`
        };
    }

    if (handIndexNum < 0 || handIndexNum >= activeHandCount) {
        return { allowed: false, reason: 'Invalid hand index for current game state' };
    }

    const actions = await publicClient.readContract({
        address: LAND_CONTRACT_ADDRESS as `0x${string}`,
        abi: blackjackAbi,
        functionName: 'blackjackGetActions',
        args: [landIdBigInt, handIndexNum],
    }) as [boolean, boolean, boolean, boolean, boolean, boolean];

    const canHit = !!actions[0];
    const canStand = !!actions[1];
    const canDouble = !!actions[2];
    const canSplit = !!actions[3];
    const canSurrender = !!actions[4];

    const allowed =
        (action === 'hit' && canHit) ||
        (action === 'stand' && canStand) ||
        (action === 'double' && canDouble) ||
        (action === 'split' && canSplit) ||
        (action === 'surrender' && canSurrender);

    if (!allowed) {
        return { allowed: false, reason: `Action ${action} is not currently available` };
    }

    return { allowed: true };
}

/**
 * Generate cryptographically secure random bytes
 */
function generateRandomSeed(): Hex {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return `0x${Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

/**
 * Rate limit check
 */
function checkRateLimit(key: string): boolean {
    const now = Date.now();
    const normalizedKey = key.toLowerCase();
    const recent = recentRequests.get(normalizedKey);

    if (!recent || (now - recent.timestamp) > RATE_LIMIT_WINDOW_MS) {
        recentRequests.set(normalizedKey, { count: 1, timestamp: now });
        return true;
    }

    if (recent.count >= RATE_LIMIT_MAX_REQUESTS) {
        return false;
    }

    recent.count++;
    return true;
}

function getClientRateLimitKey(request: NextRequest): string | null {
    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const realIp = request.headers.get('x-real-ip')?.trim();
    const ip = forwardedFor || realIp;
    return ip ? `ip:${ip}` : null;
}

/**
 * Clean up old rate limit entries periodically
 */
function cleanupRateLimits() {
    const now = Date.now();
    for (const [address, data] of recentRequests.entries()) {
        if ((now - data.timestamp) > RATE_LIMIT_WINDOW_MS * 2) {
            recentRequests.delete(address);
        }
    }
    for (const [lockKey, data] of nonceRandomnessCache.entries()) {
        if (isExpiredActionLock(data)) {
            nonceRandomnessCache.delete(lockKey);
        }
    }
}

export async function POST(request: NextRequest) {
    try {
        const casinoPolicy = getCasinoPolicy();

        if (!casinoPolicy.casinoEnabled || !casinoPolicy.blackjackEnabled) {
            return NextResponse.json(
                { error: BLACKJACK_DISABLED_MESSAGE },
                { status: 503 }
            );
        }

        if (!casinoPolicy.playable) {
            return NextResponse.json(
                { error: casinoPolicy.message || BLACKJACK_DISABLED_MESSAGE },
                { status: 503 }
            );
        }

        // Validate environment
        if (!SIGNER_PRIVATE_KEY) {
            console.error('BLACKJACK_RANDOMNESS_SIGNER_KEY not configured');
            return NextResponse.json(
                { error: 'Randomness service not configured' },
                { status: 503 }
            );
        }

        if (!redis && !ALLOW_MEMORY_RANDOMNESS_LOCKS) {
            console.error('Redis unavailable - blocking Blackjack randomness in production');
            return NextResponse.json(
                { error: 'Randomness lock service unavailable. Please try again shortly.' },
                { status: 503 }
            );
        }

        // Parse request
        let body: UntypedValue;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        if (!body || typeof body !== 'object') {
            return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
        }

        const { landId, action, playerAddress, handIndex, bettingToken, betAmountWei } = body as Record<string, UntypedValue>;

        // Validate inputs
        if (typeof landId !== 'string' || !/^\d+$/.test(landId)) {
            return NextResponse.json({ error: 'landId must be a decimal string' }, { status: 400 });
        }
        if (!isBlackjackActionName(action)) {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
        if (typeof playerAddress !== 'string' || !isAddress(playerAddress)) {
            return NextResponse.json({ error: 'playerAddress is required' }, { status: 400 });
        }
        const normalizedPlayerAddress = playerAddress.toLowerCase();
        if (handIndex !== undefined && (typeof handIndex !== 'number' || !Number.isInteger(handIndex) || handIndex < 0 || handIndex > 1)) {
            return NextResponse.json({ error: 'Invalid handIndex' }, { status: 400 });
        }
        if (action === 'deal' && (typeof bettingToken !== 'string' || !isAddress(bettingToken))) {
            return NextResponse.json({ error: 'Invalid bettingToken' }, { status: 400 });
        }
        const effectiveBetAmountWei = normalizeBlackjackLockBetAmount(action, betAmountWei);
        if (action === 'deal' && !effectiveBetAmountWei) {
            return NextResponse.json({ error: 'betAmountWei must be a decimal string for deal' }, { status: 400 });
        }

        // Map action string to uint8
        let actionNum: number;
        switch (action) {
            case 'deal': actionNum = 255; break;
            case 'hit': actionNum = 0; break;
            case 'stand': actionNum = 1; break;
            case 'double': actionNum = 2; break;
            case 'split': actionNum = 3; break;
            case 'surrender': actionNum = 4; break;
            default: actionNum = 0;
        }

        const handIndexNum = typeof handIndex === 'number' ? handIndex : 0;

        // Rate limiting by player address and the forwarded client IP when available.
        const rateLimitKeys = [normalizedPlayerAddress, getClientRateLimitKey(request)].filter((key): key is string => Boolean(key));
        for (const key of rateLimitKeys) {
            if (!checkRateLimit(key)) {
                return NextResponse.json(
                    { error: 'Rate limit exceeded. Please wait before making more requests.' },
                    { status: 429 }
                );
            }
        }

        // Clean up old entries
        cleanupRateLimits();

        // Use the shared resilient RPC transport (same endpoint set/fallback strategy
        // as the rest of the app) instead of a single hardcoded public RPC.
        const publicClient = getBaseReadClient();

        // Get current nonce from contract
        let currentNonce: bigint;
        try {
            currentNonce = await publicClient.readContract({
                address: LAND_CONTRACT_ADDRESS as `0x${string}`,
                abi: blackjackAbi,
                functionName: 'blackjackGetNonce',
                args: [BigInt(landId)],
            }) as bigint;
        } catch (err) {
            console.error('Failed to read nonce from contract:', err);
            return NextResponse.json(
                { error: 'Failed to read game state' },
                { status: 500 }
            );
        }

        let effectiveBettingToken = '';
        if (action === 'deal') {
            effectiveBettingToken = bettingToken as string;
        } else {
            try {
                effectiveBettingToken = await publicClient.readContract({
                    address: LAND_CONTRACT_ADDRESS as `0x${string}`,
                    abi: blackjackAbi,
                    functionName: 'blackjackGetGameToken',
                    args: [BigInt(landId)],
                }) as string;
            } catch (err) {
                console.error('Failed to read active blackjack token from contract:', err);
                return NextResponse.json(
                    { error: 'Failed to read active game token' },
                    { status: 500 }
                );
            }
        }

        const landIdBigInt = BigInt(landId);
        const requestedActionValidation = await validateActionAgainstOnchainState(
            publicClient,
            landIdBigInt,
            action as BlackjackActionName,
            handIndexNum,
            normalizedPlayerAddress,
            effectiveBettingToken,
            effectiveBetAmountWei
        );
        if (!requestedActionValidation.allowed) {
            return NextResponse.json(
                { error: requestedActionValidation.reason || 'Action not available' },
                { status: 400 }
            );
        }

        // Best-effort cleanup: previous nonce lock is no longer usable after onchain increment.
        await cleanupConsumedLock(landId, currentNonce);
        const nonce = Number(currentNonce);
        const lockKey = getActionLockKey(landId, currentNonce);

        // ANTI-CHEAT: Check if randomness was already issued for this (landId, nonce)
        const { data: cachedData, source: cachedSource } = await readActionLock(lockKey);
        let effectiveCachedData = cachedData;
        let effectiveCachedSource = cachedSource;

        if (effectiveCachedData && isLockMismatch(effectiveCachedData, actionNum, handIndexNum, effectiveBettingToken, normalizedPlayerAddress, effectiveBetAmountWei)) {
            const lockedActionName = actionNameFromNum(effectiveCachedData.actionNum);
            if (!lockedActionName) {
                await deleteActionLock(lockKey);
                effectiveCachedData = null;
                effectiveCachedSource = 'none';
            } else {
                const lockedActionValidation = await validateActionAgainstOnchainState(
                    publicClient,
                    landIdBigInt,
                    lockedActionName,
                    effectiveCachedData.handIndex,
                    effectiveCachedData.playerAddress,
                    effectiveCachedData.bettingToken,
                    effectiveCachedData.betAmountWei ?? null
                );

                if (!lockedActionValidation.allowed) {
                    // Recovery path: stale/invalid lock cannot be executed onchain, clear it.
                    await deleteActionLock(lockKey);
                    effectiveCachedData = null;
                    effectiveCachedSource = 'none';
                } else {
                    console.warn(`[Blackjack Locked Action] landId=${landId} nonce=${nonce} cachedAction=${effectiveCachedData.actionNum} requestedAction=${actionNum} cachedToken=${effectiveCachedData.bettingToken} requestedToken=${effectiveBettingToken} cachedAmount=${effectiveCachedData.betAmountWei ?? 'none'} requestedAmount=${effectiveBetAmountWei ?? 'none'}`);
                    return NextResponse.json(
                        { error: 'Action locked. Retry the same Blackjack action and bet amount, or wait briefly for the previous preparation to expire.' },
                        { status: 400 }
                    );
                }
            }
        }

        if (effectiveCachedData) {
            // STRICT ACTION LOCKING: Check if user is trying to switch action
            if (isLockMismatch(effectiveCachedData, actionNum, handIndexNum, effectiveBettingToken, normalizedPlayerAddress, effectiveBetAmountWei)) {
                console.warn(`[Blackjack Locked Action] landId=${landId} nonce=${nonce} cachedAction=${effectiveCachedData.actionNum} requestedAction=${actionNum} cachedToken=${effectiveCachedData.bettingToken} requestedToken=${effectiveBettingToken} cachedAmount=${effectiveCachedData.betAmountWei ?? 'none'} requestedAmount=${effectiveBetAmountWei ?? 'none'}`);
                return NextResponse.json(
                    { error: 'Action locked. Retry the same Blackjack action and bet amount, or wait briefly for the previous preparation to expire.' },
                    { status: 400 }
                );
            }

            // Return the SAME randomness - prevents shopping for favorable outcomes
            console.log(`[Blackjack Random] CACHE HIT - landId=${landId} action=${action}(${actionNum}) hand=${handIndexNum} nonce=${nonce} token=${effectiveCachedData.bettingToken} source=${effectiveCachedSource} amount=${effectiveCachedData.betAmountWei ?? 'none'}`);

            return NextResponse.json({
                randomSeed: effectiveCachedData.randomSeed,
                nonce,
                signature: effectiveCachedData.signature,
                expiresAt: Math.floor(Date.now() / 1000) + 60,
                signerAddress: effectiveCachedData.signerAddress,
                bettingToken: effectiveCachedData.bettingToken,
                lockedBetAmountWei: effectiveCachedData.betAmountWei,
                cached: true, // Flag for debugging
                source: effectiveCachedSource,
            });
        }

        // Generate NEW cryptographically secure randomness
        const randomSeed = generateRandomSeed();

        // Current Solidity only verifies this legacy payload. The app/API lock also
        // binds deal amount and API expiry until a future contract upgrade can do it onchain.
        const messageHash = keccak256(
            encodePacked(
                ['uint256', 'uint256', 'bytes32', 'uint8', 'uint8', 'address'],
                [BigInt(landId), currentNonce, randomSeed, actionNum, handIndexNum, effectiveBettingToken as `0x${string}`]
            )
        );

        // Sign the message with EIP-191 prefix
        const account = privateKeyToAccount(SIGNER_PRIVATE_KEY as `0x${string}`);
        const signature = await signMessage({
            message: { raw: messageHash },
            privateKey: SIGNER_PRIVATE_KEY as `0x${string}`,
        });

        // ANTI-CHEAT: Lock randomness + action/hand for this (landId, nonce)
        const proposedLock: CachedRandomness = {
            randomSeed,
            signature,
            timestamp: Date.now(),
            signerAddress: account.address,
            actionNum,   // Store locked action
            handIndex: handIndexNum,
            bettingToken: effectiveBettingToken,
            playerAddress: normalizedPlayerAddress,
            betAmountWei: effectiveBetAmountWei
        };
        const lockResult = await createActionLockIfAbsent(lockKey, proposedLock);

        if (!lockResult.created) {
            // Another request won the race. Enforce action lock against stored decision.
            if (isLockMismatch(lockResult.data, actionNum, handIndexNum, effectiveBettingToken, normalizedPlayerAddress, effectiveBetAmountWei)) {
                console.warn(`[Blackjack Locked Action] landId=${landId} nonce=${nonce} cachedAction=${lockResult.data.actionNum} requestedAction=${actionNum} cachedToken=${lockResult.data.bettingToken} requestedToken=${effectiveBettingToken} cachedAmount=${lockResult.data.betAmountWei ?? 'none'} requestedAmount=${effectiveBetAmountWei ?? 'none'}`);
                return NextResponse.json(
                    { error: 'Action locked. Retry the same Blackjack action and bet amount, or wait briefly for the previous preparation to expire.' },
                    { status: 400 }
                );
            }

            return NextResponse.json({
                randomSeed: lockResult.data.randomSeed,
                nonce,
                signature: lockResult.data.signature,
                expiresAt: Math.floor(Date.now() / 1000) + 60,
                signerAddress: lockResult.data.signerAddress,
                bettingToken: lockResult.data.bettingToken,
                lockedBetAmountWei: lockResult.data.betAmountWei,
                cached: true,
                source: lockResult.source,
            });
        }

        // Client-facing API lock expiry. The current contract signature has no expiry field.
        const expiresAt = Math.floor(Date.now() / 1000) + 60;

        // Log for auditing
        console.log(`[Blackjack Random] NEW - landId=${landId} action=${action}(${actionNum}) hand=${handIndexNum} nonce=${nonce} token=${effectiveBettingToken} source=${lockResult.source} amount=${effectiveBetAmountWei ?? 'none'}`);

        return NextResponse.json({
            randomSeed,
            nonce,
            signature,
            expiresAt,
            signerAddress: account.address,
            bettingToken: effectiveBettingToken,
            lockedBetAmountWei: effectiveBetAmountWei,
            cached: false,
            source: lockResult.source,
        });

    } catch (error) {
        console.error('Blackjack random API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

/**
 * GET endpoint to check service status and get signer address
 */
export async function GET() {
    if (!SIGNER_PRIVATE_KEY) {
        return NextResponse.json({
            status: 'unavailable',
            message: 'Randomness service not configured',
        }, { status: 503 });
    }

    if (!redis && !ALLOW_MEMORY_RANDOMNESS_LOCKS) {
        return NextResponse.json({
            status: 'unavailable',
            message: 'Randomness lock service unavailable',
            lockStore: 'unavailable',
        }, { status: 503 });
    }

    try {
        const account = privateKeyToAccount(SIGNER_PRIVATE_KEY as `0x${string}`);
        return NextResponse.json({
            status: 'available',
            signerAddress: account.address,
            cacheSize: nonceRandomnessCache.size, // In-memory fallback cache size
            lockStore: redis ? 'redis' : ALLOW_MEMORY_RANDOMNESS_LOCKS ? 'memory' : 'unavailable',
        });
    } catch {
        return NextResponse.json({
            status: 'error',
            message: 'Invalid signer configuration',
        }, { status: 500 });
    }
}
