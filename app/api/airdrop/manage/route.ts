import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

const ADMIN_KEY = process.env.ADMIN_INVITE_KEY;

// Token addresses for reference
const AIRDROP_TOKENS = {
    SEED: '0x546D239032b24eCEEE0cb05c92FC39090846adc7',
    LEAF: '0xE78ee52349D7b031E2A6633E07c037C3147DB116',
    PIXOTCHI: '0xa2ef17bb7eea1143196678337069dfa24d37d2ac',
} as const;

/**
 * POST /api/airdrop/manage
 * Upload CSV eligibility list. Clears previous data.
 * CSV format: address,seed,leaf,pixotchi
 */
export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== ADMIN_KEY) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
        const existingKeys = await redis?.keys('airdrop:eligible:*');
        if (existingKeys && existingKeys.length > 0) {
            for (const key of existingKeys) {
                await redis?.del(key);
            }
        }

        // Store new entries
        for (const entry of entries) {
            const key = `airdrop:eligible:${entry.address}`;
            await redis?.set(key, JSON.stringify({
                seed: entry.seed,
                leaf: entry.leaf,
                pixotchi: entry.pixotchi,
                claimed: false,
                createdAt: Date.now(),
            }));
        }

        // Store metadata
        await redis?.set('airdrop:meta', JSON.stringify({
            uploadedAt: Date.now(),
            totalRecipients: entries.length,
            claimedCount: 0,
            tokens: AIRDROP_TOKENS,
        }));

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
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== ADMIN_KEY) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get metadata
        const metaRaw = await redis?.get('airdrop:meta');
        let meta: any = null;
        if (metaRaw) {
            try {
                meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
            } catch {
                meta = null;
            }
        }

        // Get all eligible entries
        const keys = await redis?.keys('airdrop:eligible:*') || [];
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

        for (const key of keys) {
            const address = key.replace('airdrop:eligible:', '');
            const dataRaw = await redis?.get(key);
            if (dataRaw) {
                let data: any;
                try {
                    data = typeof dataRaw === 'string' ? JSON.parse(dataRaw) : dataRaw;
                } catch {
                    continue;
                }
                recipients.push({
                    address,
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

        return NextResponse.json({
            success: true,
            meta: meta ? {
                uploadedAt: meta.uploadedAt,
                totalRecipients: recipients.length,
                claimedCount,
                tokens: AIRDROP_TOKENS,
            } : null,
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
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== ADMIN_KEY) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Clear all airdrop keys
        const eligibleKeys = await redis?.keys('airdrop:eligible:*') || [];
        const lockKeys = await redis?.keys('airdrop:lock:*') || [];
        const allKeys = [...eligibleKeys, ...lockKeys, 'airdrop:meta'];

        let deletedCount = 0;
        for (const key of allKeys) {
            await redis?.del(key);
            deletedCount++;
        }

        return NextResponse.json({
            success: true,
            deletedCount,
        });

    } catch (error: any) {
        console.error('[AIRDROP_MANAGE] DELETE Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
