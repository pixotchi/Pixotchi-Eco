import { NextRequest, NextResponse } from 'next/server';
import { dismissMessage } from '@/lib/broadcast-service';

/**
 * POST /api/broadcast/dismiss - Dismiss a broadcast message
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messageId, address } = body;

    if (!messageId || !address) {
      return NextResponse.json(
        { error: 'Message ID and address are required' },
        { status: 400 }
      );
    }

    const result = await dismissMessage(messageId, address);

    if (result.success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: result.error || 'Failed to dismiss message' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Dismiss message error:', error);
    return NextResponse.json(
      { error: 'Failed to dismiss message' },
      { status: 500 }
    );
  }
}

