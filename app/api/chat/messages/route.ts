import { NextRequest, NextResponse } from 'next/server';
import { getRecentMessages } from '@/lib/chat-service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    
    // Validate limit
    if (limit > 100) {
      return NextResponse.json(
        { error: 'Limit cannot exceed 100' },
        { status: 400 }
      );
    }

    const messages = await getRecentMessages(limit);

    return NextResponse.json({
      messages,
      count: messages.length,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}