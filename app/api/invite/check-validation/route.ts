import { NextRequest, NextResponse } from 'next/server';
import { isUserValidated } from '@/lib/invite-service';
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    // Check if invite system is enabled
    if (!INVITE_CONFIG.SYSTEM_ENABLED) {
      return NextResponse.json({ 
        validated: true, 
        systemEnabled: false 
      });
    }

    const body = await request.json();
    const { address } = body;

    if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
      return NextResponse.json(
        { error: 'Valid wallet address is required', validated: false },
        { status: 400 }
      );
    }
    
    // Call the server-side validation function
    const validated = await isUserValidated(address);
    
    return NextResponse.json({ 
      validated,
      systemEnabled: true,
      address: address.toLowerCase()
    });

  } catch (error) {
    logger.error('Error in check-validation API', error);
    return NextResponse.json(
      { error: 'Internal server error', validated: false },
      { status: 500 }
    );
  }
} 