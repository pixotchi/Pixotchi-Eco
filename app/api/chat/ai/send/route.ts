import { NextRequest, NextResponse } from 'next/server';
import { sendAIMessage, checkAIRateLimit, updateAIRateLimit, validateAIMessage } from '@/lib/ai-service';
import { isValidEthereumAddressFormat } from '@/lib/utils';

// Extend timeout for AI processing
export const maxDuration = 60; // 60 seconds
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, address } = body;

    // Validate required fields
    if (!message || !address) {
      console.warn('[AI_CHAT] Missing message or address', { hasMessage: Boolean(message), hasAddress: Boolean(address) });
      return NextResponse.json(
        { error: 'Message and address are required' },
        { status: 400 }
      );
    }

    // Validate message content
    const messageError = validateAIMessage(message);
    if (messageError) {
      console.warn('[AI_CHAT] Message validation failed', { address, messageLength: message?.length, error: messageError });
      return NextResponse.json(
        { error: messageError },
        { status: 400 }
      );
    }

    // Basic address validation
    if (!isValidEthereumAddressFormat(address)) {
      console.warn('[AI_CHAT] Invalid address format', { address });
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Check rate limit
    const canSend = await checkAIRateLimit(address);
    if (!canSend) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before sending another message to the AI.' },
        { status: 429 }
      );
    }

    console.log('🤖 Processing AI message...');
    
    // Send message to AI and get response
    let result;
    try {
      result = await sendAIMessage(address, message);
      console.log('✅ AI response generated successfully');
    } catch (error) {
      console.error('❌ AI message processing failed:', error);
      return NextResponse.json(
        { error: 'Failed to process AI message. Please try again.' },
        { status: 500 }
      );
    }

    // Update rate limit
    console.log('📝 Updating AI rate limit...');
    try {
      await updateAIRateLimit(address);
      console.log('✅ AI rate limit updated');
    } catch (error) {
      console.warn('⚠️ AI rate limit update failed (non-critical):', error);
    }

    return NextResponse.json({
      success: true,
      userMessage: result.userMessage,
      aiResponse: result.aiResponse,
      conversationId: result.userMessage.conversationId
    });

  } catch (error) {
    console.error('Error in AI chat endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to process AI message' },
      { status: 500 }
    );
  }
}