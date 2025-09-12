import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { createErrorResponse } from '@/lib/auth-utils';

export async function POST(request: NextRequest) {
  try {
    // Check if invite system is enabled
    if (!INVITE_CONFIG.SYSTEM_ENABLED) {
      return NextResponse.json({
        success: false,
        codes: [],
        message: 'Invite system is disabled',
        timestamp: new Date().toISOString(),
      });
    }

    const body = await request.json();
    const { address } = body;

    if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
      const error = createErrorResponse('Valid wallet address is required', 400, 'INVALID_ADDRESS');
      return NextResponse.json(error.body, { status: error.status });
    }

    if (!redis) {
      const error = createErrorResponse('Database not available', 500, 'REDIS_UNAVAILABLE');
      return NextResponse.json(error.body, { status: error.status });
    }

    const normalizedAddress = address.toLowerCase();

    // Get all invite code keys
    const allCodeKeys = await redis.keys('pixotchi:invite-codes:*');
    
    // Fetch all codes and filter by createdBy address
    const userCodes = [];
    
    for (const key of allCodeKeys) {
      try {
        const codeData = await redis.get(key);
        if (codeData) {
          const parsed = typeof codeData === 'string' ? JSON.parse(codeData) : codeData;
          
          // Check if this code was created by the user
          // Handle both string (address) and number (old FID) createdBy values
          if (parsed.createdBy) {
            const createdByMatch = typeof parsed.createdBy === 'string' 
              ? parsed.createdBy.toLowerCase() === normalizedAddress
              : false; // Skip old FID-based codes for now
              
            if (createdByMatch) {
              userCodes.push({
                code: parsed.code,
                createdAt: parsed.createdAt,
                isUsed: parsed.isUsed,
                usedBy: parsed.usedBy,
                usedAt: parsed.usedAt,
                expiresAt: parsed.expiresAt,
              });
            }
          }
        }
      } catch (error) {
        console.error('Error parsing code data:', error);
        // Skip invalid codes
      }
    }

    // Sort by creation date (newest first)
    userCodes.sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({
      success: true,
      codes: userCodes,
      total: userCodes.length,
      used: userCodes.filter(c => c.isUsed).length,
      active: userCodes.filter(c => !c.isUsed).length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error fetching user codes:', error);
    const errorResponse = createErrorResponse('Internal server error', 500);
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 