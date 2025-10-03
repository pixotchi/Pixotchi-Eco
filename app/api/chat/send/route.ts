import { NextRequest, NextResponse } from 'next/server';
import { 
  storeMessage, 
  checkRateLimit, 
  updateRateLimit, 
  checkSpam, 
  validateMessage 
} from '@/lib/chat-service';
import { markMissionTask, trackDailyActivity } from '@/lib/gamification-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, address } = body;

    // Validate required fields
    if (!message || !address) {
      return NextResponse.json(
        { error: 'Message and address are required' },
        { status: 400 }
      );
    }

    // Validate message content
    const messageError = validateMessage(message);
    if (messageError) {
      return NextResponse.json(
        { error: messageError },
        { status: 400 }
      );
    }

    // Basic address validation (wallet connection is sufficient for public chat)
    if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Check rate limit
    const canSend = await checkRateLimit(address);
    if (!canSend) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before sending another message.' },
        { status: 429 }
      );
    }

    // Check for spam
    const isSpam = await checkSpam(message, address);
    if (isSpam) {
      return NextResponse.json(
        { error: 'Duplicate or spam message detected' },
        { status: 429 }
      );
    }

    console.log('📝 Storing message...');
    
    // Store the message (OnchainKit will handle names client-side)
    let chatMessage;
    try {
      chatMessage = await storeMessage(address, message);
      console.log('✅ Message stored successfully');
    } catch (error) {
      console.error('❌ Message storage failed:', error);
      return NextResponse.json(
        { error: 'Failed to store message' },
        { status: 500 }
      );
    }

    // Update rate limit (with timeout)
    console.log('📝 Updating rate limit...');
    try {
      const updatePromise = updateRateLimit(address);
      let timeoutId: NodeJS.Timeout;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Rate limit update timeout')), 3000);
      });
      await Promise.race([updatePromise, timeoutPromise]);
      clearTimeout(timeoutId!);
      console.log('✅ Rate limit updated');
    } catch (error) {
      console.warn('⚠️ Rate limit update failed (non-critical):', error);
      // Continue anyway
    }

    // Gamification: mark chat task and streak activity (fire-and-forget, non-blocking)
    try { markMissionTask(address, 's2_chat_message'); } catch {}
    try { trackDailyActivity(address); } catch {}

    return NextResponse.json({
      success: true,
      message: chatMessage
    });

  } catch (error) {
    console.error('Error sending chat message:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}