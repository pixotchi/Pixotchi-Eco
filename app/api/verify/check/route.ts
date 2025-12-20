import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { validateAction, type ExpectedTraits, validateTraits } from '@/lib/trait-validator';

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

/**
 * The action name used for free plant claims.
 * This must match what the frontend sends in the SIWE message.
 */
const EXPECTED_ACTION = 'claim_free_plant';

export async function POST(req: NextRequest) {
  // Check if feature is enabled
  if (!VERIFY_CLAIM_ENABLED) {
    return NextResponse.json({ 
      error: 'Verification claims are currently disabled' 
    }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { signature, message, address, provider } = body;

    if (!signature || !message || !address || !provider) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. SECURITY: Validate trait requirements in SIWE message match backend expectations
    // This prevents users from modifying frontend to sign weaker requirements
    const validation = Object.keys(EXPECTED_TRAITS).length > 0
      ? validateTraits(message, provider, EXPECTED_TRAITS, EXPECTED_ACTION)
      : validateAction(message, provider, EXPECTED_ACTION);

    if (!validation.valid) {
      console.warn('[VERIFY] Trait validation failed:', {
        address,
        provider,
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
      address,
      provider,
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

    console.log('[VERIFY] Calling Base Verify for:', { address, provider });

    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        signature,
        message,
      }),
    });

    const responseBody = await response.text();
    console.log('[VERIFY] Base Verify API Status:', response.status);
    console.log('[VERIFY] Base Verify API Body:', responseBody);

    let data;
    try {
      data = JSON.parse(responseBody);
    } catch (e) {
      console.error('[VERIFY] Failed to parse response body:', e);
      return NextResponse.json({ error: 'Invalid response from upstream' }, { status: 500 });
    }

    if (response.ok) {
      const verificationToken = data.token;

      // Check if this token has already claimed a free plant
      const claimKey = `verified_claims:${verificationToken}`;
      const existingClaim = await redis?.get(claimKey);

      if (existingClaim) {
        return NextResponse.json({ 
          verified: true, 
          token: verificationToken,
          alreadyClaimed: true 
        }, { status: 200 });
      }

      return NextResponse.json({ 
        verified: true, 
        token: verificationToken,
        alreadyClaimed: false
      }, { status: 200 });

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

  } catch (error: any) {
    console.error('Check verification error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
