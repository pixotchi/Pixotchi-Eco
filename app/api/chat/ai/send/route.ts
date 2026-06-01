import { NextRequest, NextResponse } from 'next/server';
import { streamAIMessage, validateAIMessage, type PixotchiAIUIMessage } from '@/lib/ai-service';
import {
  ChatAuthError,
  createChatAuthRequiredResponse,
  createChatAuthErrorResponse,
  createChatUnavailableResponse,
  getChatSessionOrQuickAuthFromRequest,
} from '@/lib/chat-auth';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const AI_CHAT_IP_LIMIT_PER_MINUTE = 30;
const AI_CHAT_ADDRESS_COOLDOWN_SECONDS = 10;
const AI_CHAT_MAX_REQUEST_BYTES = parsePositiveInteger(process.env.AI_CHAT_MAX_REQUEST_BYTES, 8 * 1024);
const AI_CHAT_MAX_ORIGINAL_MESSAGES = 1;
const AI_CHAT_MAX_ORIGINAL_MESSAGE_TEXT = 300;

type ParsedRequestBody =
  | { body: UntypedValue; ok: true }
  | { ok: false; response: NextResponse };

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function noStoreJson(error: string, status: number): NextResponse {
  return NextResponse.json(
    { error },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
      status,
    },
  );
}

async function readJsonBodyWithLimit(request: NextRequest): Promise<ParsedRequestBody> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      return { ok: false, response: noStoreJson('Invalid request size.', 400) };
    }

    if (parsedLength > AI_CHAT_MAX_REQUEST_BYTES) {
      return { ok: false, response: noStoreJson('AI request body is too large.', 413) };
    }
  }

  if (!request.body) {
    return { body: {}, ok: true };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > AI_CHAT_MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { ok: false, response: noStoreJson('AI request body is too large.', 413) };
      }

      chunks.push(value);
    }
  } catch {
    return { ok: false, response: noStoreJson('Failed to read request body.', 400) };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const rawBody = new TextDecoder().decode(bytes);
  if (!rawBody.trim()) {
    return { body: {}, ok: true };
  }

  try {
    return { body: JSON.parse(rawBody), ok: true };
  } catch {
    return { ok: false, response: noStoreJson('Invalid JSON request body.', 400) };
  }
}

function getTextFromIncomingMessage(message: UntypedValue): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (!Array.isArray(message.parts)) {
    return '';
  }

  return message.parts
    .filter((part: UntypedValue) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: UntypedValue) => part.text)
    .join('');
}

function getLatestUserText(messages: UntypedValue[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return getTextFromIncomingMessage(message);
    }
  }

  return '';
}

function sanitizeOriginalMessages(messages: UntypedValue): PixotchiAIUIMessage[] | undefined {
  if (!Array.isArray(messages)) {
    return undefined;
  }

  const sanitized: PixotchiAIUIMessage[] = [];
  for (let index = messages.length - 1; index >= 0 && sanitized.length < AI_CHAT_MAX_ORIGINAL_MESSAGES; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object' || message.role !== 'user') {
      continue;
    }

    const text = getTextFromIncomingMessage(message).slice(0, AI_CHAT_MAX_ORIGINAL_MESSAGE_TEXT);
    if (!text.trim()) {
      continue;
    }

    sanitized.unshift({
      id: typeof message.id === 'string' && message.id.length <= 128 ? message.id : `client-user-${index}`,
      parts: [
        {
          text,
          type: 'text',
        },
      ],
      role: 'user',
    });
  }

  return sanitized.length ? sanitized : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const { session, sessionId } = await getChatSessionOrQuickAuthFromRequest(request);

    if (!session) {
      return createChatAuthRequiredResponse({ clearCookie: Boolean(sessionId) });
    }

    const parsedBody = await readJsonBodyWithLimit(request);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const body = parsedBody.body;
    const originalMessages = sanitizeOriginalMessages(body?.messages);
    const message = typeof body?.message === 'string'
      ? body.message
      : getLatestUserText(originalMessages || []);
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;

    const messageError = validateAIMessage(message);
    if (messageError) {
      return noStoreJson(messageError, 400);
    }

    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:chat:ai:send',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: AI_CHAT_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: session.address,
          limit: 1,
          windowSeconds: AI_CHAT_ADDRESS_COOLDOWN_SECONDS,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    return await streamAIMessage(session.address, message, {
      abortSignal: request.signal,
      conversationId,
      originalMessages,
      sourceAddress: session.sourceAddress ?? null,
    });
  } catch (error) {
    if (error instanceof ChatAuthError) {
      return createChatAuthErrorResponse(error);
    }

    console.error('Error in AI chat endpoint:', error);
    return createChatUnavailableResponse('Failed to process AI message.');
  }
}
