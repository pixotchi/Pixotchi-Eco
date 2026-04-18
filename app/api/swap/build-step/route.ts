import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAddress } from 'viem';
import {
  buildSwapStep,
  SwapBlockedError,
} from '@/lib/swap/engine';
import { isSwapTokenId } from '@/lib/swap/constants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const requestSchema = z.object({
  kind: z.enum(['kyber', 'baseswap_seed']),
  sellToken: z.string().refine(isSwapTokenId, 'Unsupported sell token'),
  buyToken: z.string().refine(isSwapTokenId, 'Unsupported buy token'),
  amountIn: z.string().regex(/^\d+$/, 'amountIn must be a raw integer string'),
  sender: z.string().refine(isAddress, 'sender must be a valid address'),
  recipient: z.string().optional().refine((value) => !value || isAddress(value), 'recipient must be a valid address'),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const payload = requestSchema.parse(json);
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || 'Invalid build-step request' },
        { status: 400 },
      );
    }

    if (error instanceof SwapBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('[swap/build-step] Failed to build swap step', error);
    return NextResponse.json(
      { error: 'Failed to build swap step' },
      { status: 500 },
    );
  }
}
