import { NextRequest, NextResponse } from 'next/server';
import { getAIConversationMessages, getOrCreateConversation } from '@/lib/ai-service';
import { isValidEthereumAddressFormat } from '@/lib/utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    const conversationId = searchParams.get('conversationId');
    const limit = parseInt(searchParams.get('limit') || '50');
    
    // Validate required parameters
    if (!address) {
      return NextResponse.json(
        { error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!isValidEthereumAddressFormat(address)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }
    
    // Validate limit
    if (limit > 100) {
      return NextResponse.json(
        { error: 'Limit cannot exceed 100' },
        { status: 400 }
      );
    }

    let finalConversationId = conversationId;
    
    // If no conversationId provided, get or create one for the user
    if (!finalConversationId) {
      finalConversationId = await getOrCreateConversation(address);
    }

    // Get messages for the conversation
    const messages = await getAIConversationMessages(finalConversationId, limit);

    return NextResponse.json({
      messages,
      conversationId: finalConversationId,
      count: messages.length,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching AI chat messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch AI messages' },
      { status: 500 }
    );
  }
}