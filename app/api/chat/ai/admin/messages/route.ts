import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse, logAdminAction } from '@/lib/auth-utils';
import { getAIConversationMessages } from '@/lib/ai-service';

export async function GET(request: NextRequest) {
  // Validate admin access
  if (!validateAdminKey(request)) {
    return NextResponse.json(
      createErrorResponse('Unauthorized access', 401, 'UNAUTHORIZED').body,
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    const limit = parseInt(searchParams.get('limit') || '100');
    
    if (!conversationId) {
      return NextResponse.json(
        createErrorResponse('Conversation ID is required', 400).body,
        { status: 400 }
      );
    }
    
    // Validate limit
    if (limit > 200) {
      return NextResponse.json(
        createErrorResponse('Limit cannot exceed 200', 400).body,
        { status: 400 }
      );
    }

    // Get messages for the conversation
    const messages = await getAIConversationMessages(conversationId, limit);

    // Log admin action
    const adminKey = request.headers.get('x-admin-key') || '';
    await logAdminAction('ai_messages_viewed', adminKey, {
      conversationId,
      messageCount: messages.length
    });

    return NextResponse.json({
      success: true,
      messages,
      conversationId,
      count: messages.length,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error fetching AI messages for admin:', error);
    
    const adminKey = request.headers.get('x-admin-key') || '';
    await logAdminAction('ai_messages_viewed', adminKey, { error: error }, false);
    
    return NextResponse.json(
      createErrorResponse('Failed to fetch AI messages', 500).body,
      { status: 500 }
    );
  }
}