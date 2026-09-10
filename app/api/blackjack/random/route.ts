import { getBaseReadClient } from '@/lib/base-rpc';
import { getCasinoPolicy,isLegacyBlackjackContractAcknowledged } from '@/lib/casino-feature';
import { BLACKJACK_DISABLED_MESSAGE } from '@/lib/casino-policy';
import {
    ChatAuthError,
    createChatAuthErrorResponse,
    createChatAuthRequiredResponse,
    getChatSessionOrQuickAuthFromRequest,
} from '@/lib/chat-auth';
import { blackjackRandomnessLockMismatch,normalizeBlackjackLockBetAmount } from '@/lib/blackjack-randomness-lock.mjs';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { redis, redisDel } from '@/lib/redis';
import { blackjackActionLockKey, blackjackQuarantineKey, blackjackMessageHash, isBlackjackLock, parseCanonicalBlackjackLandId, verifyBlackjackLock, BlackjackLockServiceError, BLACKJACK_INVENTORY_KEY, type BlackjackLock } from '@/lib/blackjack-locks';
import { createBlackjackRedisStore, requireBlackjackInventory } from '@/lib/blackjack-lock-store';
import { incrementBlackjackLockCounter } from '@/lib/blackjack-lock-metrics';
import { blackjackAbi } from '@/public/abi/blackjack-abi';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { NextRequest,NextResponse } from 'next/server';
import { isAddress, type Address, type Hex } from 'viem';
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
const ALLOW_MEMORY_RANDOMNESS_LOCKS = process.env.NODE_ENV !== 'production';

type CachedRandomness = BlackjackLock;
const nonceRandomnessCache = new Map<string, CachedRandomness>();
const PHASE_NONE = 0;
const PHASE_PLAYER_TURN = 2;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const CANONICAL_SIGNER_ROLLOUT_ID = process.env.BLACKJACK_CANONICAL_SIGNER_ROLLOUT_ID || '';

type BlackjackActionName = 'deal' | 'hit' | 'stand' | 'double' | 'split' | 'surrender';
const BLACKJACK_ACTIONS = new Set<BlackjackActionName>(['deal', 'hit', 'stand', 'double', 'split', 'surrender']);

function isBlackjackActionName(value: UntypedValue): value is BlackjackActionName {
    return typeof value === 'string' && BLACKJACK_ACTIONS.has(value as BlackjackActionName);
}

async function readActionLock(landId: bigint, nonce: bigint, signer: Address): Promise<{ data: CachedRandomness | null; source: 'redis' | 'memory' | 'none'; inventoryRaw?: string }> {
    const lockKey = blackjackActionLockKey(landId, nonce);
    if (redis) {
        const store = createBlackjackRedisStore();
        const inventoryRaw = await requireBlackjackInventory(store, signer, CANONICAL_SIGNER_ROLLOUT_ID);
        if (await store.read(blackjackQuarantineKey(landId, nonce)) !== null) throw new BlackjackLockServiceError('quarantined');
        const raw = await store.read(lockKey);
        if (raw === null) return { data: null, source: 'none', inventoryRaw };
        let value: unknown;
        try { value = JSON.parse(raw); } catch { throw new BlackjackLockServiceError('invalid'); }
        if (!isBlackjackLock(value) || !await verifyBlackjackLock(landId, nonce, value, signer)) throw new BlackjackLockServiceError('invalid');
        return { data: value, source: 'redis', inventoryRaw };
    }
    if (!ALLOW_MEMORY_RANDOMNESS_LOCKS) throw new BlackjackLockServiceError('unavailable');
    const data = nonceRandomnessCache.get(lockKey) ?? null;
    return { data, source: data ? 'memory' : 'none' };
}

