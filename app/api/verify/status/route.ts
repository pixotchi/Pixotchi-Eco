import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

/**
 * Feature toggle for Base Verify claims.
 * Set NEXT_PUBLIC_VERIFY_CLAIM_ENABLED=true to enable.
 */
const VERIFY_CLAIM_ENABLED = process.env.NEXT_PUBLIC_VERIFY_CLAIM_ENABLED === 'true';

/**
 * GET /api/verify/status?address=0x...
 * 
 * Check if a wallet has already claimed a free plant via Base Verify.
 * This is a lightweight check that doesn't require a signature.
 * 
 * Returns:
 * - { claimed: true, claimData: {...} } if already claimed
 * - { claimed: false } if not claimed
 * - { enabled: false } if feature is disabled
 */
export async function GET(req: NextRequest) {
  // Check if feature is enabled
  if (!VERIFY_CLAIM_ENABLED) {
    return NextResponse.json({ 
      enabled: false,
      claimed: false 
    });
  }

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

    // Check Redis for existing claim by wallet address
    const walletClaimKey = `wallet_claims:${address.toLowerCase()}`;
    const existingClaim = await redis?.get(walletClaimKey);

    if (existingClaim) {
      let claimData = null;
      try {
        claimData = typeof existingClaim === 'string' 
          ? JSON.parse(existingClaim) 
          : existingClaim;
      } catch {
        // If parsing fails, just indicate claimed
      }

      return NextResponse.json({ 
        enabled: true,
        claimed: true,
        claimData: claimData ? {
          tokenId: claimData.tokenId,
          strainId: claimData.strainId,
          timestamp: claimData.timestamp,
          status: claimData.status,
        } : null
      });
    }

    return NextResponse.json({ 
      enabled: true,
      claimed: false 
    });

  } catch (error: any) {
    console.error('[VERIFY_STATUS] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

