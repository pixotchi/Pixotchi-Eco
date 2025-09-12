import { NextRequest, NextResponse } from 'next/server';
import { getAllMessagesForAdmin, getChatStats } from '@/lib/chat-service';
import { validateAdminKey, logAdminAction, createErrorResponse } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  try {
    // Validate admin authentication using consistent auth utility
    if (!validateAdminKey(request)) {
      await logAdminAction('chat_admin_messages_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
      const error = createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED');
      return NextResponse.json(error.body, { status: error.status });
    }

    const [messages, stats] = await Promise.all([
      getAllMessagesForAdmin(),
      getChatStats()
    ]);

    // Log successful admin action
    await logAdminAction('chat_admin_messages_success', 'valid_key', { 
      messageCount: messages.length,
      statsIncluded: !!stats 
    }, true);

    return NextResponse.json({
      messages,
      stats,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching admin chat data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin chat data' },
      { status: 500 }
    );
  }
}