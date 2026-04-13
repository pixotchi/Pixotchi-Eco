import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse, logAdminAction } from '@/lib/auth-utils';
import { getAllAIConversations, getAIUsageStats, deleteAIConversation, deleteAllAIConversations } from '@/lib/ai-service';

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
    const includeStats = searchParams.get('includeStats') === 'true';
    
    // Get all conversations
    const conversations = await getAllAIConversations();
    
    // Get usage stats if requested
    let stats = null;
    if (includeStats) {
      stats = await getAIUsageStats();
    }

    // Log admin action
    const adminKey = request.headers.get('x-admin-key') || '';
    await logAdminAction('ai_conversations_viewed', adminKey, {
      conversationCount: conversations.length,
      includeStats
    });

    return NextResponse.json({
      success: true,
      conversations,
      stats,
      count: conversations.length,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error fetching AI conversations for admin:', error);
    
    const adminKey = request.headers.get('x-admin-key') || '';
    await logAdminAction('ai_conversations_viewed', adminKey, { error: error }, false);
    
    return NextResponse.json(
      createErrorResponse('Failed to fetch AI conversations', 500).body,
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  // Validate admin access
  if (!validateAdminKey(request)) {
    return NextResponse.json(
      createErrorResponse('Unauthorized access', 401, 'UNAUTHORIZED').body,
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const deleteAll = searchParams.get('all') === 'true';
    const conversationId = searchParams.get('conversationId');
    const adminKey = request.headers.get('x-admin-key') || '';

    if (deleteAll) {
      const deletedCount = await deleteAllAIConversations();

      if (deletedCount < 0) {
        return NextResponse.json(
          createErrorResponse('Failed to delete all AI conversations', 500).body,
          { status: 500 }
        );
      }

      await logAdminAction('ai_conversations_deleted_all', adminKey, {
        deletedCount
      });

      return NextResponse.json({
        success: true,
        message: 'All AI conversations deleted successfully',
        deletedCount
      });
    }

    if (!conversationId) {
      return NextResponse.json(
        createErrorResponse('Conversation ID is required', 400).body,
        { status: 400 }
      );
    }

    const deleted = await deleteAIConversation(conversationId);

    if (!deleted) {
      return NextResponse.json(
        createErrorResponse('Failed to delete conversation', 500).body,
        { status: 500 }
      );
    }

    await logAdminAction('ai_conversation_deleted', adminKey, {
      conversationId
    });

    return NextResponse.json({
      success: true,
      message: 'Conversation deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting AI conversation:', error);
    
    const adminKey = request.headers.get('x-admin-key') || '';
    await logAdminAction('ai_conversation_deleted', adminKey, { error: error }, false);
    
    return NextResponse.json(
      createErrorResponse('Failed to delete conversation', 500).body,
      { status: 500 }
    );
  }
}
