import { NextResponse } from 'next/server';
import { runStatusChecks } from '@/lib/status-checks';
import { logger } from '@/lib/logger';

export const revalidate = 0;

export async function GET() {
  try {
    const snapshot = await runStatusChecks();
    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    logger.error('Failed to run status checks', error);
    return NextResponse.json({
      error: 'Failed to run status checks',
      message: error?.message || 'Unexpected error',
    }, { status: 500 });
  }
}

