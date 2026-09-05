import { NextRequest, NextResponse } from 'next/server';
import { getCachedStatusSnapshot, getStoredStatusSnapshot } from '@/lib/status-checks';
import { verifyVercelCron } from '@/lib/notifications/cron-auth';
import { toPublicStatusSnapshot } from '@/lib/status-snapshot';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get('authorization');
    const isCron = verifyVercelCron(request);

    // This route also powers the public status page. Anonymous requests may
    // read an already-computed snapshot, but only Vercel's authenticated cron
    // can trigger the external health sweep after a cache miss or expiry.
    if (authorization && !isCron) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const snapshot = isCron
      ? await getCachedStatusSnapshot(true)
      : await getStoredStatusSnapshot();

    if (!snapshot) {
      return NextResponse.json(
        { error: 'Status snapshot is not ready' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(toPublicStatusSnapshot(snapshot), {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch {
    return NextResponse.json({
      error: 'Failed to run status checks',
    }, { status: 500 });
  }
}
