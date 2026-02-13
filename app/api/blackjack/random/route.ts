import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, keccak256, encodePacked, type Hex } from 'viem';
import { privateKeyToAccount, signMessage } from 'viem/accounts';
import { base } from 'viem/chains';
import { blackjackAbi } from '@/public/abi/blackjack-abi';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { redis, redisCompareAndSetJSON, redisDel, redisGetJSON } from '@/lib/redis';

/**
 * Server-Signed Randomness API for Blackjack
 * 
 * This endpoint generates cryptographically secure random seeds and signs them
 * for use in the smart contract. This allows single-transaction gameplay.
 * 
 * ANTI-CHEAT: Once randomness is issued for a (landId, nonce), the same randomness
 * is returned for all subsequent requests until the nonce is consumed on-chain.
 * This prevents users from "shopping" for favorable outcomes by canceling and retrying.
 */

// Get the signer private key from environment
const SIGNER_PRIVATE_KEY = process.env.BLACKJACK_RANDOMNESS_SIGNER_KEY;

// Rate limiting: track recent requests per address
const recentRequests = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // Max 30 requests per minute per address

interface CachedRandomness {
    randomSeed: Hex;
    signature: string;
    timestamp: number;
    signerAddress: string;
    actionNum: number;
    handIndex: number;
}

const ACTION_LOCK_KEY_PREFIX = 'blackjack:action-lock:';
const nonceRandomnessCache = new Map<string, CachedRandomness>();

function getActionLockKey(landId: string, nonce: bigint): string {
    return `${ACTION_LOCK_KEY_PREFIX}${landId}:${nonce.toString()}`;
}

function isCachedRandomness(value: unknown): value is CachedRandomness {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<CachedRandomness>;
    return (
        typeof candidate.randomSeed === 'string' &&
        candidate.randomSeed.startsWith('0x') &&
        typeof candidate.signature === 'string' &&
        typeof candidate.timestamp === 'number' &&
        typeof candidate.signerAddress === 'string' &&
        typeof candidate.actionNum === 'number' &&
        typeof candidate.handIndex === 'number'
    );
}

async function readActionLock(lockKey: string): Promise<{ data: CachedRandomness | null; source: 'redis' | 'memory' | 'none' }> {
    if (redis) {
        const redisLock = await redisGetJSON<CachedRandomness>(lockKey);
        if (isCachedRandomness(redisLock)) {
            return { data: redisLock, source: 'redis' };
        }
    }

    const memoryLock = nonceRandomnessCache.get(lockKey);
    if (isCachedRandomness(memoryLock)) {
        return { data: memoryLock, source: 'memory' };
    }

    return { data: null, source: 'none' };
}

