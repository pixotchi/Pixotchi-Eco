import { NextRequest, NextResponse } from 'next/server';
import { setUserNotificationDetails, deleteUserNotificationDetails } from '@/lib/notification';
import crypto from 'crypto';
import { SERVER_ENV } from '@/lib/env-config';
// Prefer official JSON Farcaster Signature verification; fall back to HMAC if needed
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: runtime-only import, types may vary across versions
import { parseWebhookEvent, verifyAppKeyWithNeynar } from '@farcaster/miniapp-node';

async function verifyWebhookEvent(request: NextRequest): Promise<{ valid: boolean; body: UntypedValue }> {
  const bodyText = await request.text();
  let parsedBody: UntypedValue = null;

  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    // Keep the raw body for the legacy HMAC fallback below. The official JFS
    // verifier receives the parsed object because its schema is object-based.
  }

  // Attempt official JSON Farcaster Signature verification first
  try {
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      throw new Error('Webhook body must be a JSON object');
    }

    // parseWebhookEvent validates header/payload/signature using the provided verifier
    const parsed: UntypedValue = await (parseWebhookEvent as UntypedValue)(parsedBody, verifyAppKeyWithNeynar);

    const configuredAppFid = process.env.FARCASTER_APP_FID?.trim();
    if (configuredAppFid) {
      const expectedAppFid = Number(configuredAppFid);
      if (!Number.isSafeInteger(expectedAppFid) || expectedAppFid <= 0 || parsed.appFid !== expectedAppFid) {
        throw new Error('Webhook app FID does not match the configured Farcaster app FID');
      }
    }

    return { valid: true, body: parsed };
  } catch {
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

      const body = parsedBody;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { valid: false, body: null };
      }
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
    if (SERVER_ENV.NOTIFICATION_PROVIDER !== 'neynar') {
      return NextResponse.json({ message: 'Webhook ignored for current provider' }, { status: 202 });
    }

    const { valid, body } = await verifyWebhookEvent(req);

    if (!valid) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { fid, event: eventData } = body;
    const { event, notificationDetails } = eventData;

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
        // Silently ignore UntypedValue event types in production
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
