import { NextRequest, NextResponse } from 'next/server';
import { getCachedMyActivity } from '@/lib/activity-service';
import { isValidEthereumAddressFormat } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.trim() || '';

  if (!address) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 });
  }

  if (!isValidEthereumAddressFormat(address)) {
    return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
  }

  try {
    const activities = await getCachedMyActivity(address);
    return NextResponse.json(
      { activities, count: activities.length },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      },
    );
  } catch (error: any) {
    console.error('[ActivityAPI] Failed to load personal activity', { address, error });
    return NextResponse.json(
      {
        error: 'Failed to load personal activity',
        message: error?.message || 'Unexpected error',
      },
      { status: 500 },
    );
  }
}
