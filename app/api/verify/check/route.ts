import { NextRequest, NextResponse } from 'next/server';
import { redisSetJSONRaw } from '@/lib/redis';
import { validateAction, type ExpectedTraits, validateTraits } from '@/lib/trait-validator';
import {
  getVerifyClaimKey,
  getVerifyClaimPairState,
  getVerifyPendingKey,
  getVerifyWalletClaimKey,
  readVerifyClaimJSON,
  VERIFY_PENDING_TTL_SECONDS,
  type VerifyClaimReservationRecord,
  type VerifyPendingRecord,
} from '@/lib/verify-claim-records';
import {
  resolveVerifyClaimPrincipal,
  VerifyClaimPrincipalError,
  type VerifyClaimPrincipal,
} from '@/lib/verify-claim-principal';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';

/**
 * Feature toggle for Base Verify claims.
 * Set NEXT_PUBLIC_VERIFY_CLAIM_ENABLED=true to enable both frontend UI and backend API.
 */
const VERIFY_CLAIM_ENABLED = process.env.NEXT_PUBLIC_VERIFY_CLAIM_ENABLED === 'true';

/**
 * Expected traits for free plant claim verification.
 * 
 * Currently, we only require a linked X account (no specific traits).
 * If you want to require specific traits (e.g., verified:true, followers:gte:100),
 * add them here and they will be validated before calling Base Verify.
 * 
 * SECURITY: These must match what the frontend sends, but the backend
 * is the source of truth. If a user modifies the frontend to send weaker
 * requirements, this validation will reject the request.
 */
const EXPECTED_TRAITS: ExpectedTraits = {
  // Uncomment these to require specific traits:
  // 'verified': 'true',           // Require X blue checkmark
  // 'followers': 'gte:100',       // Require at least 100 followers
};

const VERIFY_CHECK_IP_LIMIT_PER_MINUTE = 10;

