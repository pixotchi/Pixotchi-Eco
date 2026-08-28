import { NextRequest, NextResponse } from 'next/server';
import { getCachedMyActivityFeed } from '@/lib/activity-service';
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
    const { activities, landIds, plantIds } = await getCachedMyActivityFeed(address);
    return NextResponse.json(
      // `plantIds`/`landIds` are the assets this feed was scoped to. The client
      // uses them to separate incoming attacks from outgoing ones.
      { activities, count: activities.length, landIds, plantIds },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error: UntypedValue) {
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
