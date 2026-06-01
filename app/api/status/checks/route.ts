import { NextResponse } from 'next/server';
import { getCachedStatusSnapshot } from '@/lib/status-checks';

export const revalidate = 0;

export async function GET() {
  try {
    const snapshot = await getCachedStatusSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error: UntypedValue) {
    return NextResponse.json({
      error: 'Failed to run status checks',
      message: error?.message || 'Unexpected error',
    }, { status: 500 });
  }
}
