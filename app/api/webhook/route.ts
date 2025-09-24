import { NextRequest, NextResponse } from 'next/server';
import { setUserNotificationDetails, deleteUserNotificationDetails } from '@/lib/notification';
import crypto from 'crypto';
// Prefer official JSON Farcaster Signature verification; fall back to HMAC if needed
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: runtime-only import, types may vary across versions
import { parseWebhookEvent, verifyAppKeyWithNeynar } from '@farcaster/miniapp-node';

async function verifyWebhookEvent(request: NextRequest): Promise<{ valid: boolean; body: any }>{
  // Attempt official JSON Farcaster Signature verification first
  try {
    const bodyText = await request.text();
    // parseWebhookEvent validates header/payload/signature using the provided verifier
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any = await (parseWebhookEvent as any)(bodyText, verifyAppKeyWithNeynar);
    return { valid: true, body: parsed };
  } catch (e) {
    // Fall back to legacy HMAC verification for backward compatibility
    try {
      const webhookSecret = process.env.WEBHOOK_SECRET;
      if (!webhookSecret) return { valid: false, body: null };

      const signature = request.headers.get('x-webhook-signature');
      const timestamp = request.headers.get('x-webhook-timestamp');
      if (!signature || !timestamp) return { valid: false, body: null };

      const timestampMs = parseInt(timestamp);
      const now = Date.now();
      if (Math.abs(now - timestampMs) > 5 * 60 * 1000) return { valid: false, body: null };

      const bodyText = await request.text();
      const body = JSON.parse(bodyText);
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${bodyText}`)
        .digest('hex');
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSignature);
      if (sigBuf.length !== expBuf.length) return { valid: false, body };
      const valid = crypto.timingSafeEqual(sigBuf, expBuf);
      return { valid, body };
    } catch {
      return { valid: false, body: null };
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { valid, body } = await verifyWebhookEvent(req);

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
