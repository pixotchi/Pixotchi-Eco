import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAddress } from 'viem';
import { getSwapQuoteForUserPair } from '@/lib/swap/engine';
import {
  isUserSwapTokenId,
  SWAP_QUOTE_TTL_MS,
} from '@/lib/swap/constants';
import { signQuoteToken } from '@/lib/swap/quote-token';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { swapErrorResponse } from '@/lib/swap/api-errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const QUOTE_IP_LIMIT = 120;
const QUOTE_IP_WINDOW_SECONDS = 60;
const QUOTE_ADDRESS_LIMIT = 90;
const QUOTE_ADDRESS_WINDOW_SECONDS = 60;
const MAX_AMOUNT_DIGITS = 80;

const requestSchema = z.object({
  sellToken: z.string().refine(isUserSwapTokenId, 'Unsupported sell token'),
  buyToken: z.string().refine(isUserSwapTokenId, 'Unsupported buy token'),
  amountIn: z
    .string()
    .regex(/^\d+$/, 'amountIn must be a raw integer string')
    .max(MAX_AMOUNT_DIGITS, 'amountIn is too large'),
  originAddress: z
    .string()
    .optional()
    .refine((value) => !value || isAddress(value), 'originAddress must be a valid address'),
});

export async function POST(request: NextRequest) {
  // Cross-site / origin enforcement is handled centrally by proxy.ts
  // (EDGE_SAME_ORIGIN_ONLY_API_PATHS + the /api/* CORS allowlist).
  try {
    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:swap:quote',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: QUOTE_IP_LIMIT,
          windowSeconds: QUOTE_IP_WINDOW_SECONDS,
        },
      ],
    });
    if (rateLimitResponse) return rateLimitResponse;

    const json = await request.json();
    const payload = requestSchema.parse(json);

    if (payload.originAddress) {
      const addressRateLimit = await enforceRateLimit(request, {
        scope: 'api:swap:quote',
        rules: [
          {
            kind: 'address',
            identifier: payload.originAddress,
            limit: QUOTE_ADDRESS_LIMIT,
            windowSeconds: QUOTE_ADDRESS_WINDOW_SECONDS,
          },
        ],
      });
      if (addressRateLimit) return addressRateLimit;
    }

    const amountIn = BigInt(payload.amountIn);

    const quote = await getSwapQuoteForUserPair({
      sellToken: payload.sellToken,
      buyToken: payload.buyToken,
      amountIn,
      originAddress: payload.originAddress as `0x${string}` | undefined,
    });

    const issuedAt = Date.now();
    const expiresAt = issuedAt + SWAP_QUOTE_TTL_MS;

    // Only issue an executable token for executable quotes. Preview-only
    // (blocked) quotes get an advisory response without a token.
    const quoteToken =
      quote.strategy === 'blocked'
        ? undefined
        : signQuoteToken({
            sender: payload.originAddress?.toLowerCase() ?? null,
            sellToken: payload.sellToken,
            buyToken: payload.buyToken,
            amountIn: amountIn.toString(),
            steps: quote.steps.map((step) => ({
              key: step.key,
              kind: step.kind,
              sellToken: step.sellToken,
              buyToken: step.buyToken,
              amountIn: step.amountIn,
            })),
            expiresAt,
          });

    return NextResponse.json({
      ...quote,
      quoteToken,
      issuedAt,
      expiresAt,
    });
  } catch (error) {
    return swapErrorResponse(error, 'Failed to fetch swap quote', '[swap/quote]');
  }
}
