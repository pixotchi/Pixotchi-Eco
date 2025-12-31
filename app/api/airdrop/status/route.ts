import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

/**
 * GET /api/airdrop/status?address=0x...
 * 
 * Check if a wallet is eligible for airdrop and their claim status.
 * No authentication required - public endpoint.
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const address = searchParams.get('address');

        if (!address) {
            return NextResponse.json({ error: 'Missing address parameter' }, { status: 400 });
        }

        // Validate address format
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
        }

        const key = `airdrop:eligible:${address.toLowerCase()}`;
        const data = await redis?.get(key);

        if (!data) {
            return NextResponse.json({
                eligible: false,
                seed: '0',
                leaf: '0',
                pixotchi: '0',
                claimed: false,
            });
        }

        let parsed: any;
        try {
            parsed = typeof data === 'string' ? JSON.parse(data) : data;
        } catch {
            parsed = data;
        }

        return NextResponse.json({
            eligible: true,
            seed: parsed.seed || '0',
            leaf: parsed.leaf || '0',
            pixotchi: parsed.pixotchi || '0',
            claimed: parsed.claimed || false,
            claimedAt: parsed.claimedAt || null,
            txHash: parsed.txHash || null,
        });

    } catch (error: any) {
        console.error('[AIRDROP_STATUS] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
