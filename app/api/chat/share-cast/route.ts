import { NextRequest, NextResponse } from 'next/server';
import { 
  storeMessage, 
  checkRateLimit, 
  updateRateLimit, 
} from '@/lib/chat-service';
import { markMissionTask, trackDailyActivity } from '@/lib/gamification-service';
import { CastShareData } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, castData } = body as { 
      address: string; 
      castData: CastShareData;
    };

    // Validate required fields
    if (!address || !castData?.hash) {
      return NextResponse.json(
        { error: 'Address and cast data are required' },
        { status: 400 }
      );
    }

    // Basic address validation
    if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Check rate limit (cast shares count toward rate limit)
    const canSend = await checkRateLimit(address);
    if (!canSend) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before sharing another cast.' },
        { status: 429 }
      );
    }

    console.log('📝 Storing shared cast...');
    
    // Create a message with cast share type
    const castAuthorDisplay = castData.author.displayName || castData.author.username || `FID ${castData.author.fid}`;
    const messageText = `shared a cast from @${castAuthorDisplay}`;
    
    // Store as special cast share message
    let chatMessage;
    try {
      chatMessage = await storeMessage(address, messageText, 'cast_share', castData);
      console.log('✅ Shared cast stored successfully');
    } catch (error) {
      console.error('❌ Cast share storage failed:', error);
      return NextResponse.json(
        { error: 'Failed to share cast' },
        { status: 500 }
      );
    }

    // Update rate limit
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
    }

    // Gamification: mark chat task and streak activity
    try { markMissionTask(address, 's2_chat_message'); } catch {}
    try { trackDailyActivity(address); } catch {}

    return NextResponse.json({
      success: true,
      message: chatMessage
    });

  } catch (error) {
    console.error('Error sharing cast to chat:', error);
    return NextResponse.json(
      { error: 'Failed to share cast' },
      { status: 500 }
    );
  }
}

