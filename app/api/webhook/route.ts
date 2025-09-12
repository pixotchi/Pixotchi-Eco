import { NextRequest, NextResponse } from 'next/server';
import { setUserNotificationDetails, deleteUserNotificationDetails } from '@/lib/notification';
import crypto from 'crypto';

async function verifyWebhookSignature(request: NextRequest) {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error('WEBHOOK_SECRET not configured');
    return { valid: false, body: null };
  }

  const signature = request.headers.get('x-webhook-signature');
  const timestamp = request.headers.get('x-webhook-timestamp');
  
  if (!signature || !timestamp) {
    return { valid: false, body: null };
  }

  // Check timestamp to prevent replay attacks (5 minute window)
  const timestampMs = parseInt(timestamp);
  const now = Date.now();
  if (Math.abs(now - timestampMs) > 5 * 60 * 1000) {
    return { valid: false, body: null };
  }

  const bodyText = await request.text();
  const body = JSON.parse(bodyText);

  // Create expected signature
  const payload = `${timestamp}.${bodyText}`;
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');

  // Constant time comparison to prevent timing attacks
  const valid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );

  return { valid, body };
}

export async function POST(req: NextRequest) {
  try {
    const { valid, body } = await verifyWebhookSignature(req);

    if (!valid) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { event, notificationDetails, fid } = body;

    switch (event) {
      case 'miniapp_added':
      case 'notifications_enabled':
        if (notificationDetails && fid) {
          await setUserNotificationDetails(fid, notificationDetails);
        }
        break;
      case 'miniapp_removed':
      case 'notifications_disabled':
        if (fid) {
          await deleteUserNotificationDetails(fid);
        }
        break;
      default:
        // Silently ignore unknown event types in production
    }

    return NextResponse.json({ message: 'Webhook received' }, { status: 200 });

  } catch (error) {
    // Log to error tracking service in production
    if (process.env.NODE_ENV === 'development') {
      console.error('Error processing webhook:', error);
    }
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
