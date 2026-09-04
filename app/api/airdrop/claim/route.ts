import { getBaseReadClient, getBaseTransactionReceipt } from '@/lib/base-rpc';
import {
    canRetryAirdropReservation,
    createAirdropReservation,
    getAirdropRecordStatus,
    parseAirdropEligibility,
    type AirdropEligibilityRecord,
} from '@/lib/airdrop-claim-state';
import {
    getAirdropOperationOutcome,
    isAirdropTransactionHash,
    isAirdropUserOperationHash,
} from '@/lib/airdrop-claim-reconciliation';
import { redis, redisCompareAndSetJSONRaw } from '@/lib/redis';
import { CdpClient } from '@coinbase/cdp-sdk';
import { NextRequest,NextResponse } from 'next/server';
import { encodeFunctionData,parseUnits } from 'viem';

// Create public client for signature verification (supports ERC-1271)
const publicClient = getBaseReadClient();

// Token addresses
const AIRDROP_TOKENS = {
    SEED: '0x546D239032b24eCEEE0cb05c92FC39090846adc7' as `0x${string}`,
    LEAF: '0xE78ee52349D7b031E2A6633E07c037C3147DB116' as `0x${string}`,
    PIXOTCHI: '0xa2ef17bb7eea1143196678337069dfa24d37d2ac' as `0x${string}`,
} as const;

// ERC20 Transfer ABI
const ERC20_TRANSFER_ABI = [{
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
}] as const;

// CDP Client singleton
let cdp: CdpClient | null = null;
function getClient() {
    if (!cdp) {
        cdp = new CdpClient();
    }
    return cdp;
}

// Agent smart account cache
let agentSmartAccount: UntypedValue = null;

const CLAIM_LOCK_PREFIX = 'airdrop:lock:';
const CLAIM_RESERVATION_TTL_MS = 15 * 60 * 1000;

function getClaimedResponse(record: AirdropEligibilityRecord) {
    return NextResponse.json({
        success: true,
        alreadyClaimed: true,
        status: 'claimed',
        txHash: record.txHash ?? null,
        seed: record.seed || '0',
        leaf: record.leaf || '0',
        pixotchi: record.pixotchi || '0',
    });
}

function parseAllocationAmount(value: string | undefined): bigint | null {
    const normalized = value?.trim() || '0';
    if (!/^\d+(?:\.\d{1,18})?$/.test(normalized)) return null;

    try {
        return parseUnits(normalized, 18);
    } catch {
        return null;
    }
}

async function compareAndSetEligibility(
    key: string,
    expectedRaw: string,
    next: AirdropEligibilityRecord,
): Promise<boolean> {
    return redisCompareAndSetJSONRaw(key, expectedRaw, JSON.stringify(next));
}

/**
 * Claim/status reconciliation can both observe a submitted operation. Never
 * replace a newer record with an older request's view: in particular, a slow
 * POST must not turn a canonically claimed record back into pending or failed.
 */
async function persistExpectedEligibilityTransition(
    key: string,
    expectedRaw: string,
    next: AirdropEligibilityRecord,
): Promise<string> {
    const nextRaw = JSON.stringify(next);
    if (await redisCompareAndSetJSONRaw(key, expectedRaw, nextRaw)) {
        return nextRaw;
    }

    const latestRaw = await redis?.get(key);
    const latestRecord = latestRaw ? parseAirdropEligibility(latestRaw) : null;
    const error = new Error('Claim state changed while the operation was being confirmed') as Error & {
        latestRecord?: AirdropEligibilityRecord | null;
    };
    error.latestRecord = latestRecord;
    throw error;
}

async function incrementClaimedCountOnce(): Promise<void> {
    const metaRaw = await redis?.get('airdrop:meta');
    if (!metaRaw) return;

    try {
        const meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
        meta.claimedCount = (meta.claimedCount || 0) + 1;
        await redis?.set('airdrop:meta', JSON.stringify(meta));
    } catch { }
}

/**
 * Generate the message that user must sign to claim airdrop
 * This ensures user owns the wallet they are claiming for
 */
function getClaimMessage(address: string, timestamp: number): string {
    return `Claim Pixotchi Airdrop\n\nWallet: ${address.toLowerCase()}\nTimestamp: ${timestamp}\n\nBy signing this message, you confirm ownership of this wallet and request to claim your airdrop allocation.`;
}

