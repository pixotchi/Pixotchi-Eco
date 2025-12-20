import { NextRequest, NextResponse } from 'next/server';
import { validateTraits } from '@/lib/trait-validator'; // We will create this helper
import { redis } from '@/lib/redis';

// Validate trait requirements match what backend expects
// This prevents users from modifying trait requirements on the frontend
const EXPECTED_TRAITS = {
  // Example for X (Twitter)
  'x': {
    'verified': 'true',
    // 'followers': 'gte:100' // Optional: Uncomment to enforce followers count
  },
  // Example for Coinbase
  'coinbase': {
    'coinbase_one_active': 'true'
  },
  // Example for Instagram
  'instagram': {
    'username': 'exists' // Check for account existence (custom logic maybe needed)
  },
  // Example for TikTok
  'tiktok': {
    'display_name': 'exists' 
  }
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { signature, message, address, provider } = body;

    if (!signature || !message || !address || !provider) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Validate traits in the message (Security)
    // NOTE: For now, we only support basic verification check
    // In a real implementation, you'd parse the SIWE message resources and match against EXPECTED_TRAITS
    // For this MVP, we'll rely on Base Verify API's response, but verifying the message structure is best practice.
    
    // 2. Call Base Verify API
    const verifyUrl = 'https://verify.base.dev/v1/base_verify_token';
    const secretKey = process.env.BASE_VERIFY_SECRET_KEY;

    if (!secretKey) {
      console.error('BASE_VERIFY_SECRET_KEY is not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

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

    console.log('[VERIFY] Base Verify API Response:', {
      status: response.status,
      statusText: response.statusText,
    });

    if (response.ok) {
      const data = await response.json();
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
      const data = await response.json();
      if (data.message === 'verification_traits_not_satisfied') {
        return NextResponse.json({ verified: false, traitsNotMet: true }, { status: 400 });
      }
      return NextResponse.json({ error: data.message || 'Verification failed' }, { status: 400 });
    } else {
      console.error('Base Verify API error:', response.status, await response.text());
      return NextResponse.json({ error: 'Verification check failed upstream' }, { status: 500 });
    }

  } catch (error: any) {
    console.error('Check verification error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

