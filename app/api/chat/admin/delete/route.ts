import { NextRequest, NextResponse } from 'next/server';
import { deleteMessage, deleteAllMessages } from '@/lib/chat-service';
import { validateAdminKey, logAdminAction, createErrorResponse } from '@/lib/auth-utils';

export async function DELETE(request: NextRequest) {
  try {
    // Validate admin authentication using consistent auth utility
    if (!validateAdminKey(request)) {
      await logAdminAction('chat_admin_delete_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
      const error = createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED');
      return NextResponse.json(error.body, { status: error.status });
    }

    const body = await request.json();
    const { messageId, timestamp, deleteAll } = body;

    if (deleteAll) {
      // Delete all messages
      const deletedCount = await deleteAllMessages();
      
      // Log successful admin action
      await logAdminAction('chat_admin_delete_all_success', 'valid_key', { 
        deletedCount 
      }, true);
      
      return NextResponse.json({
        success: true,
        deletedCount,
        message: `Deleted ${deletedCount} messages`
      });
    } else if (messageId && timestamp) {
      // Delete specific message
      const deleted = await deleteMessage(messageId, timestamp);
      
      if (deleted) {
        // Log successful admin action
        await logAdminAction('chat_admin_delete_message_success', 'valid_key', { 
          messageId,
          timestamp 
        }, true);
        
        return NextResponse.json({
          success: true,
          message: 'Message deleted successfully'
        });
      } else {
        return NextResponse.json(
          { error: 'Message not found' },
          { status: 404 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Either messageId and timestamp, or deleteAll flag is required' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Error deleting chat message(s):', error);
    return NextResponse.json(
      { error: 'Failed to delete message(s)' },
      { status: 500 }
    );
  }
}