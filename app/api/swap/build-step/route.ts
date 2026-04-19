import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAddress, isAddress } from 'viem';
import { buildSwapStep } from '@/lib/swap/engine';
import { isSwapTokenId } from '@/lib/swap/constants';
import { verifyQuoteToken } from '@/lib/swap/quote-token';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { swapErrorResponse } from '@/lib/swap/api-errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BUILD_IP_LIMIT = 60;
const BUILD_IP_WINDOW_SECONDS = 60;
const BUILD_ADDRESS_LIMIT = 30;
const BUILD_ADDRESS_WINDOW_SECONDS = 60;

const requestSchema = z.object({
  quoteToken: z.string().min(16, 'quoteToken is required').max(2048, 'quoteToken is too long'),
  kind: z.enum(['kyber', 'baseswap_seed']),
  sellToken: z.string().refine(isSwapTokenId, 'Unsupported sell token'),
  buyToken: z.string().refine(isSwapTokenId, 'Unsupported buy token'),
  amountIn: z.string().regex(/^\d+$/, 'amountIn must be a raw integer string'),
  sender: z.string().refine(isAddress, 'sender must be a valid address'),
  recipient: z
    .string()
    .optional()
    .refine((value) => !value || isAddress(value), 'recipient must be a valid address'),
});

function reject(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  // Cross-site / origin enforcement is handled centrally by proxy.ts.
  try {
    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:swap:build-step',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: BUILD_IP_LIMIT,
          windowSeconds: BUILD_IP_WINDOW_SECONDS,
        },
      ],
    });
    if (rateLimitResponse) return rateLimitResponse;

    const json = await request.json();
    const payload = requestSchema.parse(json);

    const addressRateLimit = await enforceRateLimit(request, {
      scope: 'api:swap:build-step',
      rules: [
        {
          kind: 'address',
          identifier: payload.sender,
          limit: BUILD_ADDRESS_LIMIT,
          windowSeconds: BUILD_ADDRESS_WINDOW_SECONDS,
        },
      ],
    });
    if (addressRateLimit) return addressRateLimit;

    const verified = verifyQuoteToken(payload.quoteToken);
    if (!verified) {
      return reject(
        'Swap quote is invalid or expired. Please refresh and try again.',
        410,
      );
    }

    const senderLower = getAddress(payload.sender).toLowerCase();
    if (!verified.sender || verified.sender !== senderLower) {
      return reject(
        'Sender address does not match the address that requested this quote.',
        403,
      );
    }

    if (
      verified.sellToken !== payload.sellToken ||
      verified.buyToken !== payload.buyToken ||
      verified.amountIn !== payload.amountIn
    ) {
      return reject('Quote parameters do not match the build request.', 400);
    }

    const matchesQuotedStep = verified.steps.some(
      (step) =>
        step.kind === payload.kind &&
        step.sellToken === payload.sellToken &&
        step.buyToken === payload.buyToken &&
        step.amountIn === payload.amountIn,
    );
    if (!matchesQuotedStep) {
      return reject(
        'Requested execution step does not match the signed quote route.',
        400,
      );
    }

    const response = await buildSwapStep({
      kind: payload.kind,
      sellToken: payload.sellToken,
      buyToken: payload.buyToken,
      amountIn: BigInt(payload.amountIn),
      sender: payload.sender as `0x${string}`,
      recipient: (payload.recipient || payload.sender) as `0x${string}`,
    });

    return NextResponse.json(response);
  } catch (error) {
    return swapErrorResponse(error, 'Failed to build swap step', '[swap/build-step]');
  }
}
