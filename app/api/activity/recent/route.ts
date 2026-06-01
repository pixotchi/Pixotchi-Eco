import { NextResponse } from 'next/server';
import { getCachedAllActivity } from '@/lib/activity-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const activities = await getCachedAllActivity();
    return NextResponse.json(
      { activities, count: activities.length },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error: UntypedValue) {
    console.error('[ActivityAPI] Failed to load recent activity', error);
    return NextResponse.json(
      {
        error: 'Failed to load recent activity',
        message: error?.message || 'Unexpected error',
      },
      { status: 500 },
    );
  }
}