export async function POST(req: NextRequest) {
  // Check if feature is enabled
  if (!VERIFY_CLAIM_ENABLED) {
    return NextResponse.json({ 
      error: 'Verification claims are currently disabled' 
    }, { status: 503 });
  }

  try {
    const rateLimitResponse = await enforceRateLimit(req, {
      failClosed: true,
      scope: 'api:verify:check',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(req) ?? 'unknown',
          limit: VERIFY_CHECK_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });
    if (rateLimitResponse) return rateLimitResponse;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }
    const { signature, message, address, provider } = body as Record<string, unknown>;

    if (typeof signature !== 'string' || !signature.startsWith('0x') || signature.length > 32_768) {
      return NextResponse.json({ error: 'A valid signature is required' }, { status: 400 });
    }

    let principal: VerifyClaimPrincipal;
    try {
      principal = resolveVerifyClaimPrincipal(message, {
        ...(address !== undefined ? { claimedAddress: address } : {}),
        ...(provider !== undefined ? { claimedProvider: provider } : {}),
      });
    } catch (error) {
      if (error instanceof VerifyClaimPrincipalError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
    const normalizedAddress = principal.address;
    const verifiedProvider = principal.provider;
    const signedMessage = message as string;

    const walletRateLimitResponse = await enforceRateLimit(req, {
      failClosed: true,
      scope: 'api:verify:check',
      rules: [
        {
          kind: 'address',
          identifier: normalizedAddress,
          limit: VERIFY_CHECK_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });
    if (walletRateLimitResponse) return walletRateLimitResponse;

    // 1. SECURITY: Validate trait requirements in SIWE message match backend expectations
    // This prevents users from modifying frontend to sign weaker requirements
    const validation = Object.keys(EXPECTED_TRAITS).length > 0
      ? validateTraits(signedMessage, verifiedProvider, EXPECTED_TRAITS, principal.action)
      : validateAction(signedMessage, verifiedProvider, principal.action);

    if (!validation.valid) {
      console.warn('[VERIFY] Trait validation failed:', {
        address: normalizedAddress,
        provider: verifiedProvider,
        error: validation.error,
        parsedTraits: validation.parsedTraits,
        parsedAction: validation.parsedAction,
      });
      return NextResponse.json({ 
        error: 'Invalid trait requirements in message',
        details: validation.error 
      }, { status: 400 });
    }

    console.log('[VERIFY] Trait validation passed:', {
      address: normalizedAddress,
      provider: verifiedProvider,
      action: validation.parsedAction,
      traits: validation.parsedTraits,
    });

    // 2. Call Base Verify API
    const verifyUrl = 'https://verify.base.dev/v1/base_verify_token';
    const secretKey = process.env.BASE_VERIFY_SECRET_KEY;

    if (!secretKey) {
      console.error('BASE_VERIFY_SECRET_KEY is not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    console.log('[VERIFY] Calling Base Verify for:', { address: normalizedAddress, provider: verifiedProvider });

    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        signature,
        message: signedMessage,
      }),
    });

    const responseBody = await response.text();
    console.log('[VERIFY] Base Verify API Status:', response.status);

    let data;
    try {
      data = JSON.parse(responseBody);
    } catch (e) {
      console.error('[VERIFY] Failed to parse response body:', e);
      return NextResponse.json({ error: 'Invalid response from upstream' }, { status: 500 });
    }

    if (response.ok) {
      const verificationToken = data.token;
      if (typeof verificationToken !== 'string' || verificationToken.length === 0) {
        return NextResponse.json({ error: 'Invalid verification response' }, { status: 500 });
      }

      // Check if this token has already claimed a free plant
      const claimKey = getVerifyClaimKey(verificationToken);
      const walletClaimKey = getVerifyWalletClaimKey(normalizedAddress);
      const [claimRead, walletClaimRead] = await Promise.all([
        readVerifyClaimJSON<VerifyClaimReservationRecord>(claimKey),
        readVerifyClaimJSON<VerifyClaimReservationRecord>(walletClaimKey),
      ]);

      if (claimRead.status === 'unavailable' || walletClaimRead.status === 'unavailable') {
        return NextResponse.json(
          { error: 'Verification claim storage is temporarily unavailable.' },
          { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      let claimRecord = claimRead.status === 'ok' ? claimRead.value : null;
      const walletRecord = walletClaimRead.status === 'ok' ? walletClaimRead.value : null;
      if (
        !claimRecord
        && walletRecord
        && typeof walletRecord.verificationToken === 'string'
      ) {
        const pairedClaimRead = await readVerifyClaimJSON<VerifyClaimReservationRecord>(
          getVerifyClaimKey(walletRecord.verificationToken),
        );
        if (pairedClaimRead.status === 'unavailable') {
          return NextResponse.json(
            { error: 'Verification claim storage is temporarily unavailable.' },
            { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
          );
        }
        claimRecord = pairedClaimRead.status === 'ok' ? pairedClaimRead.value : null;
      }

      const claimState = getVerifyClaimPairState(claimRecord, walletRecord);
      const existingRecord = walletRecord ?? claimRecord;
      if (claimState !== 'unclaimed' && claimState !== 'retryable') {
        return NextResponse.json({
          verified: true,
          token: verificationToken,
          alreadyClaimed: true,
          retryable: false,
          claimState,
          reservationId: existingRecord?.reservationId,
          recoveryStage: existingRecord?.stage,
        }, {
          status: 200,
          headers: { 'Cache-Control': 'private, no-store' },
        });
      }

      const now = Date.now();
      const pendingRecord: VerifyPendingRecord = {
        status: 'verified_pending',
        token: verificationToken,
        address: normalizedAddress,
        provider: verifiedProvider,
        action: principal.action,
        createdAt: now,
        expiresAt: now + VERIFY_PENDING_TTL_SECONDS * 1000,
      };
      const pendingStored = await redisSetJSONRaw(
        getVerifyPendingKey(verificationToken),
        pendingRecord,
        VERIFY_PENDING_TTL_SECONDS,
      );
      if (!pendingStored) {
        return NextResponse.json(
          { error: 'Verification claim storage is temporarily unavailable.' },
          { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      return NextResponse.json({
        verified: true,
        token: verificationToken,
        alreadyClaimed: false,
        retryable: claimState === 'retryable',
        claimState,
      }, {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store' },
      });

    } else if (response.status === 404) {
      return NextResponse.json({ verified: false, needsVerification: true }, { status: 404 });
    } else if (response.status === 400) {
      if (data.message === 'verification_traits_not_satisfied') {
        return NextResponse.json({ verified: false, traitsNotMet: true, details: data.details }, { status: 400 });
      }
      return NextResponse.json({ error: data.message || 'Verification failed' }, { status: 400 });
    } else {
      console.error('Base Verify API error:', response.status, data);
      return NextResponse.json({ error: 'Verification check failed upstream' }, { status: 500 });
    }

  } catch (error: UntypedValue) {
    console.error('Check verification error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
