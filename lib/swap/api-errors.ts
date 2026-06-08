import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  SwapBlockedError,
  SwapTimeoutError,
  SwapTransientError,
} from './engine';

// Single place that knows how to translate server-side swap errors into
// HTTP responses. Both swap route handlers funnel their catch blocks
// through this so status codes and message shapes stay consistent.
export function swapErrorResponse(
  error: UntypedValue,
  fallbackMessage: string,
  logPrefix: string,
): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message || fallbackMessage },
      { status: 400 },
    );
  }

  if (error instanceof SwapBlockedError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof SwapTimeoutError) {
    return NextResponse.json(
      { error: error.message || 'Swap provider timed out.' },
      { status: 504 },
    );
  }

  if (error instanceof SwapTransientError) {
    return NextResponse.json(
      { error: error.message || 'Swap provider temporarily unavailable.' },
      { status: 503 },
    );
  }

  console.error(logPrefix, error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
