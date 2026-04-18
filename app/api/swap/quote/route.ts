import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAddress } from 'viem';
import {
  getSwapQuoteForUserPair,
  SwapBlockedError,
} from '@/lib/swap/engine';
import { isUserSwapTokenId } from '@/lib/swap/constants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const requestSchema = z.object({
  sellToken: z.string().refine(isUserSwapTokenId, 'Unsupported sell token'),
  buyToken: z.string().refine(isUserSwapTokenId, 'Unsupported buy token'),
  amountIn: z.string().regex(/^\d+$/, 'amountIn must be a raw integer string'),
  originAddress: z
    .string()
    .optional()
    .refine((value) => !value || isAddress(value), 'originAddress must be a valid address'),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const payload = requestSchema.parse(json);

    const quote = await getSwapQuoteForUserPair({
      sellToken: payload.sellToken,
      buyToken: payload.buyToken,
      amountIn: BigInt(payload.amountIn),
      originAddress: payload.originAddress as `0x${string}` | undefined,
    });

    return NextResponse.json(quote);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || 'Invalid quote request' },
        { status: 400 },
      );
    }

    if (error instanceof SwapBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('[swap/quote] Failed to quote swap', error);
    return NextResponse.json(
      { error: 'Failed to fetch swap quote' },
      { status: 500 },
    );
  }
}