async function createActionLockIfAbsent(landId: bigint, nonce: bigint, payload: CachedRandomness, inventoryRaw?: string): Promise<{ created: boolean; data: CachedRandomness; source: 'redis' | 'memory' }> {
    const lockKey = blackjackActionLockKey(landId, nonce);
    if (redis) {
        if (!inventoryRaw) throw new BlackjackLockServiceError('inventory_required');
        const store = createBlackjackRedisStore();
        // One atomic persistent SET, guarded by the inventory and quarantine state.
        // No expiry: the deployed signature is valid for the full nonce lifetime.
        const created = await store.guardedWrite(lockKey, null, JSON.stringify(payload), [
            [BLACKJACK_INVENTORY_KEY, inventoryRaw],
            [blackjackQuarantineKey(landId, nonce), null],
        ]);
        if (created) return { created: true, data: payload, source: 'redis' };
        const winner = await readActionLock(landId, nonce, payload.signerAddress as Address);
        if (winner.data) return { created: false, data: winner.data, source: 'redis' };
        throw new BlackjackLockServiceError('unavailable');
    }
    if (!ALLOW_MEMORY_RANDOMNESS_LOCKS) throw new BlackjackLockServiceError('unavailable');
    const existing = nonceRandomnessCache.get(lockKey);
    if (existing) return { created: false, data: existing, source: 'memory' };
    nonceRandomnessCache.set(lockKey, payload);
    return { created: true, data: payload, source: 'memory' };
}

