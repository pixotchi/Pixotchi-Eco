import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { CdpClient } from '@coinbase/cdp-sdk';
import { encodeFunctionData, parseUnits, verifyMessage } from 'viem';

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
let agentSmartAccount: any = null;

const CLAIM_LOCK_PREFIX = 'airdrop:lock:';

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
            isValid = await verifyMessage({
                address: userAddress as `0x${string}`,
                message,
                signature: signature as `0x${string}`,
            });
        } catch (verifyError) {
            console.error('[AIRDROP_CLAIM] Signature verification error:', verifyError);
            return NextResponse.json({ error: 'Invalid signature format' }, { status: 400 });
        }

        if (!isValid) {
            return NextResponse.json({ error: 'Invalid signature. Please sign with the correct wallet.' }, { status: 401 });
        }

        console.log(`[AIRDROP_CLAIM] Signature verified for ${userAddress}`);

        const normalizedAddress = userAddress.toLowerCase();
        const eligibilityKey = `airdrop:eligible:${normalizedAddress}`;

        // Check eligibility
        const eligibilityRaw = await redis?.get(eligibilityKey);
        if (!eligibilityRaw) {
            return NextResponse.json({ error: 'Not eligible for airdrop' }, { status: 400 });
        }

        let eligibility: any;
        try {
            eligibility = typeof eligibilityRaw === 'string' ? JSON.parse(eligibilityRaw) : eligibilityRaw;
        } catch {
            return NextResponse.json({ error: 'Invalid eligibility data' }, { status: 500 });
        }

        // Check if already claimed
        if (eligibility.claimed) {
            return NextResponse.json({
                error: 'Already claimed',
                claimedAt: eligibility.claimedAt,
                txHash: eligibility.txHash,
            }, { status: 400 });
        }

        // Acquire distributed lock
        const lockKey = `${CLAIM_LOCK_PREFIX}${normalizedAddress}`;
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
                    enableSpendPermissions: true,
                });
            }

            // Parse amounts
            const seedAmount = parseFloat(eligibility.seed || '0');
            const leafAmount = parseFloat(eligibility.leaf || '0');
            const pixotchiAmount = parseFloat(eligibility.pixotchi || '0');

            // Build transfer calls for non-zero amounts
            const calls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [];

            if (seedAmount > 0) {
                const seedData = encodeFunctionData({
                    abi: ERC20_TRANSFER_ABI,
                    functionName: 'transfer',
                    args: [userAddress as `0x${string}`, parseUnits(eligibility.seed, 18)],
                });
                calls.push({ to: AIRDROP_TOKENS.SEED, value: BigInt(0), data: seedData });
            }

            if (leafAmount > 0) {
                const leafData = encodeFunctionData({
                    abi: ERC20_TRANSFER_ABI,
                    functionName: 'transfer',
                    args: [userAddress as `0x${string}`, parseUnits(eligibility.leaf, 18)],
                });
                calls.push({ to: AIRDROP_TOKENS.LEAF, value: BigInt(0), data: leafData });
            }

            if (pixotchiAmount > 0) {
                const pixotchiData = encodeFunctionData({
                    abi: ERC20_TRANSFER_ABI,
                    functionName: 'transfer',
                    args: [userAddress as `0x${string}`, parseUnits(eligibility.pixotchi, 18)],
                });
                calls.push({ to: AIRDROP_TOKENS.PIXOTCHI, value: BigInt(0), data: pixotchiData });
            }

            if (calls.length === 0) {
                // Mark as claimed even if no tokens (edge case)
                await redis?.set(eligibilityKey, JSON.stringify({
                    ...eligibility,
                    claimed: true,
                    claimedAt: Date.now(),
                    txHash: null,
                }));
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
            });

            const receipt = await agentSmartAccount.waitForUserOperation(op);

            if (receipt.status !== 'complete') {
                throw new Error('Transfer transaction failed');
            }

            console.log(`[AIRDROP_CLAIM] Success, tx: ${receipt.transactionHash}`);

            // Mark as claimed
            await redis?.set(eligibilityKey, JSON.stringify({
                ...eligibility,
                claimed: true,
                claimedAt: Date.now(),
                txHash: receipt.transactionHash,
            }));

            // Update claimed count in meta
            const metaRaw = await redis?.get('airdrop:meta');
            if (metaRaw) {
                try {
                    const meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
                    meta.claimedCount = (meta.claimedCount || 0) + 1;
                    await redis?.set('airdrop:meta', JSON.stringify(meta));
                } catch { }
            }

            return NextResponse.json({
                success: true,
                txHash: receipt.transactionHash,
                seed: eligibility.seed,
                leaf: eligibility.leaf,
                pixotchi: eligibility.pixotchi,
            });

        } catch (err: any) {
            console.error('[AIRDROP_CLAIM] Claim error:', err);
            return NextResponse.json({ error: err.message || 'Claim failed' }, { status: 500 });
        } finally {
            // Release lock
            await redis?.del(lockKey);
        }

    } catch (error: any) {
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

