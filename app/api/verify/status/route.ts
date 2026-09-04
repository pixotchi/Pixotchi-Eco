import { NextRequest, NextResponse } from 'next/server';
import { parseUnits } from 'viem';
import { getBaseReadClient } from '@/lib/base-rpc';
import { PIXOTCHI_TOKEN_ADDRESS, ERC20_BALANCE_ABI } from '@/lib/contracts';
import { VERIFY_CLAIM_SEED_BONUS_AMOUNT } from '@/lib/verify-claim-config';
import {
  getVerifyClaimKey,
  getVerifyClaimPairState,
  getVerifyWalletClaimKey,
  normalizeVerifyWalletAddress,
  readVerifyClaimJSON,
  type VerifyClaimReservationRecord,
} from '@/lib/verify-claim-records';

/**
 * Feature toggle for Base Verify claims.
 * Set NEXT_PUBLIC_VERIFY_CLAIM_ENABLED=true to enable.
 */
const VERIFY_CLAIM_ENABLED = process.env.NEXT_PUBLIC_VERIFY_CLAIM_ENABLED === 'true';
const LEAF_BONUS_ENABLED = process.env.NEXT_PUBLIC_VERIFY_CLAIM_LEAF_BONUS_ENABLED === 'true';
const SEED_BONUS_ENABLED = process.env.NEXT_PUBLIC_VERIFY_CLAIM_SEED_BONUS_ENABLED === 'true';

// Agent smart account address for balance checks (avoids initializing full CDP SDK)
const AGENT_ADDRESS = process.env.VERIFY_CLAIM_AGENT_ADDRESS || '';
const SEED_BONUS_AMOUNT = parseUnits(VERIFY_CLAIM_SEED_BONUS_AMOUNT, 18);

/**
 * GET /api/verify/status?address=0x...
 *
 * Check if a wallet has already claimed a free plant via Base Verify.
 * This is a lightweight check that doesn't require a signature.
 *
 * Returns:
 * - { claimed: true, claimData: {...} } if already claimed
 * - { claimed: false, bonuses: { leaf, seed } } if not claimed
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

    const normalizedAddress = normalizeVerifyWalletAddress(address);
    if (!normalizedAddress) {
      return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
    }

    const walletRead = await readVerifyClaimJSON<VerifyClaimReservationRecord>(
      getVerifyWalletClaimKey(normalizedAddress),
    );
    if (walletRead.status === 'unavailable') {
      console.error('[VERIFY_STATUS] Wallet claim state unavailable:', walletRead.error);
      return NextResponse.json(
        { error: 'Claim status is temporarily unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const walletRecord = walletRead.status === 'ok' ? walletRead.value : null;
    let claimRecord: VerifyClaimReservationRecord | null = null;
    if (walletRecord && typeof walletRecord.verificationToken === 'string') {
      const claimRead = await readVerifyClaimJSON<VerifyClaimReservationRecord>(
        getVerifyClaimKey(walletRecord.verificationToken),
      );
      if (claimRead.status === 'unavailable') {
        console.error('[VERIFY_STATUS] Verification claim state unavailable:', claimRead.error);
        return NextResponse.json(
          { error: 'Claim status is temporarily unavailable.' },
          { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      claimRecord = claimRead.status === 'ok' ? claimRead.value : null;
    }

    const claimState = getVerifyClaimPairState(claimRecord, walletRecord);
    const retryable = claimState === 'retryable';
    const blocksNewClaim = claimState !== 'unclaimed' && !retryable;
    if (walletRecord && !retryable) {
      return NextResponse.json({
        enabled: true,
        claimed: blocksNewClaim,
        retryable: false,
        claimState,
        claimData: {
          tokenId: walletRecord.tokenId,
          strainId: walletRecord.strainId,
          timestamp: walletRecord.timestamp,
          status: walletRecord.status,
          stage: walletRecord.stage,
          reservationId: walletRecord.reservationId,
        },
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    // Bonuses are advertised only when a new or safely retryable claim may run.
    let seedAvailable = false;
    if (SEED_BONUS_ENABLED && AGENT_ADDRESS) {
      try {
        const publicClient = getBaseReadClient();
        const balance = await publicClient.readContract({
          address: PIXOTCHI_TOKEN_ADDRESS,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [AGENT_ADDRESS as `0x${string}`],
        });
        seedAvailable = (balance as bigint) >= SEED_BONUS_AMOUNT;
      } catch {
        // If balance check fails, don't advertise SEED bonus
        seedAvailable = false;
      }
    }

    return NextResponse.json({
      enabled: true,
      claimed: false,
      retryable,
      claimState,
      claimData: retryable && walletRecord ? {
        strainId: walletRecord.strainId,
        timestamp: walletRecord.timestamp,
        status: walletRecord.status,
        stage: walletRecord.stage,
        reservationId: walletRecord.reservationId,
      } : null,
      bonuses: {
        leaf: LEAF_BONUS_ENABLED,
        seed: SEED_BONUS_ENABLED && seedAvailable,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });

  } catch (error: UntypedValue) {
    console.error('[VERIFY_STATUS] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

