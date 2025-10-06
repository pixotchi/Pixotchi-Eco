import { NextRequest, NextResponse } from 'next/server';
import { trackImpression } from '@/lib/broadcast-service';

/**
 * POST /api/broadcast/impression - Track that a message was shown
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messageId } = body;

    if (!messageId) {
      return NextResponse.json(
        { error: 'Message ID is required' },
        { status: 400 }
      );
    }

    await trackImpression(messageId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Track impression error:', error);
    // Fail silently - tracking shouldn't break user experience
    return NextResponse.json({ success: true });
  }
}