/**
 * POST /api/airdrop/claim
 * Claim airdrop tokens for connected wallet
 * 
 * Required body:
 * - userAddress: The wallet address claiming the airdrop
 * - signature: Signature of the claim message
 * - timestamp: Timestamp used in the signed message
 */
export async function POST(req: NextRequest) {
    try {
        if (!redis) {
            return NextResponse.json({ error: 'Claim service unavailable' }, { status: 503 });
        }

        const body = await req.json();
        const { userAddress, signature, timestamp } = body;

        if (!userAddress) {
            return NextResponse.json({ error: 'Missing userAddress' }, { status: 400 });
        }

        if (!signature) {
            return NextResponse.json({ error: 'Missing signature. Please sign the claim message.' }, { status: 400 });
        }

        if (!timestamp) {
            return NextResponse.json({ error: 'Missing timestamp' }, { status: 400 });
        }

        // Validate address format
        if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
            return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
        }

        // Validate timestamp is recent (within 5 minutes)
        const now = Date.now();
        const signedTimestamp = Number(timestamp);
        if (isNaN(signedTimestamp) || Math.abs(now - signedTimestamp) > 5 * 60 * 1000) {
            return NextResponse.json({ error: 'Signature expired. Please sign again.' }, { status: 400 });
        }

        // Verify signature
        const message = getClaimMessage(userAddress, signedTimestamp);
        let isValid = false;
        try {
            isValid = await publicClient.verifyMessage({
                address: userAddress as `0x${string}`,
                message,
                signature: signature as `0x${string}`,
            });
        } catch (verifyError) {
            console.error('[AIRDROP_CLAIM] Signature verification error:', verifyError);
            return NextResponse.json({ error: 'Signature verification temporarily unavailable. Please try again.' }, { status: 503 });
        }

        if (!isValid) {
            return NextResponse.json({ error: 'Invalid signature. Please sign with the correct wallet.' }, { status: 401 });
        }

        console.log(`[AIRDROP_CLAIM] Signature verified for ${userAddress}`);

        const normalizedAddress = userAddress.toLowerCase();
        const eligibilityKey = `airdrop:eligible:${normalizedAddress}`;

        // Check eligibility
        const eligibilityRaw = await redis.get(eligibilityKey);
        if (!eligibilityRaw) {
            return NextResponse.json({ error: 'Not eligible for airdrop' }, { status: 400 });
        }

        const eligibility = parseAirdropEligibility(eligibilityRaw);
        if (!eligibility) {
            return NextResponse.json({ error: 'Invalid eligibility data' }, { status: 500 });
        }

        const currentStatus = getAirdropRecordStatus(eligibility);
        if (currentStatus === 'claimed') {
            return getClaimedResponse(eligibility);
        }
        if (currentStatus === 'pending' && !canRetryAirdropReservation(eligibility)) {
            return NextResponse.json({
                error: 'Claim already in progress. Please wait.',
                status: 'pending',
                attemptId: eligibility.attemptId,
                operationId: eligibility.operationId,
                reservationExpiresAt: eligibility.reservationExpiresAt,
            }, { status: 409 });
        }
        // `failed` is recorded only for an explicit CDP terminal failure or a
        // canonical reverted receipt. Neither can have paid the allocation, so
        // a fresh reservation is safe and receives a new idempotency key.
        // Ambiguous operations remain `pending` and never reach this path.

        // Acquire distributed lock
        const lockKey = `${CLAIM_LOCK_PREFIX}${normalizedAddress}`;
        const acquired = await redis?.set(lockKey, 'locked', { nx: true, ex: 120 });

        if (!acquired) {
            return NextResponse.json({ error: 'Claim in progress. Please wait.' }, { status: 429 });
        }

        try {
            const latestRaw = await redis.get(eligibilityKey);
            if (!latestRaw) {
                return NextResponse.json({ error: 'Not eligible for airdrop' }, { status: 400 });
            }

            const latestEligibility = parseAirdropEligibility(latestRaw);
            if (!latestEligibility) {
                return NextResponse.json({ error: 'Invalid eligibility data' }, { status: 500 });
            }

            const latestStatus = getAirdropRecordStatus(latestEligibility);
            if (latestStatus === 'claimed') {
                return getClaimedResponse(latestEligibility);
            }
            if (latestStatus === 'pending' && !canRetryAirdropReservation(latestEligibility)) {
                return NextResponse.json({
                    error: 'Claim already in progress. Please wait.',
                    status: 'pending',
                    attemptId: latestEligibility.attemptId,
                    operationId: latestEligibility.operationId,
                    reservationExpiresAt: latestEligibility.reservationExpiresAt,
                }, { status: 409 });
            }
            // A terminal failed record is known unpaid. The compare-and-set
            // reservation below creates a new attempt while keeping concurrent
            // requests serialized; ambiguous operations are still pending.

            const seedAmount = parseAllocationAmount(latestEligibility.seed);
            const leafAmount = parseAllocationAmount(latestEligibility.leaf);
            const pixotchiAmount = parseAllocationAmount(latestEligibility.pixotchi);
            if (seedAmount === null || leafAmount === null || pixotchiAmount === null) {
                return NextResponse.json({ error: 'Invalid airdrop allocation data' }, { status: 500 });
            }

            const reservationStartedAt = Date.now();
            const reservation = createAirdropReservation(
                latestEligibility,
                reservationStartedAt,
                CLAIM_RESERVATION_TTL_MS,
            );
            const expectedRaw = typeof latestRaw === 'string' ? latestRaw : JSON.stringify(latestEligibility);
            const reserved = await compareAndSetEligibility(eligibilityKey, expectedRaw, reservation);
            if (!reserved) {
                return NextResponse.json({ error: 'Claim in progress. Please wait.' }, { status: 409 });
            }
            let activeRaw = JSON.stringify(reservation);

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

            // Build transfer calls for non-zero amounts
            const calls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [];

            if (seedAmount > BigInt(0)) {
                const seedData = encodeFunctionData({
                    abi: ERC20_TRANSFER_ABI,
                    functionName: 'transfer',
                    args: [userAddress as `0x${string}`, seedAmount],
                });
                calls.push({ to: AIRDROP_TOKENS.SEED, value: BigInt(0), data: seedData });
            }

            if (leafAmount > BigInt(0)) {
                const leafData = encodeFunctionData({
                    abi: ERC20_TRANSFER_ABI,
                    functionName: 'transfer',
                    args: [userAddress as `0x${string}`, leafAmount],
                });
                calls.push({ to: AIRDROP_TOKENS.LEAF, value: BigInt(0), data: leafData });
            }

            if (pixotchiAmount > BigInt(0)) {
                const pixotchiData = encodeFunctionData({
                    abi: ERC20_TRANSFER_ABI,
                    functionName: 'transfer',
                    args: [userAddress as `0x${string}`, pixotchiAmount],
                });
                calls.push({ to: AIRDROP_TOKENS.PIXOTCHI, value: BigInt(0), data: pixotchiData });
            }

            if (calls.length === 0) {
                // Mark as claimed even if no tokens (edge case)
                await persistExpectedEligibilityTransition(eligibilityKey, activeRaw, {
                    ...reservation,
                    claimed: true,
                    claimedAt: Date.now(),
                    txHash: null,
                    status: 'claimed',
                });
                return NextResponse.json({ success: true, message: 'No tokens to claim' });
            }

            console.log(`[AIRDROP_CLAIM] Transferring to ${userAddress}:`, {
                seed: seedAmount,
                leaf: leafAmount,
                pixotchi: pixotchiAmount,
                callCount: calls.length,
            });

            // Execute transfers
            const op = await client.evm.sendUserOperation({
                smartAccount: agentSmartAccount,
                network: 'base',
                calls,
                // The same attempt survives an application crash. Retrying it
                // asks CDP for the same operation instead of paying twice.
                idempotencyKey: reservation.attemptId,
            });
            const operationResult = op as UntypedValue;
            // CDP documents `userOpHash` as the operation identifier returned
            // by sendUserOperation. Do not persist opaque ids or string
            // fallbacks: status reconciliation can safely query only a user-op
            // hash, while an unrecorded reservation retries with this attempt's
            // stable idempotency key.
            const operationId = isAirdropUserOperationHash(operationResult?.userOpHash)
                ? operationResult.userOpHash
                : undefined;

            if (operationId) {
                const opRecord: AirdropEligibilityRecord = {
                    ...reservation,
                    operationId,
                };
                activeRaw = await persistExpectedEligibilityTransition(
                    eligibilityKey,
                    activeRaw,
                    opRecord,
                );
            }

            const receipt = await agentSmartAccount.waitForUserOperation(op);

            const operationOutcome = getAirdropOperationOutcome(receipt.status);
            if (operationOutcome === 'failed') {
                await persistExpectedEligibilityTransition(eligibilityKey, activeRaw, {
                    ...reservation,
                    failedAt: Date.now(),
                    failureReason: 'Transfer transaction failed',
                    operationId,
                    status: 'failed',
                });
                throw new Error('Transfer transaction failed');
            }
            // A transport timeout or an intermediate CDP state is not proof
            // that the transfer failed. Keep the persisted user-op pending so
            // GET reconciliation can continue observing it without a resend.
            if (operationOutcome !== 'complete') {
                throw new Error('Transfer transaction confirmation is still pending');
            }

            if (!isAirdropTransactionHash(receipt.transactionHash)) {
                throw new Error('Transfer completed without a valid transaction hash');
            }

            // A CDP operation reaching a terminal state is not enough to prove
            // that every transfer call succeeded. Confirm the canonical Base
            // receipt before consuming the allocation.
            const canonicalReceipt = await getBaseTransactionReceipt(receipt.transactionHash);
            if (canonicalReceipt.status !== 'success') {
                await persistExpectedEligibilityTransition(eligibilityKey, activeRaw, {
                    ...reservation,
                    failedAt: Date.now(),
                    failureReason: 'Transfer transaction reverted',
                    operationId,
                    status: 'failed',
                });
                throw new Error('Transfer transaction reverted');
            }

            console.log(`[AIRDROP_CLAIM] Success, tx: ${receipt.transactionHash}`);

            // Mark as claimed
            await persistExpectedEligibilityTransition(eligibilityKey, activeRaw, {
                ...reservation,
                operationId,
                claimed: true,
                claimedAt: Date.now(),
                txHash: receipt.transactionHash,
                status: 'claimed',
            });

            await incrementClaimedCountOnce();

            return NextResponse.json({
                success: true,
                txHash: receipt.transactionHash,
                status: 'claimed',
                seed: reservation.seed,
                leaf: reservation.leaf,
                pixotchi: reservation.pixotchi,
            });

        } catch (err: UntypedValue) {
            console.error('[AIRDROP_CLAIM] Claim error:', err);
            // GET may have already saved the same canonical completion while
            // this POST was waiting. Treat that as success rather than
            // reporting a spurious 500 or attempting to overwrite it.
            if (err?.latestRecord && getAirdropRecordStatus(err.latestRecord) === 'claimed') {
                return getClaimedResponse(err.latestRecord);
            }
            const latestRaw = await redis.get(eligibilityKey);
            const latestEligibility = latestRaw ? parseAirdropEligibility(latestRaw) : null;
            if (latestEligibility?.status === 'pending') {
                if (latestEligibility.operationId) {
                    return NextResponse.json({
                        error: 'Claim operation is still in progress. Please wait.',
                        status: 'pending',
                        attemptId: latestEligibility.attemptId,
                        operationId: latestEligibility.operationId,
                        reservationExpiresAt: latestEligibility.reservationExpiresAt,
                    }, { status: 409 });
                }

                // The request may have reached CDP before the response was
                // interrupted. Keep the same attempt pending so a later retry
                // reuses its idempotency key instead of creating a new payout.
                await compareAndSetEligibility(eligibilityKey, typeof latestRaw === 'string'
                    ? latestRaw
                    : JSON.stringify(latestEligibility), {
                    ...latestEligibility,
                    failedAt: Date.now(),
                    failureReason: err?.message || 'Claim failed',
                    reservationExpiresAt: Date.now() + CLAIM_RESERVATION_TTL_MS,
                    status: 'pending',
                });
            }
            return NextResponse.json({ error: err.message || 'Claim failed' }, { status: 500 });
        } finally {
            // Release lock
            await redis.del(lockKey);
        }

    } catch (error: UntypedValue) {
        console.error('[AIRDROP_CLAIM] Outer error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * GET /api/airdrop/claim
 * Get the message that needs to be signed to claim airdrop
 */
export async function GET(req: NextRequest) {
    const address = req.nextUrl.searchParams.get('address');

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return NextResponse.json({ error: 'Valid address required' }, { status: 400 });
    }

    const timestamp = Date.now();
    const message = getClaimMessage(address, timestamp);

    return NextResponse.json({
        message,
        timestamp,
        address: address.toLowerCase(),
    });
}
