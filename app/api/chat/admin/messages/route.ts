import { NextRequest, NextResponse } from 'next/server';
import { getAllMessagesForAdmin, getChatStats } from '@/lib/chat-service';
import { requireAdmin, logAdminAction } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  try {
    // Validate admin authentication using consistent auth utility
    const adminDenied = await requireAdmin(request);
    if (adminDenied) {
      await logAdminAction('chat_admin_messages_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
      return adminDenied;
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