async function cleanupConsumedLock(landId: bigint, confirmedNonce: bigint): Promise<void> {
    if (confirmedNonce === BigInt(0)) return;
    const consumedKey = blackjackActionLockKey(landId, confirmedNonce - BigInt(1));
    if (redis) {
        await redisDel(consumedKey);
        await redisDel(blackjackQuarantineKey(landId, confirmedNonce - BigInt(1)));
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
}

export async function POST(request: NextRequest) {
    try {
        const casinoPolicy = getCasinoPolicy();

        if (
            !casinoPolicy.casinoEnabled ||
            !casinoPolicy.blackjackEnabled ||
            !isLegacyBlackjackContractAcknowledged()
        ) {
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
        const landIdBigInt = parseCanonicalBlackjackLandId(landId);
        if (landIdBigInt === null) {
            return NextResponse.json({ error: 'landId must be a canonical uint256 decimal string' }, { status: 400 });
        }
        if (!isBlackjackActionName(action)) {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
        if (typeof playerAddress !== 'string' || !isAddress(playerAddress)) {
            return NextResponse.json({ error: 'playerAddress is required' }, { status: 400 });
        }
        const normalizedPlayerAddress = playerAddress.toLowerCase();

        const { session, sessionId } = await getChatSessionOrQuickAuthFromRequest(request);
        if (!session) {
            return createChatAuthRequiredResponse({
                clearCookie: Boolean(sessionId),
                message: 'Authentication is required to prepare Blackjack randomness.',
            });
        }
        if (session.address.toLowerCase() !== normalizedPlayerAddress) {
            return NextResponse.json(
                { error: 'Authenticated wallet does not match the Blackjack player.' },
                { status: 403 },
            );
        }
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
                args: [landIdBigInt],
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
                    args: [landIdBigInt],
                }) as string;
            } catch (err) {
                console.error('Failed to read active blackjack token from contract:', err);
                return NextResponse.json(
                    { error: 'Failed to read active game token' },
                    { status: 500 }
                );
            }
        }

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

        // Cleanup requires a safe onchain nonce; an unconfirmed head must not erase a decision.
        try {
            const confirmedNonce = await publicClient.readContract({
                address: LAND_CONTRACT_ADDRESS as Address,
                abi: blackjackAbi,
                functionName: 'blackjackGetNonce',
                args: [landIdBigInt],
                blockTag: 'safe',
            });
            await cleanupConsumedLock(landIdBigInt, confirmedNonce);
        } catch { /* Cleanup can wait; issuing or retaining the current lock does not depend on it. */ }
        const nonce = currentNonce.toString();
        const account = privateKeyToAccount(SIGNER_PRIVATE_KEY as Hex);
        const { data: effectiveCachedData, source: effectiveCachedSource, inventoryRaw } = await readActionLock(landIdBigInt, currentNonce, account.address);

        if (effectiveCachedData) {
            // STRICT ACTION LOCKING: Check if user is trying to switch action
            if (isLockMismatch(effectiveCachedData, actionNum, handIndexNum, effectiveBettingToken, normalizedPlayerAddress, effectiveBetAmountWei)) {
                console.warn(`[Blackjack Locked Action] landId=${landId} nonce=${nonce} cachedAction=${effectiveCachedData.actionNum} requestedAction=${actionNum} cachedToken=${effectiveCachedData.bettingToken} requestedToken=${effectiveBettingToken} cachedAmount=${effectiveCachedData.betAmountWei ?? 'none'} requestedAmount=${effectiveBetAmountWei ?? 'none'}`);
                return NextResponse.json(
                    { error: 'Action locked. Retry the same Blackjack action and bet amount. This decision remains locked until the onchain nonce advances.' },
                    { status: 400 }
                );
            }

            // Return the SAME randomness - prevents shopping for favorable outcomes
            console.log(`[Blackjack Random] CACHE HIT - landId=${landId} action=${action}(${actionNum}) hand=${handIndexNum} nonce=${nonce} token=${effectiveCachedData.bettingToken} source=${effectiveCachedSource} amount=${effectiveCachedData.betAmountWei ?? 'none'}`);

            return NextResponse.json({
                randomSeed: effectiveCachedData.randomSeed,
                nonce,
                signature: effectiveCachedData.signature,
                expiresAt: Math.floor(Date.now() / 1000) + RANDOMNESS_LIFETIME_SECONDS,
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
        // binds deal amount. API freshness is not a contract signature expiry.
        const messageHash = blackjackMessageHash(landIdBigInt, currentNonce, {
            randomSeed, actionNum, handIndex: handIndexNum, bettingToken: effectiveBettingToken,
        });

        // Sign the message with EIP-191 prefix
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
        const lockResult = await createActionLockIfAbsent(landIdBigInt, currentNonce, proposedLock, inventoryRaw);

        if (!lockResult.created) {
            // Another request won the race. Enforce action lock against stored decision.
            if (isLockMismatch(lockResult.data, actionNum, handIndexNum, effectiveBettingToken, normalizedPlayerAddress, effectiveBetAmountWei)) {
                console.warn(`[Blackjack Locked Action] landId=${landId} nonce=${nonce} cachedAction=${lockResult.data.actionNum} requestedAction=${actionNum} cachedToken=${lockResult.data.bettingToken} requestedToken=${effectiveBettingToken} cachedAmount=${lockResult.data.betAmountWei ?? 'none'} requestedAmount=${effectiveBetAmountWei ?? 'none'}`);
                return NextResponse.json(
                    { error: 'Action locked. Retry the same Blackjack action and bet amount. This decision remains locked until the onchain nonce advances.' },
                    { status: 400 }
                );
            }

            return NextResponse.json({
                randomSeed: lockResult.data.randomSeed,
                nonce,
                signature: lockResult.data.signature,
                expiresAt: Math.floor(Date.now() / 1000) + RANDOMNESS_LIFETIME_SECONDS,
                signerAddress: lockResult.data.signerAddress,
                bettingToken: lockResult.data.bettingToken,
                lockedBetAmountWei: lockResult.data.betAmountWei,
                cached: true,
                source: lockResult.source,
            });
        }

        // Client-facing API lock expiry. The current contract signature has no expiry field.
        const expiresAt = Math.floor(Date.now() / 1000) + RANDOMNESS_LIFETIME_SECONDS;

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
        if (error instanceof BlackjackLockServiceError) {
            incrementBlackjackLockCounter(error.reason === 'quarantined' ? 'issuance_quarantined' : error.reason === 'invalid' ? 'invalid_record' : error.reason);
            // Bounded labels only: no signatures, seeds, or raw provider errors.
            console.warn('[Blackjack lock]', { category: error.reason });
            return NextResponse.json({ error: error.message, recoveryState: error.reason }, { status: 503 });
        }
        if (error instanceof ChatAuthError) {
            return createChatAuthErrorResponse(error);
        }
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
        if (redis) {
            await requireBlackjackInventory(createBlackjackRedisStore(), account.address, CANONICAL_SIGNER_ROLLOUT_ID);
        }
        return NextResponse.json({
            status: 'available',
            signerAddress: account.address,
            cacheSize: nonceRandomnessCache.size, // In-memory fallback cache size
            lockStore: redis ? 'redis' : ALLOW_MEMORY_RANDOMNESS_LOCKS ? 'memory' : 'unavailable',
        });
    } catch (error) {
        if (error instanceof BlackjackLockServiceError) {
            incrementBlackjackLockCounter(error.reason === 'quarantined' ? 'issuance_quarantined' : error.reason === 'invalid' ? 'invalid_record' : error.reason);
            return NextResponse.json({ status: 'unavailable', recoveryState: error.reason, message: error.message }, { status: 503 });
        }
        return NextResponse.json({
            status: 'error',
            message: 'Invalid signer configuration',
        }, { status: 500 });
    }
}
