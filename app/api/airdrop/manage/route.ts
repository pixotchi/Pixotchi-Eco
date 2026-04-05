import { NextRequest, NextResponse } from 'next/server';
import { getBaseReadClient } from '@/lib/base-rpc';
import { redis, redisScanKeysRaw } from '@/lib/redis';
import { logAdminAction, validateAdminKey } from '@/lib/auth-utils';
import { formatUnits } from 'viem';

// Token addresses for reference
const AIRDROP_TOKENS = {
    SEED: '0x546D239032b24eCEEE0cb05c92FC39090846adc7',
    LEAF: '0xE78ee52349D7b031E2A6633E07c037C3147DB116',
    PIXOTCHI: '0xa2ef17bb7eea1143196678337069dfa24d37d2ac',
} as const;

const SERVER_WALLET = '0x2b6BB031aD45E2d5E6A715e50a3F67d1C10ea5B9';

const ERC20_BALANCE_ABI = [
    {
        inputs: [{ name: 'account', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;

const REDIS_BATCH_SIZE = 100;
const AIRDROP_ELIGIBLE_PATTERN = 'airdrop:eligible:*';
const AIRDROP_LOCK_PATTERN = 'airdrop:lock:*';

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

async function deleteRedisKeys(keys: string[]): Promise<number> {
    if (!redis || keys.length === 0) {
        return 0;
    }

    let deletedCount = 0;
    for (const batch of chunkArray(keys, REDIS_BATCH_SIZE)) {
        if (batch.length === 0) continue;
        await redis.del(...batch);
        deletedCount += batch.length;
    }

    return deletedCount;
}

/**
 * POST /api/airdrop/manage
 * Upload CSV eligibility list. Clears previous data.
 * CSV format: address,seed,leaf,pixotchi
 */
export async function POST(req: NextRequest) {
    try {
        if (!validateAdminKey(req)) {
            await logAdminAction('airdrop_manage_upload_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!redis) {
            return NextResponse.json({ error: 'Redis unavailable' }, { status: 500 });
        }

        const body = await req.json();
        const { csv } = body;

        if (!csv || typeof csv !== 'string') {
            return NextResponse.json({ error: 'Missing csv field' }, { status: 400 });
        }

        const lines = csv.trim().split('\n').filter(line => line.trim());

        // Skip header if present
        const startIndex = lines[0]?.toLowerCase().includes('address') ? 1 : 0;
        const dataLines = lines.slice(startIndex);

        if (dataLines.length === 0) {
            return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
        }

        // Parse and validate entries
        const entries: Array<{ address: string; seed: string; leaf: string; pixotchi: string }> = [];
        const errors: string[] = [];

        for (let i = 0; i < dataLines.length; i++) {
            const line = dataLines[i].trim();
            if (!line) continue;

            const parts = line.split(',').map(p => p.trim());
            if (parts.length < 4) {
                errors.push(`Line ${i + startIndex + 1}: Expected 4 columns, got ${parts.length}`);
                continue;
            }

            const [address, seed, leaf, pixotchi] = parts;

            if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
                errors.push(`Line ${i + startIndex + 1}: Invalid address format`);
                continue;
            }

            // Validate amounts are non-negative numbers
            const seedNum = parseFloat(seed);
            const leafNum = parseFloat(leaf);
            const pixotchiNum = parseFloat(pixotchi);

            if (isNaN(seedNum) || seedNum < 0) {
                errors.push(`Line ${i + startIndex + 1}: Invalid SEED amount`);
                continue;
            }
            if (isNaN(leafNum) || leafNum < 0) {
                errors.push(`Line ${i + startIndex + 1}: Invalid LEAF amount`);
                continue;
            }
            if (isNaN(pixotchiNum) || pixotchiNum < 0) {
                errors.push(`Line ${i + startIndex + 1}: Invalid PIXOTCHI amount`);
                continue;
            }

            entries.push({
                address: address.toLowerCase(),
                seed: seed,
                leaf: leaf,
                pixotchi: pixotchi,
            });
        }

        if (entries.length === 0) {
            return NextResponse.json({
                error: 'No valid entries found',
                validationErrors: errors
            }, { status: 400 });
        }

        // Clear existing airdrop data
        const existingKeys = await redisScanKeysRaw(AIRDROP_ELIGIBLE_PATTERN);
        await deleteRedisKeys(existingKeys);

        // Store new entries
        for (const batch of chunkArray(entries, REDIS_BATCH_SIZE)) {
            const pipeline = redis.pipeline();

            for (const entry of batch) {
                const key = `airdrop:eligible:${entry.address}`;
                pipeline.set(key, JSON.stringify({
                    seed: entry.seed,
                    leaf: entry.leaf,
                    pixotchi: entry.pixotchi,
                    claimed: false,
                    createdAt: Date.now(),
                }));
            }

            await pipeline.exec();
        }

        // Store metadata
        await redis.set('airdrop:meta', JSON.stringify({
            uploadedAt: Date.now(),
            totalRecipients: entries.length,
            claimedCount: 0,
            tokens: AIRDROP_TOKENS,
        }));

        await logAdminAction('airdrop_manage_upload_success', 'system', {
            totalRecipients: entries.length,
            validationErrorCount: errors.length,
        });

        return NextResponse.json({
            success: true,
            totalRecipients: entries.length,
            validationErrors: errors.length > 0 ? errors : undefined,
        });

    } catch (error: any) {
        console.error('[AIRDROP_MANAGE] POST Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * GET /api/airdrop/manage
 * Get airdrop stats and list of recipients
 */
export async function GET(req: NextRequest) {
    try {
        if (!validateAdminKey(req)) {
            await logAdminAction('airdrop_manage_read_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!redis) {
            return NextResponse.json({ error: 'Redis unavailable' }, { status: 500 });
        }

        // Get metadata
        const metaRaw = await redis.get('airdrop:meta');
        let meta: any = null;
        if (metaRaw) {
            try {
                meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
            } catch {
                meta = null;
            }
        }

        // Get all eligible entries
        const keys = await redisScanKeysRaw(AIRDROP_ELIGIBLE_PATTERN);
        const recipients: Array<{
            address: string;
            seed: string;
            leaf: string;
            pixotchi: string;
            claimed: boolean;
            claimedAt?: number;
            txHash?: string;
        }> = [];

        let claimedCount = 0;

        for (const batch of chunkArray(keys, REDIS_BATCH_SIZE)) {
            if (batch.length === 0) continue;

            const values = await redis.mget(...batch);
            for (let index = 0; index < batch.length; index++) {
                const key = batch[index];
                const dataRaw = values[index];
                if (!dataRaw) continue;

                let data: any;
                try {
                    data = typeof dataRaw === 'string' ? JSON.parse(dataRaw) : dataRaw;
                } catch {
                    continue;
                }

                recipients.push({
                    address: key.replace('airdrop:eligible:', ''),
                    seed: data.seed || '0',
                    leaf: data.leaf || '0',
                    pixotchi: data.pixotchi || '0',
                    claimed: data.claimed || false,
                    claimedAt: data.claimedAt,
                    txHash: data.txHash,
                });

                if (data.claimed) claimedCount++;
            }
        }

        // Sort by address
        recipients.sort((a, b) => a.address.localeCompare(b.address));

        // Calculate totals
        const requirements = {
            seed: { total: 0, remaining: 0 },
            leaf: { total: 0, remaining: 0 },
            pixotchi: { total: 0, remaining: 0 },
        };

        for (const r of recipients) {
            const seedVal = parseFloat(r.seed) || 0;
            const leafVal = parseFloat(r.leaf) || 0;
            const pixotchiVal = parseFloat(r.pixotchi) || 0;

            requirements.seed.total += seedVal;
            requirements.leaf.total += leafVal;
            requirements.pixotchi.total += pixotchiVal;

            if (!r.claimed) {
                requirements.seed.remaining += seedVal;
                requirements.leaf.remaining += leafVal;
                requirements.pixotchi.remaining += pixotchiVal;
            }
        }

        // Fetch server wallet balances
        let balances = { seed: '0', leaf: '0', pixotchi: '0' };
        try {
            const client = getBaseReadClient();

            const [seedBal, leafBal, pixotchiBal] = await Promise.all([
                client.readContract({
                    address: AIRDROP_TOKENS.SEED as `0x${string}`,
                    abi: ERC20_BALANCE_ABI,
                    functionName: 'balanceOf',
                    args: [SERVER_WALLET as `0x${string}`],
                }),
                client.readContract({
                    address: AIRDROP_TOKENS.LEAF as `0x${string}`,
                    abi: ERC20_BALANCE_ABI,
                    functionName: 'balanceOf',
                    args: [SERVER_WALLET as `0x${string}`],
                }),
                client.readContract({
                    address: AIRDROP_TOKENS.PIXOTCHI as `0x${string}`,
                    abi: ERC20_BALANCE_ABI,
                    functionName: 'balanceOf',
                    args: [SERVER_WALLET as `0x${string}`],
                }),
            ]);

            balances = {
                seed: formatUnits(seedBal as bigint, 18),
                leaf: formatUnits(leafBal as bigint, 18),
                pixotchi: formatUnits(pixotchiBal as bigint, 18),
            };
        } catch (err) {
            console.error('[AIRDROP_MANAGE] Balance fetch error:', err);
        }

        return NextResponse.json({
            success: true,
            meta: {
                uploadedAt: meta?.uploadedAt,
                totalRecipients: recipients.length,
                claimedCount,
                tokens: AIRDROP_TOKENS,
                serverWallet: SERVER_WALLET,
                requirements,
                balances,
            },
            recipients,
        });

    } catch (error: any) {
        console.error('[AIRDROP_MANAGE] GET Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * DELETE /api/airdrop/manage
 * Clear all airdrop data
 */
export async function DELETE(req: NextRequest) {
    try {
        if (!validateAdminKey(req)) {
            await logAdminAction('airdrop_manage_clear_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!redis) {
            return NextResponse.json({ error: 'Redis unavailable' }, { status: 500 });
        }

        // Clear all airdrop keys
        const [eligibleKeys, lockKeys, metaRaw] = await Promise.all([
            redisScanKeysRaw(AIRDROP_ELIGIBLE_PATTERN),
            redisScanKeysRaw(AIRDROP_LOCK_PATTERN),
            redis.get('airdrop:meta'),
        ]);
        const allKeys = metaRaw ? [...eligibleKeys, ...lockKeys, 'airdrop:meta'] : [...eligibleKeys, ...lockKeys];
        const deletedCount = await deleteRedisKeys(allKeys);

        await logAdminAction('airdrop_manage_clear_success', 'system', {
            deletedCount,
        });

        return NextResponse.json({
            success: true,
            deletedCount,
        });

    } catch (error: any) {
        console.error('[AIRDROP_MANAGE] DELETE Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
