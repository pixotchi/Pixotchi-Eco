import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { getCampaignProgress, getCampaignResults, listCampaigns } from '@/lib/notifications/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!validateAdminKey(request)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 50);
    const campaigns = await listCampaigns(limit);

    const detailed = await Promise.all(
      campaigns.map(async (campaign) => ({
        ...campaign,
        progress: await getCampaignProgress(campaign.id),
        result: await getCampaignResults(campaign.id),
      })),
    );

    return NextResponse.json({
      success: true,
      campaigns: detailed,
    });
  } catch (error) {
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error.message : 'Failed to list campaigns', 500).body,
      { status: 500 },
    );
  }
}