async function createActionLockIfAbsent(lockKey: string, payload: CachedRandomness): Promise<{ created: boolean; data: CachedRandomness; source: 'redis' | 'memory' }> {
    if (redis) {
        const serialized = JSON.stringify(payload);
        const created = await redisCompareAndSetJSON(lockKey, null, serialized);
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

function isActionMismatch(cached: CachedRandomness, actionNum: number, handIndexNum: number): boolean {
    return cached.actionNum !== actionNum || cached.handIndex !== handIndexNum;
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
function checkRateLimit(address: string): boolean {
    const now = Date.now();
    const recent = recentRequests.get(address.toLowerCase());

    if (!recent || (now - recent.timestamp) > RATE_LIMIT_WINDOW_MS) {
        recentRequests.set(address.toLowerCase(), { count: 1, timestamp: now });
        return true;
    }

    if (recent.count >= RATE_LIMIT_MAX_REQUESTS) {
        return false;
    }

    recent.count++;
    return true;
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
        // Validate environment
        if (!SIGNER_PRIVATE_KEY) {
            console.error('BLACKJACK_RANDOMNESS_SIGNER_KEY not configured');
            return NextResponse.json(
                { error: 'Randomness service not configured' },
                { status: 503 }
            );
        }

        // Parse request
        const body = await request.json();
        const { landId, action, playerAddress, handIndex } = body;

        // Validate inputs
        if (!landId || typeof landId !== 'string') {
            return NextResponse.json({ error: 'landId is required' }, { status: 400 });
        }
        if (!action || !['deal', 'hit', 'stand', 'double', 'split', 'surrender'].includes(action)) {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
        if (handIndex !== undefined && (!Number.isInteger(handIndex) || handIndex < 0 || handIndex > 1)) {
            return NextResponse.json({ error: 'Invalid handIndex' }, { status: 400 });
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

        // Rate limiting by player address (if provided)
        if (playerAddress) {
            if (!checkRateLimit(playerAddress)) {
                return NextResponse.json(
                    { error: 'Rate limit exceeded. Please wait before making more requests.' },
                    { status: 429 }
                );
            }
        }

        // Clean up old entries
        cleanupRateLimits();

        // Create public client to read nonce
        const publicClient = createPublicClient({
            chain: base,
            transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
        });

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

        // Best-effort cleanup: previous nonce lock is no longer usable after on-chain increment.
        await cleanupConsumedLock(landId, currentNonce);
        const nonce = Number(currentNonce);
        const lockKey = getActionLockKey(landId, currentNonce);

        // ANTI-CHEAT: Check if randomness was already issued for this (landId, nonce)
        const { data: cachedData, source: cachedSource } = await readActionLock(lockKey);
        if (cachedData) {
            // STRICT ACTION LOCKING: Check if user is trying to switch action
            if (isActionMismatch(cachedData, actionNum, handIndexNum)) {
                console.warn(`[Blackjack Cheat Attempt] landId=${landId} nonce=${nonce} cached=${cachedData.actionNum} requested=${actionNum}`);
                return NextResponse.json(
                    { error: 'Action Locked: You cannot change your decision for this turn.' },
                    { status: 400 }
                );
            }

            // Return the SAME randomness - prevents shopping for favorable outcomes
            console.log(`[Blackjack Random] CACHE HIT - landId=${landId} nonce=${nonce} source=${cachedSource} (same randomness returned)`);

            return NextResponse.json({
                randomSeed: cachedData.randomSeed,
                nonce,
                signature: cachedData.signature,
                expiresAt: Math.floor(Date.now() / 1000) + 60,
                signerAddress: cachedData.signerAddress,
                cached: true, // Flag for debugging
                source: cachedSource,
            });
        }

        // Generate NEW cryptographically secure randomness
        const randomSeed = generateRandomSeed();

        // Create the message hash including action and handIndex
        const messageHash = keccak256(
            encodePacked(
                ['uint256', 'uint256', 'bytes32', 'uint8', 'uint8'],
                [BigInt(landId), currentNonce, randomSeed, actionNum, handIndexNum]
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
            handIndex: handIndexNum
        };
        const lockResult = await createActionLockIfAbsent(lockKey, proposedLock);

        if (!lockResult.created) {
            // Another request won the race. Enforce action lock against stored decision.
            if (isActionMismatch(lockResult.data, actionNum, handIndexNum)) {
                console.warn(`[Blackjack Cheat Attempt] landId=${landId} nonce=${nonce} cached=${lockResult.data.actionNum} requested=${actionNum}`);
                return NextResponse.json(
                    { error: 'Action Locked: You cannot change your decision for this turn.' },
                    { status: 400 }
                );
            }

            return NextResponse.json({
                randomSeed: lockResult.data.randomSeed,
                nonce,
                signature: lockResult.data.signature,
                expiresAt: Math.floor(Date.now() / 1000) + 60,
                signerAddress: lockResult.data.signerAddress,
                cached: true,
                source: lockResult.source,
            });
        }

        // Set expiry (signature valid for 60 seconds)
        const expiresAt = Math.floor(Date.now() / 1000) + 60;

        // Log for auditing
        console.log(`[Blackjack Random] NEW - landId=${landId} action=${action}(${actionNum}) hand=${handIndexNum} nonce=${nonce} source=${lockResult.source} seed=${randomSeed.slice(0, 10)}...`);

        return NextResponse.json({
            randomSeed,
            nonce,
            signature,
            expiresAt,
            signerAddress: account.address,
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

    try {
        const account = privateKeyToAccount(SIGNER_PRIVATE_KEY as `0x${string}`);
        return NextResponse.json({
            status: 'available',
            signerAddress: account.address,
            cacheSize: nonceRandomnessCache.size, // In-memory fallback cache size
            lockStore: redis ? 'redis' : 'memory',
        });
    } catch (err) {
        return NextResponse.json({
            status: 'error',
            message: 'Invalid signer configuration',
        }, { status: 500 });
    }
}

