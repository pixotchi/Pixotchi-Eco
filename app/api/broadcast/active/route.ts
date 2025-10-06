import { NextRequest, NextResponse } from 'next/server';
import { getMessagesForUser, registerUser } from '@/lib/broadcast-service';

/**
 * GET /api/broadcast/active - Get active broadcasts for the current user
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get('address');

    // Register user if address provided (for 'current' targeting)
    if (address) {
      await registerUser(address);
    }

    // Get messages filtered for this user
    const messages = await getMessagesForUser(address || undefined);

    return NextResponse.json({
      success: true,
      messages,
    });
  } catch (error) {
    console.error('Get active broadcasts error:', error);
    // Fail gracefully - don't break the app if broadcasts fail
    return NextResponse.json({
      success: true,
      messages: [],
    });
  }
}

